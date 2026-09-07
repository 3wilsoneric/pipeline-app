from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Sequence

import pandas as pd

from .config import ResearchConfig


REQUIRED_COLUMNS = {
    "cohort_id",
    "outcome",
    "person_group_id",
    "assessment_note_model_text",
    "community",
    "source_period",
    "note_sha256",
}

HUMAN_REVIEW_COLUMNS = {
    "annotation_status",
    "outcome_verified",
    "pre_decision_verified",
    "leakage_reviewed",
    "reviewer_id",
}

VALID_OUTCOMES = {"admitted", "denied"}

IDENTIFIER_PATTERNS: Mapping[str, re.Pattern[str]] = {
    "email": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    "phone": re.compile(r"(?<!\d)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)"),
    "url": re.compile(r"\b(?:https?://|www\.)\S+", re.IGNORECASE),
    "ssn": re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)"),
    "date": re.compile(
        r"(?<!\d)(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])(?:[/-](?:\d{2}|\d{4}))?(?!\d)"
    ),
}

TITLE_TOKEN_EXCLUSIONS = {
    "admission",
    "admissions",
    "ahmsc",
    "client",
    "county",
    "female",
    "house",
    "jcwh",
    "male",
    "pablo",
    "san",
    "santa",
    "turlock",
    "unknown",
    "victoria",
}

# These phrases reveal the final disposition rather than pre-decision evidence.
# Word boundaries deliberately avoid clinical phrases such as "client denies SI".
LEAKAGE_PATTERNS: Mapping[str, re.Pattern[str]] = {
    "admitted": re.compile(r"\b(?:was\s+)?admitted\b", re.IGNORECASE),
    "denied_outcome": re.compile(r"\b(?:was\s+)?denied\s+(?:admission|placement)\b", re.IGNORECASE),
    "rejected": re.compile(r"\brejected\s+(?:for|from|by)\b", re.IGNORECASE),
    "approved_for_admission": re.compile(r"\bapproved\s+for\s+admission\b", re.IGNORECASE),
    "not_approved": re.compile(r"\bnot\s+approved\s+(?:for\s+admission)?\b", re.IGNORECASE),
    "accepted_for_placement": re.compile(
        r"\baccepted\s+for\s+(?:admission|placement)\b", re.IGNORECASE
    ),
    "unable_to_accept": re.compile(r"\bunable\s+to\s+accept\b", re.IGNORECASE),
    "declined_admission": re.compile(r"\bdeclined\s+(?:the\s+)?admission\b", re.IGNORECASE),
}


class CohortValidationError(ValueError):
    """Raised when a cohort violates a modeling safety contract."""


@dataclass(frozen=True)
class ValidationReport:
    row_count: int
    outcome_counts: Dict[str, int]
    unique_groups: int
    duplicate_note_count: int
    human_review_complete: bool
    exploratory_unverified: bool
    source_sha256: str
    leakage_counts: Dict[str, int]
    identifier_mask_counts: Dict[str, int]
    groups_with_multiple_outcomes: int
    warnings: Sequence[str]

    def to_dict(self) -> Dict[str, object]:
        return {
            "row_count": self.row_count,
            "outcome_counts": self.outcome_counts,
            "unique_groups": self.unique_groups,
            "duplicate_note_count": self.duplicate_note_count,
            "human_review_complete": self.human_review_complete,
            "exploratory_unverified": self.exploratory_unverified,
            "source_sha256": self.source_sha256,
            "leakage_counts": self.leakage_counts,
            "identifier_mask_counts": self.identifier_mask_counts,
            "groups_with_multiple_outcomes": self.groups_with_multiple_outcomes,
            "warnings": list(self.warnings),
        }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _truthy(series: pd.Series) -> pd.Series:
    return series.astype(str).str.strip().str.lower().isin({"true", "1", "yes", "y"})


def human_review_complete(frame: pd.DataFrame) -> bool:
    if not HUMAN_REVIEW_COLUMNS.issubset(frame.columns):
        return False
    return bool(
        frame["annotation_status"].astype(str).str.strip().str.lower().eq("verified").all()
        and _truthy(frame["outcome_verified"]).all()
        and _truthy(frame["pre_decision_verified"]).all()
        and _truthy(frame["leakage_reviewed"]).all()
        and frame["reviewer_id"].fillna("").astype(str).str.strip().ne("").all()
    )


def _leakage_counts(texts: Iterable[str]) -> Dict[str, int]:
    counts = {name: 0 for name in LEAKAGE_PATTERNS}
    for text in texts:
        for name, pattern in LEAKAGE_PATTERNS.items():
            if pattern.search(text):
                counts[name] += 1
    return counts


def _title_name_tokens(value: str) -> List[str]:
    prefix = re.split(r"\s*(?:\(|--|\s+-\s+|\d{1,2}[/-]\d{1,2})", str(value or ""), maxsplit=1)[0]
    tokens = re.findall(r"[A-Za-z][A-Za-z'-]+", prefix)
    return [
        token
        for token in tokens[:4]
        if len(token) >= 3 and token.lower() not in TITLE_TOKEN_EXCLUSIONS
    ]


