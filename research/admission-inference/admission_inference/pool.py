from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Mapping, MutableMapping, Sequence

import pandas as pd

from .contracts import LEAKAGE_PATTERNS, deidentify_predictor_text
from .features import CLINICAL_SIGNAL_PATTERNS


STATUS_PATTERNS: Sequence[tuple[str, re.Pattern[str]]] = (
    ("admitted", re.compile(r"(?:\u2705\s*){0,2}\badmitted\b", re.IGNORECASE)),
    ("denied", re.compile(r"\b(?:denied|rejected)\b", re.IGNORECASE)),
    (
        "pending",
        re.compile(r"\b(?:pending interview|pending|waitlist(?:ed)?)\b", re.IGNORECASE),
    ),
)

MONTHS: Mapping[str, int] = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}

GENERIC_NAME_TOKENS = {
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
    "referral",
    "san",
    "santa",
    "turlock",
    "unknown",
    "victoria",
}

EVIDENCE_PATTERNS: Mapping[str, re.Pattern[str]] = {
    "source_attributed": re.compile(
        r"\b(?:client|patient|resident)\s+(?:reports?|states?|denies?|endorses?)\b|"
        r"\b(?:per|according to)\s+(?:cm|staff|records?|collateral|family)\b|"
        r"\bobserved\b",
        re.IGNORECASE,
    ),
    "time_bounded": re.compile(
        r"\b(?:currently|recent(?:ly)?|today|yesterday|last|past|daily|weekly|monthly|"
        r"for\s+\d+|\d+\s+(?:day|week|month|year)s?\b)",
        re.IGNORECASE,
    ),
    "frequency_or_severity": re.compile(
        r"\b(?:once|twice|daily|weekly|monthly|frequent(?:ly)?|occasional(?:ly)?|"
        r"mild|moderate|severe|\d+\s*(?:x|times?|hours?))\b",
        re.IGNORECASE,
    ),
    "support_level": re.compile(
        r"\b(?:independent(?:ly)?|requires?|needs?|with\s+(?:minimal|moderate|maximum)|"
        r"one[- ]person|two[- ]person|standby|assist(?:ance|ed)?)\b",
        re.IGNORECASE,
    ),
    "protective_or_strength": re.compile(
        r"\b(?:cooperative|engaged|calm|redirectable|supportive|strength|insight|"
        r"adherent|compliant|motivated|stable)\b",
        re.IGNORECASE,
    ),
}


@dataclass(frozen=True)
class SourceStatus:
    state: str
    label: str


@dataclass(frozen=True)
class AdmissionAlignment:
    aligned: bool
    admit_date: str
    month_delta: int | None


def _normalize_space(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _source_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def iter_ndjson(path: Path) -> Iterator[dict[str, object]]:
    with path.open(encoding="utf-8", errors="replace") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"Invalid NDJSON at {path}:{line_number}: {error}") from error
            if not isinstance(value, dict):
                raise ValueError(f"Expected an object at {path}:{line_number}")
            yield value


def extract_source_status(text: str) -> SourceStatus:
    tail = str(text or "")[-1200:]
    section_index = tail.upper().rfind("SECTION")
    status_region = tail[section_index:] if section_index >= 0 else tail
    hits: List[tuple[int, str, str]] = []
    for state, pattern in STATUS_PATTERNS:
        for match in pattern.finditer(status_region):
            hits.append((match.start(), state, _normalize_space(match.group(0))))
    if not hits:
        return SourceStatus(state="unlabeled", label="")
    _, state, label = max(hits, key=lambda item: item[0])
    return SourceStatus(state=state, label=label)


def extract_assessment_summary(text: str) -> str:
    source = str(text or "")
    summary_matches = list(re.finditer(r"(?im)^\s*Summary\s*$", source))
    if not summary_matches:
        return ""
    start = summary_matches[-1].end()
    remainder = source[start:]
    end = re.search(r"(?im)^\s*Interview\s*$", remainder)
    if not end:
        return ""
    return _normalize_space(remainder[: end.start()])


