from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Dict, List, Mapping, MutableMapping, Sequence, Tuple

import numpy as np
import pandas as pd
from scipy.stats import fisher_exact, mannwhitneyu


VALID_DECISIONS = {"accepted", "declined"}
VALID_RECOMMENDATIONS = {"accept", "decline", "needs_more_information"}


class ProspectiveContractError(ValueError):
    """Raised when a prospective export violates its frozen-row contract."""


@dataclass(frozen=True)
class ProspectiveProfileResult:
    signed_episode_count: int
    labeled_episode_count: int
    outcome_counts: Mapping[str, int]
    unique_people: int
    calendar_months: int
    communities: int
    chronology_warning_count: int
    readiness: Mapping[str, bool]
    output_directory: Path

    def to_dict(self) -> Dict[str, object]:
        return {
            "signed_episode_count": self.signed_episode_count,
            "labeled_episode_count": self.labeled_episode_count,
            "outcome_counts": dict(self.outcome_counts),
            "unique_people": self.unique_people,
            "calendar_months": self.calendar_months,
            "communities": self.communities,
            "chronology_warning_count": self.chronology_warning_count,
            "readiness": dict(self.readiness),
            "output_directory": str(self.output_directory),
        }


def load_prospective_contract(path: Path) -> Mapping[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ProspectiveContractError(f"Cannot read prospective contract: {error}") from error
    if not isinstance(payload, dict):
        raise ProspectiveContractError("Prospective contract must be a JSON object")
    required = {
        "contract_version",
        "assessment_schema",
        "structured_predictors",
        "prohibited_predictors",
        "readiness_thresholds",
    }
    missing = sorted(required.difference(payload))
    if missing:
        raise ProspectiveContractError(
            f"Prospective contract is missing: {', '.join(missing)}"
        )
    return payload


def load_prospective_rows(path: Path) -> List[Mapping[str, object]]:
    if not path.is_file():
        raise ProspectiveContractError(f"Prospective export does not exist: {path}")
    try:
        if path.suffix.lower() == ".json":
            payload = json.loads(path.read_text(encoding="utf-8"))
            rows = payload if isinstance(payload, list) else (
                payload.get("rows") if isinstance(payload, dict) else None
            )
            if not isinstance(rows, list):
                raise ProspectiveContractError("JSON export must be an array or contain a rows array")
            return [_object_row(row, index + 1) for index, row in enumerate(rows)]

        rows: List[Mapping[str, object]] = []
        with path.open("r", encoding="utf-8") as source:
            for line_number, raw_line in enumerate(source, start=1):
                line = raw_line.strip()
                if not line:
                    continue
                rows.append(_object_row(json.loads(line), line_number))
        return rows
    except json.JSONDecodeError as error:
        raise ProspectiveContractError(
            f"Invalid JSON near line {error.lineno}: {error.msg}"
        ) from error


def profile_prospective_export(
    *,
    input_path: Path,
    contract_path: Path,
    output_directory: Path,
) -> ProspectiveProfileResult:
    if output_directory.exists():
        raise ProspectiveContractError(
            f"Prospective output directory already exists: {output_directory}"
        )
    contract = load_prospective_contract(contract_path)
    source_rows = load_prospective_rows(input_path)
    if not source_rows:
        raise ProspectiveContractError("Prospective export contains no rows")

    predictor_groups = _predictor_groups(contract)
    all_fields = tuple(
        predictor_groups["categorical"]
        + predictor_groups["multi_select"]
        + predictor_groups["numeric"]
    )
    interval_definitions = _interval_definitions(contract)
    prohibited = set(_string_list(contract.get("prohibited_predictors")))
    overlap = sorted(prohibited.intersection(all_fields))
    if overlap:
        raise ProspectiveContractError(
            f"Predictor policy includes prohibited fields: {', '.join(overlap)}"
        )

    snapshots: List[MutableMapping[str, object]] = []
    analysis_values: List[Mapping[str, object]] = []
    seen_versions: set[Tuple[str, int]] = set()
    chronology_warnings = 0

    for index, row in enumerate(source_rows, start=1):
        snapshot, values, warning_count = _prepare_snapshot(
            row=row,
            row_number=index,
            predictor_groups=predictor_groups,
            interval_definitions=interval_definitions,
            expected_schema=str(contract["assessment_schema"]),
        )
        key = (str(snapshot["assessment_id"]), int(snapshot["assessment_version"]))
        if key in seen_versions:
            raise ProspectiveContractError(
                f"Duplicate signed assessment version: {key[0]} version {key[1]}"
            )
        seen_versions.add(key)
        snapshots.append(snapshot)
        analysis_values.append(values)
        chronology_warnings += warning_count

    snapshot_frame = pd.DataFrame(snapshots)
    profile_frame = _field_profile(
        snapshot_frame,
        all_fields,
        interval_definitions,
        _conditional_activation(contract),
    )
    associations = _association_table(
        analysis_values,
        predictor_groups,
        interval_definitions,
        minimum_cell_size=int(
            _mapping(contract["readiness_thresholds"]).get("minimum_cell_size", 5)
        ),
    )
    readiness = _readiness_gates(snapshot_frame, profile_frame, contract)
    outcome_counts = {
        str(key): int(value)
        for key, value in snapshot_frame["decision_outcome"]
        .replace("", np.nan)
        .dropna()
        .value_counts()
        .to_dict()
        .items()
    }
    signed_months = set(snapshot_frame["signed_month"].replace("", np.nan).dropna())
    communities = set(snapshot_frame["audit__community"].replace("", np.nan).dropna())

    output_directory.mkdir(parents=True, exist_ok=False)
    snapshot_frame.to_csv(output_directory / "prospective-structured-snapshots.csv", index=False)
    profile_frame.to_csv(output_directory / "prospective-field-profile.csv", index=False)
    associations.to_csv(output_directory / "prospective-univariate-associations.csv", index=False)

    result = ProspectiveProfileResult(
        signed_episode_count=len(snapshot_frame),
        labeled_episode_count=int(snapshot_frame["decision_outcome"].ne("").sum()),
        outcome_counts=outcome_counts,
        unique_people=int(snapshot_frame["person_group_id"].nunique()),
        calendar_months=len(signed_months),
        communities=len(communities),
        chronology_warning_count=chronology_warnings,
        readiness=readiness,
        output_directory=output_directory,
    )
    report = {
        **result.to_dict(),
        "contract_version": contract["contract_version"],
        "assessment_schema": contract["assessment_schema"],
        "source_sha256": _sha256(input_path),
        "safety": {
            "research_only": True,
            "trained_model": False,
            "user_facing_recommendation": False,
            "contains_direct_identifiers": False,
            "contains_record_linkage_ids": True,
        },
    }
    (output_directory / "prospective-quality-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return result


def _prepare_snapshot(
    *,
    row: Mapping[str, object],
    row_number: int,
    predictor_groups: Mapping[str, List[str]],
    interval_definitions: Sequence[Mapping[str, str]],
    expected_schema: str,
) -> Tuple[MutableMapping[str, object], Mapping[str, object], int]:
    assessment_id = _required_text(row, "assessment_id", row_number)
    referral_id = _required_text(row, "referral_id", row_number)
    canonical_client_id = _required_text(row, "canonical_client_id", row_number)
    schema_version = _required_text(row, "assessment_schema_version", row_number)
    if schema_version != expected_schema:
        raise ProspectiveContractError(
            f"Row {row_number} uses assessment schema {schema_version!r}; "
            f"expected {expected_schema!r}"
        )
    version = _positive_integer(row.get("assessment_version"), "assessment_version", row_number)
    signed_at = _timestamp(row.get("signed_at"), "signed_at", row_number)
    data = row.get("assessment_data", row.get("data"))
    if not isinstance(data, dict):
        raise ProspectiveContractError(f"Row {row_number} assessment_data must be an object")

    decision = row.get("decision")
    decision_outcome = ""
    decision_at: datetime | None = None
    decision_lag_hours: float | None = None
    if decision is not None:
        if not isinstance(decision, dict):
            raise ProspectiveContractError(f"Row {row_number} decision must be an object")
        decision_outcome = str(decision.get("outcome", "")).strip().lower()
        if decision_outcome not in VALID_DECISIONS:
            raise ProspectiveContractError(
                f"Row {row_number} has unsupported decision outcome {decision_outcome!r}"
            )
        decision_at = _timestamp(decision.get("decided_at"), "decision.decided_at", row_number)
        if decision_at < signed_at:
            raise ProspectiveContractError(
                f"Row {row_number} decision predates the signed assessment"
            )
        decision_lag_hours = round((decision_at - signed_at).total_seconds() / 3600, 3)

    recommendation = row.get("recommendation")
    recommendation_outcome = ""
    recommendation_at: datetime | None = None
    if recommendation is not None:
        if not isinstance(recommendation, dict):
            raise ProspectiveContractError(f"Row {row_number} recommendation must be an object")
        recommendation_outcome = str(recommendation.get("outcome", "")).strip().lower()
        if recommendation_outcome not in VALID_RECOMMENDATIONS:
            raise ProspectiveContractError(
                f"Row {row_number} has unsupported recommendation outcome "
                f"{recommendation_outcome!r}"
            )
        recommendation_at = _timestamp(
            recommendation.get("recommended_at"),
            "recommendation.recommended_at",
            row_number,
        )
        if recommendation_at < signed_at:
            raise ProspectiveContractError(
                f"Row {row_number} recommendation predates the signed assessment"
            )

    audit = row.get("audit", {})
    if not isinstance(audit, dict):
        raise ProspectiveContractError(f"Row {row_number} audit must be an object")
    provenance = row.get("field_provenance", {})
    if not isinstance(provenance, dict):
        raise ProspectiveContractError(f"Row {row_number} field_provenance must be an object")

    values: Dict[str, object] = {}
    snapshot: MutableMapping[str, object] = {
        "referral_id": referral_id,
        "assessment_id": assessment_id,
        "assessment_version": version,
        "assessment_schema_version": schema_version,
        "person_group_id": _group_hash(canonical_client_id),
        "signed_at": signed_at.isoformat(),
        "signed_month": signed_at.strftime("%Y-%m"),
        "recommendation_outcome": recommendation_outcome,
        "recommendation_at": recommendation_at.isoformat() if recommendation_at else "",
        "needs_more_information": (
            "yes" if recommendation_outcome == "needs_more_information"
            else "no" if recommendation_outcome
            else ""
        ),
        "decision_outcome": decision_outcome,
        "decision_at": decision_at.isoformat() if decision_at else "",
        "audit__community": _audit_text(audit, row, data, "community"),
        "audit__assessor_id": _audit_text(audit, row, data, "assessor_id"),
        "audit__referral_source": _audit_text(audit, row, data, "referral_source"),
        "audit__scheduled_method": _audit_text(audit, row, data, "scheduled_method"),
        "audit__assessment_duration_minutes": _optional_nonnegative_number(
            audit.get("assessment_duration_minutes"),
            "audit.assessment_duration_minutes",
            row_number,
        ),
        "audit__decision_lag_hours": decision_lag_hours,
    }
    chronology_warnings = 0

    for field in predictor_groups["categorical"]:
        value = _normalized_category(data.get(field))
        values[field] = value
        snapshot[field] = value or ""
    for field in predictor_groups["multi_select"]:
        value = _normalized_multi(data.get(field), field, row_number)
        values[field] = value
        snapshot[field] = json.dumps(value, separators=(",", ":")) if value else ""
    for field in predictor_groups["numeric"]:
        value = _normalized_number(data.get(field), field, row_number)
        values[field] = value
        snapshot[field] = value

    for interval in interval_definitions:
        value, warned = _derived_days(
            data.get(interval["start_field"]), data.get(interval["end_field"])
        )
        values[interval["name"]] = value
        snapshot[interval["name"]] = value
        chronology_warnings += int(warned)

    observed_fields = [field for field, value in values.items() if _is_observed(value)]
    provenance_fields = sum(1 for field in observed_fields if _has_provenance(provenance.get(field)))
    snapshot["audit__structured_fields_observed"] = len(observed_fields)
    unable_reasons = data.get("unable_to_assess_reasons")
    explicit_unable_count = (
        sum(bool(value) for value in unable_reasons.values())
        if isinstance(unable_reasons, dict)
        else 0
    )
    snapshot["audit__unable_to_assess_count"] = max(
        explicit_unable_count,
        sum(value == "unable_to_assess" for value in values.values()),
    )
    snapshot["audit__provenance_coverage_percent"] = (
        round(100 * provenance_fields / len(observed_fields), 2) if observed_fields else 0.0
    )
    snapshot["audit__extraction_edit_rate"] = _extraction_edit_rate(provenance)
    values["decision_outcome"] = decision_outcome
    return snapshot, values, chronology_warnings


def _field_profile(
    frame: pd.DataFrame,
    fields: Sequence[str],
    intervals: Sequence[Mapping[str, str]],
    conditional_activation: Mapping[str, Mapping[str, object]],
) -> pd.DataFrame:
    rows: List[Mapping[str, object]] = []
    all_fields = list(fields) + [interval["name"] for interval in intervals]
    for field in all_fields:
        series = frame[field] if field in frame else pd.Series(dtype=object)
        activation = conditional_activation.get(field)
        if activation:
            parent = str(activation["field"])
            allowed = set(_string_list(activation["values"]))
            eligible_mask = frame[parent].astype(str).isin(allowed)
        else:
            eligible_mask = pd.Series([True] * len(frame), index=frame.index)
        eligible_series = series[eligible_mask]
        observed = int(eligible_series.map(_is_observed).sum())
        eligible = int(eligible_mask.sum())
        rows.append(
            {
                "field": field,
                "eligible": eligible,
                "not_applicable": int(len(frame) - eligible),
                "observed": observed,
                "missing": int(eligible - observed),
                "missing_percent": round(100 * (eligible - observed) / eligible, 2)
                if eligible
                else 0.0,
                "unique_observed_values": int(
                    eligible_series[eligible_series.map(_is_observed)].astype(str).nunique()
                ),
            }
        )
    return pd.DataFrame(rows)


def _association_table(
    values: Sequence[Mapping[str, object]],
    groups: Mapping[str, List[str]],
    intervals: Sequence[Mapping[str, str]],
    *,
    minimum_cell_size: int,
) -> pd.DataFrame:
    labeled = [row for row in values if row.get("decision_outcome") in VALID_DECISIONS]
    rows: List[Mapping[str, object]] = []
    for field in groups["categorical"]:
        rows.extend(_categorical_associations(labeled, field, False, minimum_cell_size))
    for field in groups["multi_select"]:
        rows.extend(_categorical_associations(labeled, field, True, minimum_cell_size))
    numeric_fields = groups["numeric"] + [interval["name"] for interval in intervals]
    for field in numeric_fields:
        rows.append(_numeric_association(labeled, field, minimum_cell_size))
    columns = [
        "field",
        "value",
        "analysis",
        "observed_n",
        "accepted_n",
        "declined_n",
        "effect",
        "ci_95_low",
        "ci_95_high",
        "p_value",
        "q_value_bh",
        "suppressed",
        "interpretation_limit",
    ]
    frame = pd.DataFrame(rows)
    if frame.empty:
        return pd.DataFrame(columns=columns)
    frame["q_value_bh"] = _benjamini_hochberg(frame["p_value"])
    return frame[columns]


def _categorical_associations(
    rows: Sequence[Mapping[str, object]],
    field: str,
    multi_select: bool,
    minimum_cell_size: int,
) -> List[Mapping[str, object]]:
    observed = [row for row in rows if _is_observed(row.get(field))]
    categories = sorted(
        {
            category
            for row in observed
            for category in (
                row[field] if multi_select and isinstance(row[field], list) else [row[field]]
            )
            if category
        }
    )
    output: List[Mapping[str, object]] = []
    for category in categories:
        def category_present(row: Mapping[str, object]) -> bool:
            value = row[field]
            if multi_select:
                return isinstance(value, list) and category in value
            return value == category

        present = [row for row in observed if category_present(row)]
        absent = [row for row in observed if not category_present(row)]
        a = sum(row["decision_outcome"] == "accepted" for row in present)
        b = sum(row["decision_outcome"] == "declined" for row in present)
        c = sum(row["decision_outcome"] == "accepted" for row in absent)
        d = sum(row["decision_outcome"] == "declined" for row in absent)
        suppressed = min(a, b, c, d) < minimum_cell_size
        odds_ratio = low = high = p_value = None
        if not suppressed:
            odds_ratio, p_value = fisher_exact([[a, b], [c, d]])
            corrected = [float(value) for value in (a, b, c, d)]
            if any(value == 0 for value in corrected):
                corrected = [value + 0.5 for value in corrected]
            corrected_or = corrected[0] * corrected[3] / (corrected[1] * corrected[2])
            standard_error = math.sqrt(sum(1.0 / value for value in corrected))
            low = math.exp(math.log(corrected_or) - 1.96 * standard_error)
            high = math.exp(math.log(corrected_or) + 1.96 * standard_error)
            if not math.isfinite(float(odds_ratio)):
                odds_ratio = corrected_or
        output.append(
            {
                "field": field,
                "value": category,
                "analysis": "one_vs_rest_odds_of_accepted",
                "observed_n": len(observed),
                "accepted_n": None if suppressed else a,
                "declined_n": None if suppressed else b,
                "effect": _rounded(odds_ratio),
                "ci_95_low": _rounded(low),
                "ci_95_high": _rounded(high),
                "p_value": _rounded(p_value),
                "suppressed": suppressed,
                "interpretation_limit": "Unadjusted association; not causal or decision guidance.",
            }
        )
    return output


def _numeric_association(
    rows: Sequence[Mapping[str, object]], field: str, minimum_cell_size: int
) -> Mapping[str, object]:
    accepted = [float(row[field]) for row in rows if row.get("decision_outcome") == "accepted" and _is_observed(row.get(field))]
    declined = [float(row[field]) for row in rows if row.get("decision_outcome") == "declined" and _is_observed(row.get(field))]
    suppressed = min(len(accepted), len(declined)) < minimum_cell_size
    effect = low = high = p_value = None
    value = ""
    if not suppressed:
        statistic, p_value = mannwhitneyu(accepted, declined, alternative="two-sided")
        effect = 2 * float(statistic) / (len(accepted) * len(declined)) - 1
        value = f"accepted_median={np.median(accepted):.3f};declined_median={np.median(declined):.3f}"
    return {
        "field": field,
        "value": value,
        "analysis": "rank_biserial_accepted_vs_declined",
        "observed_n": len(accepted) + len(declined),
        "accepted_n": None if suppressed else len(accepted),
        "declined_n": None if suppressed else len(declined),
        "effect": _rounded(effect),
        "ci_95_low": low,
        "ci_95_high": high,
        "p_value": _rounded(p_value),
        "suppressed": suppressed,
        "interpretation_limit": "Unadjusted association; confidence interval deferred to full grouped evaluation.",
    }


def _readiness_gates(
    snapshots: pd.DataFrame,
    profile: pd.DataFrame,
    contract: Mapping[str, object],
) -> Mapping[str, bool]:
    thresholds = _mapping(contract["readiness_thresholds"])
    outcomes = snapshots["decision_outcome"].value_counts().to_dict()
    months = snapshots["signed_month"].replace("", np.nan).dropna().nunique()
    communities = snapshots["audit__community"].replace("", np.nan).dropna().nunique()
    maximum_missing = float(thresholds["maximum_core_field_missingness"]) * 100
    core_fields = set(_string_list(contract.get("core_fields")))
    core_profile = profile[profile["field"].isin(core_fields)]
    return {
        "enough_signed_episodes": len(snapshots) >= int(thresholds["minimum_signed_episodes"]),
        "enough_per_decision_outcome": all(
            int(outcomes.get(outcome, 0)) >= int(thresholds["minimum_per_decision_outcome"])
            for outcome in VALID_DECISIONS
        ),
        "enough_calendar_months": int(months) >= int(thresholds["minimum_calendar_months"]),
        "enough_communities": int(communities) >= int(thresholds["minimum_communities"]),
        "core_missingness_within_limit": bool(
            not core_profile.empty and core_profile["missing_percent"].le(maximum_missing).all()
        ),
        "ready_for_user_facing_assistance": False,
    }


def _predictor_groups(contract: Mapping[str, object]) -> Mapping[str, List[str]]:
    groups = _mapping(contract["structured_predictors"])
    return {
        name: _string_list(groups.get(name))
        for name in ("categorical", "multi_select", "numeric")
    }


def _interval_definitions(contract: Mapping[str, object]) -> List[Mapping[str, str]]:
    groups = _mapping(contract["structured_predictors"])
    raw = groups.get("derived_intervals", [])
    if not isinstance(raw, list):
        raise ProspectiveContractError("derived_intervals must be an array")
    intervals: List[Mapping[str, str]] = []
    for item in raw:
        if not isinstance(item, dict) or not all(
            isinstance(item.get(key), str) and item[key] for key in ("name", "start_field", "end_field")
        ):
            raise ProspectiveContractError("Each derived interval needs name, start_field, and end_field")
        intervals.append({key: str(item[key]) for key in ("name", "start_field", "end_field")})
    return intervals


def _conditional_activation(
    contract: Mapping[str, object],
) -> Mapping[str, Mapping[str, object]]:
    raw = _mapping(contract.get("conditional_activation", {}))
    rules: Dict[str, Mapping[str, object]] = {}
    for field, value in raw.items():
        rule = _mapping(value)
        parent = rule.get("field")
        values = rule.get("values")
        if not isinstance(parent, str) or not parent or not isinstance(values, list):
            raise ProspectiveContractError(
                f"Conditional activation for {field} needs field and values"
            )
        _string_list(values)
        rules[str(field)] = rule
    return rules


def _derived_days(start: object, end: object) -> Tuple[int | None, bool]:
    start_date = _optional_date(start)
    end_date = _optional_date(end)
    if start_date is None or end_date is None:
        return None, False
    days = (end_date - start_date).days
    if days < 0:
        return None, True
    return days, False


def _optional_date(value: object) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _timestamp(value: object, field: str, row_number: int) -> datetime:
    text = str(value or "").strip()
    if not text:
        raise ProspectiveContractError(f"Row {row_number} is missing {field}")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ProspectiveContractError(f"Row {row_number} has invalid {field}") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _normalized_category(value: object) -> str | None:
    text = str(value or "").strip().lower()
    return text or None


def _normalized_multi(value: object, field: str, row_number: int) -> List[str]:
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ProspectiveContractError(f"Row {row_number} field {field} must be an array")
    return sorted({str(item).strip().lower() for item in value if str(item).strip()})


def _normalized_number(value: object, field: str, row_number: int) -> float | int | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        raise ProspectiveContractError(f"Row {row_number} field {field} must be numeric")
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ProspectiveContractError(f"Row {row_number} field {field} must be numeric") from error
    if not math.isfinite(number):
        raise ProspectiveContractError(f"Row {row_number} field {field} must be finite")
    return int(number) if number.is_integer() else number


def _optional_nonnegative_number(
    value: object, field: str, row_number: int
) -> float | int | None:
    number = _normalized_number(value, field, row_number)
    if number is not None and number < 0:
        raise ProspectiveContractError(f"Row {row_number} field {field} cannot be negative")
    return number


def _has_provenance(value: object) -> bool:
    return isinstance(value, list) and any(isinstance(item, dict) for item in value)


def _extraction_edit_rate(provenance: Mapping[str, object]) -> float | None:
    reviewed = 0
    edited = 0
    for entries in provenance.values():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            status = str(entry.get("review_status", "")).strip().lower()
            if status in {"accepted", "edited", "rejected"}:
                reviewed += 1
                edited += int(status == "edited")
    return round(edited / reviewed, 6) if reviewed else None


def _is_observed(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


def _audit_text(
    audit: Mapping[str, object],
    row: Mapping[str, object],
    data: Mapping[str, object],
    key: str,
) -> str:
    return str(audit.get(key, row.get(key, data.get(key, ""))) or "").strip()


def _required_text(row: Mapping[str, object], key: str, row_number: int) -> str:
    value = str(row.get(key, "") or "").strip()
    if not value:
        raise ProspectiveContractError(f"Row {row_number} is missing {key}")
    return value


def _positive_integer(value: object, key: str, row_number: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ProspectiveContractError(f"Row {row_number} {key} must be a positive integer") from error
    if parsed < 1:
        raise ProspectiveContractError(f"Row {row_number} {key} must be a positive integer")
    return parsed


def _object_row(value: object, line_number: int) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise ProspectiveContractError(f"Export row {line_number} must be a JSON object")
    return value


def _mapping(value: object) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise ProspectiveContractError("Prospective contract contains an invalid object")
    return value


def _string_list(value: object) -> List[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ProspectiveContractError("Prospective contract contains an invalid string list")
    return list(value)


def _group_hash(value: str) -> str:
    return hashlib.sha256(f"pipeline-prospective-v1:{value}".encode("utf-8")).hexdigest()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _rounded(value: object) -> float | None:
    if value is None:
        return None
    number = float(value)
    return round(number, 6) if math.isfinite(number) else None


def _benjamini_hochberg(values: pd.Series) -> pd.Series:
    adjusted = pd.Series([np.nan] * len(values), index=values.index, dtype=float)
    observed = values.dropna().astype(float).sort_values()
    if observed.empty:
        return adjusted
    total = len(observed)
    running_minimum = 1.0
    for rank_from_end, (index, p_value) in enumerate(reversed(list(observed.items())), start=1):
        rank = total - rank_from_end + 1
        candidate = min(1.0, p_value * total / rank)
        running_minimum = min(running_minimum, candidate)
        adjusted.loc[index] = round(running_minimum, 6)
    return adjusted