def deidentify_predictor_text(text: str, source_canvas_name: str = "") -> tuple[str, Dict[str, int]]:
    scrubbed = str(text or "")
    counts = {name: 0 for name in IDENTIFIER_PATTERNS}
    counts["source_name_token"] = 0
    for name, pattern in IDENTIFIER_PATTERNS.items():
        scrubbed, count = pattern.subn(f"[{name.upper()}]", scrubbed)
        counts[name] += count
    for token in _title_name_tokens(source_canvas_name):
        scrubbed, count = re.subn(
            rf"\b{re.escape(token)}\b",
            "[PERSON]",
            scrubbed,
            flags=re.IGNORECASE,
        )
        counts["source_name_token"] += count
    return scrubbed, counts


def load_and_validate_cohort(
    path: Path,
    config: ResearchConfig,
    *,
    exploratory_unverified: bool,
    require_review: bool,
) -> tuple[pd.DataFrame, ValidationReport]:
    if not path.is_file():
        raise CohortValidationError(f"Cohort file does not exist: {path}")

    frame = pd.read_csv(path, dtype=str, keep_default_na=False)
    missing = sorted(REQUIRED_COLUMNS.difference(frame.columns))
    if missing:
        raise CohortValidationError(f"Missing required columns: {', '.join(missing)}")

    frame = frame.copy()
    frame["outcome"] = frame["outcome"].str.strip().str.lower()
    unexpected = sorted(set(frame["outcome"]).difference(VALID_OUTCOMES))
    if unexpected:
        raise CohortValidationError(f"Unsupported outcomes: {', '.join(unexpected)}")

    empty_fields: List[str] = []
    for column in ("cohort_id", "person_group_id", "assessment_note_model_text", "note_sha256"):
        if frame[column].fillna("").str.strip().eq("").any():
            empty_fields.append(column)
    if empty_fields:
        raise CohortValidationError(f"Blank required values in: {', '.join(empty_fields)}")

    if frame["cohort_id"].duplicated().any():
        raise CohortValidationError("cohort_id must be unique per referral episode")

    outcome_counts = frame["outcome"].value_counts().to_dict()
    if len(frame) < config.minimum_rows:
        raise CohortValidationError(
            f"Cohort has {len(frame)} rows; at least {config.minimum_rows} are required"
        )
    for outcome in sorted(VALID_OUTCOMES):
        count = int(outcome_counts.get(outcome, 0))
        if count < config.minimum_rows_per_outcome:
            raise CohortValidationError(
                f"Outcome {outcome!r} has {count} rows; "
                f"at least {config.minimum_rows_per_outcome} are required"
            )

    hash_outcomes = frame.groupby("note_sha256")["outcome"].nunique()
    cross_label_hashes = hash_outcomes[hash_outcomes > 1]
    if not cross_label_hashes.empty:
        raise CohortValidationError(
            f"{len(cross_label_hashes)} exact note hashes appear under conflicting outcomes"
        )

    aggregate_mask_counts = {name: 0 for name in IDENTIFIER_PATTERNS}
    aggregate_mask_counts["source_name_token"] = 0
    predictor_texts: List[str] = []
    source_names = (
        frame["source_canvas_name"].astype(str)
        if "source_canvas_name" in frame.columns
        else pd.Series([""] * len(frame), index=frame.index)
    )
    for text, source_name in zip(frame["assessment_note_model_text"].astype(str), source_names):
        scrubbed, mask_counts = deidentify_predictor_text(text, source_name)
        predictor_texts.append(scrubbed)
        for name, count in mask_counts.items():
            aggregate_mask_counts[name] += count
    frame["model_input_text"] = predictor_texts

    leakage_counts = _leakage_counts(frame["model_input_text"].astype(str))
    leakage_total = sum(leakage_counts.values())
    if leakage_total:
        summary = ", ".join(
            f"{name}={count}" for name, count in leakage_counts.items() if count
        )
        raise CohortValidationError(
            f"Known final-outcome language remains in predictor text: {summary}"
        )

    review_complete = human_review_complete(frame)
    if require_review and not review_complete and not exploratory_unverified:
        raise CohortValidationError(
            "Human verification is incomplete. Complete the review columns or rerun "
            "with --exploratory-unverified for a clearly labeled research-only run."
        )

    warnings: List[str] = []
    if not review_complete:
        warnings.append("Source outcomes and pre-decision timing are not human verified.")
    duplicate_notes = int(frame["note_sha256"].duplicated().sum())
    if duplicate_notes:
        warnings.append("Duplicate note hashes remain within an outcome and are group-controlled.")
    if frame["person_group_id"].nunique() < len(frame):
        warnings.append("Multiple episodes exist for at least one person; grouped splitting is mandatory.")
    group_outcome_counts = frame.groupby("person_group_id")["outcome"].nunique()
    groups_with_multiple_outcomes = int((group_outcome_counts > 1).sum())
    if groups_with_multiple_outcomes:
        warnings.append(
            "At least one person group has episodes under both outcomes; verify linkage and episode timing."
        )

    report = ValidationReport(
        row_count=len(frame),
        outcome_counts={key: int(value) for key, value in outcome_counts.items()},
        unique_groups=int(frame["person_group_id"].nunique()),
        duplicate_note_count=duplicate_notes,
        human_review_complete=review_complete,
        exploratory_unverified=exploratory_unverified and not review_complete,
        source_sha256=_sha256(path),
        leakage_counts=leakage_counts,
        identifier_mask_counts=aggregate_mask_counts,
        groups_with_multiple_outcomes=groups_with_multiple_outcomes,
        warnings=warnings,
    )
    return frame, report