def infer_community(project_name: str) -> str:
    lowered = str(project_name or "").lower()
    if "ahmsc" in lowered or "santa clarita" in lowered:
        return "Santa Clarita"
    if "jcwh" in lowered or "jc wallace" in lowered:
        return "JC Wallace House"
    if "san pablo" in lowered:
        return "San Pablo"
    if "turlock" in lowered:
        return "Turlock"
    if "victoria" in lowered:
        return "Victoria's Place"
    return "Other/unknown"


def infer_period(project_name: str) -> str:
    lowered = str(project_name or "").lower()
    month = next((number for token, number in MONTHS.items() if token in lowered), 0)
    long_year = re.search(r"\b(20\d{2})\b", lowered)
    short_year = re.match(r"\s*(2\d)\b", lowered)
    trailing_year = re.search(r"\b(2\d)'", lowered)
    if long_year:
        year = int(long_year.group(1))
    elif short_year:
        year = 2000 + int(short_year.group(1))
    elif trailing_year:
        year = 2000 + int(trailing_year.group(1))
    else:
        year = 0
    if not year:
        return ""
    return f"{year:04d}-{month:02d}" if month else f"{year:04d}"


def _period_ordinal(period: str) -> int:
    match = re.fullmatch(r"(20\d{2})-(\d{2})", str(period or ""))
    if not match:
        return 0
    return int(match.group(1)) * 12 + int(match.group(2))


def _date_period_ordinal(value: object) -> int:
    match = re.match(r"(20\d{2})-(\d{2})", str(value or ""))
    if not match:
        return 0
    return int(match.group(1)) * 12 + int(match.group(2))


def _name_identity(canvas_name: str) -> str:
    prefix = re.split(
        r"\s*(?:\(|--|\s+-\s+|\d{1,2}[/-]\d{1,2}|\b20\d{2}\b)",
        str(canvas_name or ""),
        maxsplit=1,
    )[0]
    tokens = [
        token.lower()
        for token in re.findall(r"[A-Za-z][A-Za-z'-]+", prefix)[:5]
        if len(token) >= 2 and token.lower() not in GENERIC_NAME_TOKENS
    ]
    normalized = " ".join(tokens) or _normalize_space(canvas_name).lower()
    return f"namehash:{_sha256_text(normalized)[:24]}"


def _clinical_domains(text: str) -> List[str]:
    return [
        name
        for name, patterns in CLINICAL_SIGNAL_PATTERNS.items()
        if any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns)
    ]


def _evidence_features(text: str) -> List[str]:
    return [name for name, pattern in EVIDENCE_PATTERNS.items() if pattern.search(text)]


def _word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", text))


def _load_links(path: Path) -> Dict[str, dict[str, object]]:
    return {
        str(row.get("source_canvas_id") or row.get("source_record_id") or ""): row
        for row in iter_ndjson(path)
        if row.get("source_canvas_id") or row.get("source_record_id")
    }


def _load_clients(path: Path) -> Dict[str, dict[str, object]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    clients = payload.get("clients", []) if isinstance(payload, dict) else []
    return {
        str(client.get("canonical_client_id")): client
        for client in clients
        if isinstance(client, dict) and client.get("canonical_client_id")
    }


def find_admission_alignment(
    canonical_client_id: str,
    community: str,
    source_period: str,
    clients: Mapping[str, dict[str, object]],
) -> AdmissionAlignment:
    source_ordinal = _period_ordinal(source_period)
    client = clients.get(canonical_client_id)
    if not client or not source_ordinal or community == "Other/unknown":
        return AdmissionAlignment(False, "", None)
    history = client.get("existing_history", {})
    episodes = history.get("episodes", []) if isinstance(history, dict) else []
    candidates: List[tuple[int, str]] = []
    for episode in episodes:
        if not isinstance(episode, dict) or episode.get("community") != community:
            continue
        admit_date = str(episode.get("admit_date") or "")[:10]
        admit_ordinal = _date_period_ordinal(admit_date)
        if not admit_ordinal:
            continue
        candidates.append((abs(source_ordinal - admit_ordinal), admit_date))
    if not candidates:
        return AdmissionAlignment(False, "", None)
    delta, admit_date = min(candidates)
    return AdmissionAlignment(delta <= 1, admit_date, delta)


def _quality_score(
    word_count: int,
    domains: Sequence[str],
    evidence: Sequence[str],
    alignment: AdmissionAlignment,
) -> float:
    useful_length = min(word_count, 300) / 10
    return round(
        useful_length
        + len(domains) * 10
        + len(evidence) * 5
        + (15 if alignment.aligned else 0),
        1,
    )


def _tier_and_reason(
    *,
    status: SourceStatus,
    note: str,
    domains: Sequence[str],
    leakage: Sequence[str],
    alignment: AdmissionAlignment,
    is_seed: bool,
) -> tuple[str, str, bool]:
    if is_seed:
        return "A", "retained_from_prior_high_quality_cohort", True
    if status.state not in {"admitted", "denied"}:
        return "C", "outcome_not_explicit", False
    if not note:
        return "C", "assessment_summary_not_captured", False
    if leakage:
        return "C", "disposition_language_in_predictor_text", False
    if status.state == "admitted" and not alignment.aligned:
        return "C", "admission_episode_not_aligned", False
    words = _word_count(note)
    if words >= 30 and len(domains) >= 2:
        return "A", "model_candidate_pending_human_review", True
    if words >= 15 and len(domains) >= 1:
        return "B", "usable_after_targeted_human_review", False
    return "C", "narrative_too_sparse_for_modeling", False


def _seed_rows(path: Path | None) -> Dict[str, dict[str, str]]:
    if not path:
        return {}
    with path.open(newline="", encoding="utf-8-sig") as source:
        return {
            str(row.get("source_canvas_id") or ""): dict(row)
            for row in csv.DictReader(source)
            if row.get("source_canvas_id")
        }


def build_referral_rows(
    *,
    canvas_content_path: Path,
    record_links_path: Path,
    client_history_path: Path,
    seed_cohort_path: Path | None,
) -> List[dict[str, object]]:
    links = _load_links(record_links_path)
    clients = _load_clients(client_history_path)
    seeds = _seed_rows(seed_cohort_path)
    rows: List[dict[str, object]] = []

    for source in iter_ndjson(canvas_content_path):
        canvas = source.get("canvas")
        if not isinstance(canvas, dict):
            continue
        source_canvas_id = str(canvas.get("id") or "")
        if not source_canvas_id:
            continue
        text = str(source.get("plain_text") or "")
        project = source.get("project") if isinstance(source.get("project"), dict) else {}
        project_name = str(project.get("name") or "")
        status = extract_source_status(text)
        note = extract_assessment_summary(text)
        source_canvas_name = str(canvas.get("name") or "")
        link = links.get(source_canvas_id, {})
        canonical_client_id = (
            str(link.get("canonical_client_id") or "")
            if link.get("canonical_link_status") == "confirmed"
            else ""
        )
        community = infer_community(project_name)
        source_period = infer_period(project_name)
        alignment = find_admission_alignment(
            canonical_client_id,
            community,
            source_period,
            clients,
        )
        domains = _clinical_domains(note)
        evidence = _evidence_features(note)
        predictor_text, mask_counts = deidentify_predictor_text(note, source_canvas_name)
        leakage = [
            name for name, pattern in LEAKAGE_PATTERNS.items() if pattern.search(predictor_text)
        ]
        seed = seeds.get(source_canvas_id)
        tier, reason, model_candidate = _tier_and_reason(
            status=status,
            note=note,
            domains=domains,
            leakage=leakage,
            alignment=alignment,
            is_seed=seed is not None,
        )
        if seed:
            predictor_text = seed.get("assessment_note_model_text", predictor_text)
            note_sha256 = seed.get("note_sha256", _sha256_text(predictor_text.lower()))
            note = seed.get("assessment_note_raw", note)
            status = SourceStatus(
                state=seed.get("outcome", status.state),
                label=seed.get("source_section", status.label),
            )
            community = seed.get("community", community)
            source_period = seed.get("source_period", source_period)
            alignment = AdmissionAlignment(
                aligned=bool(seed.get("episode_admit_date")),
                admit_date=seed.get("episode_admit_date", alignment.admit_date),
                month_delta=(
                    int(seed["episode_alignment_months"])
                    if seed.get("episode_alignment_months", "").isdigit()
                    else alignment.month_delta
                ),
            )
        else:
            note_sha256 = _sha256_text(_normalize_space(predictor_text).lower()) if note else ""

        source_hash = str(link.get("source_sha256") or "")
        if not source_hash:
            source_hash = _sha256_text(text)
        person_group_id = canonical_client_id or _name_identity(source_canvas_name)
        rows.append(
            {
                "source_canvas_id": source_canvas_id,
                "source_canvas_name": source_canvas_name,
                "source_project_id": str(canvas.get("project_id") or project.get("id") or ""),
                "source_project_name": project_name,
                "source_section": status.label,
                "workflow_state": status.state,
                "outcome": status.state if status.state in {"admitted", "denied"} else "",
                "community": community,
                "source_period": source_period,
                "person_group_id": person_group_id,
                "canonical_client_id": canonical_client_id,
                "canonical_link_status": str(link.get("canonical_link_status") or "unmatched"),
                "episode_admit_date": alignment.admit_date,
                "episode_alignment_months": (
                    "" if alignment.month_delta is None else alignment.month_delta
                ),
                "episode_aligned": "yes" if alignment.aligned else "no",
                "assessment_note_present": "yes" if note else "no",
                "word_count": _word_count(note),
                "clinical_domain_count": len(domains),
                "clinical_domains": ";".join(domains),
                "evidence_quality_count": len(evidence),
                "evidence_quality_features": ";".join(evidence),
                "identifier_masks_applied": sum(mask_counts.values()),
                "leakage_flags": ";".join(leakage),
                "quality_tier": tier,
                "pool_disposition": reason,
                "model_candidate": "yes" if model_candidate else "no",
                "seed_cohort_member": "yes" if seed else "no",
                "quality_score": _quality_score(
                    _word_count(note), domains, evidence, alignment
                ),
                "assessment_note_model_text": predictor_text,
                "assessment_note_raw": note,
                "source_sha256": source_hash,
                "note_sha256": note_sha256,
                "source_locator": str(canvas.get("url") or ""),
                "captured_at": str(source.get("captured_at") or ""),
            }
        )
    return rows


def _mark_duplicates(rows: List[dict[str, object]]) -> None:
    note_outcomes: MutableMapping[str, set[str]] = defaultdict(set)
    person_period_counts: Counter[tuple[str, str, str]] = Counter()
    for row in rows:
        note_hash = str(row.get("note_sha256") or "")
        outcome = str(row.get("outcome") or "")
        if note_hash and outcome:
            note_outcomes[note_hash].add(outcome)
        if outcome:
            person_period_counts[
                (
                    str(row.get("person_group_id") or ""),
                    str(row.get("source_period") or ""),
                    outcome,
                )
            ] += 1

    for row in rows:
        note_hash = str(row.get("note_sha256") or "")
        outcome = str(row.get("outcome") or "")
        row["cross_label_exact_note"] = (
            "yes" if note_hash and len(note_outcomes[note_hash]) > 1 else "no"
        )
        episode_key = (
            str(row.get("person_group_id") or ""),
            str(row.get("source_period") or ""),
            outcome,
        )
        row["possible_duplicate_episode"] = (
            "yes" if outcome and person_period_counts[episode_key] > 1 else "no"
        )
        if row["cross_label_exact_note"] == "yes":
            row["model_candidate"] = "no"
            row["quality_tier"] = "C"
            row["pool_disposition"] = "exact_note_has_conflicting_outcomes"


def _model_rows(rows: Sequence[dict[str, object]]) -> List[dict[str, object]]:
    selected = [row.copy() for row in rows if row.get("model_candidate") == "yes"]
    selected.sort(
        key=lambda row: (
            str(row.get("outcome") or ""),
            0 if row.get("seed_cohort_member") == "yes" else 1,
            -float(row.get("quality_score") or 0),
            str(row.get("source_canvas_id") or ""),
        )
    )
    outcome_ranks: Counter[str] = Counter()
    for index, row in enumerate(selected, start=1):
        outcome = str(row["outcome"])
        outcome_ranks[outcome] += 1
        row["cohort_id"] = f"EXP-{index:04d}"
        row["quality_rank_within_outcome"] = outcome_ranks[outcome]
        row["secondary_review_required"] = "yes"
        row["reason_evidence_available"] = "no"
        row["reason_evidence_candidates"] = ""
    return selected


def _review_rows(rows: Sequence[dict[str, object]]) -> List[dict[str, object]]:
    review = []
    for row in rows:
        if row.get("workflow_state") not in {"admitted", "denied"}:
            continue
        item = row.copy()
        item.update(
            {
                "annotation_status": "",
                "outcome_verified": "",
                "pre_decision_verified": "",
                "leakage_reviewed": "",
                "duplicate_reviewed": "",
                "reviewer_id": "",
                "reviewer_notes": "",
            }
        )
        review.append(item)
    return review


def _expansion_priority_rows(rows: Sequence[dict[str, object]]) -> List[dict[str, object]]:
    prioritized: List[dict[str, object]] = []
    for row in rows:
        if row.get("outcome") not in {"admitted", "denied"}:
            continue
        if row.get("model_candidate") == "yes":
            continue
        disposition = str(row.get("pool_disposition") or "")
        words = int(row.get("word_count") or 0)
        domains = int(row.get("clinical_domain_count") or 0)
        if row.get("quality_tier") == "B":
            priority = 1
            next_action = "verify outcome and pre-decision narrative"
        elif (
            disposition == "admission_episode_not_aligned"
            and words >= 30
            and domains >= 2
            and not row.get("leakage_flags")
        ):
            priority = 2
            next_action = "resolve identity, community, and admission episode alignment"
        elif (
            disposition == "disposition_language_in_predictor_text"
            and words >= 30
            and domains >= 2
        ):
            priority = 3
            next_action = "mark the pre-decision boundary and remove outcome language"
        elif disposition == "narrative_too_sparse_for_modeling" and words >= 10:
            priority = 4
            next_action = "review source canvas for additional assessment evidence"
        elif disposition == "exact_note_has_conflicting_outcomes" and words >= 30:
            priority = 5
            next_action = "resolve duplicate template or conflicting disposition"
        else:
            continue
        item = row.copy()
        item.update(
            {
                "review_priority": priority,
                "next_action": next_action,
                "annotation_status": "",
                "outcome_verified": "",
                "pre_decision_verified": "",
                "identity_verified": "",
                "reviewer_id": "",
                "reviewer_notes": "",
            }
        )
        prioritized.append(item)
    prioritized.sort(
        key=lambda row: (
            int(row["review_priority"]),
            -float(row.get("quality_score") or 0),
            str(row.get("source_canvas_id") or ""),
        )
    )
    return prioritized


def _write_csv(path: Path, rows: Sequence[dict[str, object]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    frame = pd.DataFrame(rows)
    frame.to_csv(path, index=False)


def _write_ndjson(path: Path, rows: Iterable[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8") as destination:
        for row in rows:
            destination.write(json.dumps(row, ensure_ascii=True, sort_keys=True) + "\n")


def build_expanded_pool(
    *,
    source_root: Path,
    output_directory: Path,
    seed_cohort_path: Path | None,
) -> dict[str, object]:
    canvas_path = source_root / "canvas-content.ndjson"
    links_path = source_root / "pipeline-canvas-content-record-links.ndjson"
    clients_path = source_root / "pipeline-client-history-with-allo-notes.json"
    missing = [path for path in (canvas_path, links_path, clients_path) if not path.is_file()]
    if missing:
        raise ValueError("Missing required source files: " + ", ".join(map(str, missing)))
    if output_directory.exists():
        raise ValueError(f"Output directory already exists: {output_directory}")

    rows = build_referral_rows(
        canvas_content_path=canvas_path,
        record_links_path=links_path,
        client_history_path=clients_path,
        seed_cohort_path=seed_cohort_path,
    )
    _mark_duplicates(rows)
    model_rows = _model_rows(rows)
    review_rows = _review_rows(rows)
    priority_rows = _expansion_priority_rows(rows)
    labeled_rows = [row for row in rows if row.get("outcome")]

    output_directory.mkdir(parents=True)
    _write_csv(output_directory / "all-referral-candidates.csv", rows)
    _write_ndjson(output_directory / "all-referral-candidates.ndjson", rows)
    _write_csv(output_directory / "outcome-labeled-referrals.csv", labeled_rows)
    _write_csv(output_directory / "model-ready-candidates.csv", model_rows)
    _write_csv(output_directory / "human-review-queue.csv", review_rows)
    _write_csv(output_directory / "next-expansion-review.csv", priority_rows)

    def counts_by(rows_to_count: Sequence[dict[str, object]], key: str) -> Dict[str, int]:
        return dict(sorted(Counter(str(row.get(key) or "blank") for row in rows_to_count).items()))

    report: dict[str, object] = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "data_class": "PHI-sensitive research data",
        "source_files": {
            "canvas_content": {"path": str(canvas_path), "sha256": _source_sha256(canvas_path)},
            "record_links": {"path": str(links_path), "sha256": _source_sha256(links_path)},
            "client_history": {"path": str(clients_path), "sha256": _source_sha256(clients_path)},
            "seed_cohort": (
                {"path": str(seed_cohort_path), "sha256": _source_sha256(seed_cohort_path)}
                if seed_cohort_path
                else None
            ),
        },
        "counts": {
            "all_canvas_records": len(rows),
            "outcome_labeled_records": len(labeled_rows),
            "model_ready_pending_human_review": len(model_rows),
            "human_review_queue": len(review_rows),
            "next_expansion_review": len(priority_rows),
            "seed_records_retained": sum(
                row.get("seed_cohort_member") == "yes" for row in model_rows
            ),
            "new_model_candidates": sum(
                row.get("seed_cohort_member") == "no" for row in model_rows
            ),
            "cross_label_exact_notes": sum(
                row.get("cross_label_exact_note") == "yes" for row in rows
            ),
            "possible_duplicate_episodes": sum(
                row.get("possible_duplicate_episode") == "yes" for row in labeled_rows
            ),
        },
        "workflow_states": counts_by(rows, "workflow_state"),
        "outcome_labeled_by_outcome": counts_by(labeled_rows, "outcome"),
        "model_candidates_by_outcome": counts_by(model_rows, "outcome"),
        "quality_tiers": counts_by(rows, "quality_tier"),
        "pool_dispositions": counts_by(rows, "pool_disposition"),
        "expansion_review_priorities": counts_by(priority_rows, "review_priority"),
        "communities": counts_by(labeled_rows, "community"),
        "safety": {
            "human_review_required": True,
            "decision_use_prohibited": True,
            "unlabeled_does_not_mean_denied": True,
            "model_candidate_is_not_model_approved": True,
            "group_splitting_required": True,
        },
    }
    (output_directory / "pool-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output_directory / "README.md").write_text(
        """# Expanded referral research pool

This directory is PHI-sensitive. It expands the referral evidence inventory without
treating missing or ambiguous outcomes as denials.

- `all-referral-candidates.csv` and `.ndjson`: every captured canvas with provenance.
- `outcome-labeled-referrals.csv`: canvases with an explicit admitted or denied state.
- `model-ready-candidates.csv`: Tier A candidates only; human verification is still required.
- `human-review-queue.csv`: all explicit outcomes with review fields.
- `next-expansion-review.csv`: highest-yield excluded records, ordered by corrective action.
- `pool-report.json`: aggregate counts, source fingerprints, and safety state.

Tier A means the record passed deterministic structural checks. It does not mean the
outcome, pre-decision boundary, identity match, or clinical interpretation is verified.
Tier B is potentially usable after targeted review. Tier C is retained for evidence
recovery, label verification, or exclusion analysis.
""",
        encoding="utf-8",
    )
    return report
