from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Mapping

import pandas as pd

from .config import ResearchConfig
from .contracts import ValidationReport


def _git_commit(repository_root: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repository_root,
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else "unavailable"


def _working_tree_dirty(repository_root: Path) -> bool:
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=repository_root,
        check=False,
        capture_output=True,
        text=True,
    )
    return bool(result.stdout.strip()) if result.returncode == 0 else True


def _research_code_sha256(repository_root: Path) -> str:
    root = repository_root / "research" / "admission-inference"
    digest = hashlib.sha256()
    included_suffixes = {".py", ".json", ".txt", ".md", ".sh"}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or ".venv" in path.parts or "__pycache__" in path.parts:
            continue
        if path.suffix not in included_suffixes:
            continue
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _format_metric(value: object) -> str:
    if value is None:
        return "not evaluable"
    if isinstance(value, (int, float)):
        return f"{float(value):.3f}"
    return str(value)


def write_run_artifacts(
    *,
    output_directory: Path,
    repository_root: Path,
    validation: ValidationReport,
    config: ResearchConfig,
    evaluation: Mapping[str, object],
    predictions: pd.DataFrame,
) -> None:
    run_metadata: Dict[str, object] = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "research_only": True,
        "production_use_permitted": False,
        "candidate_commit": _git_commit(repository_root),
        "working_tree_dirty": _working_tree_dirty(repository_root),
        "research_code_sha256": _research_code_sha256(repository_root),
        "cohort_sha256": validation.source_sha256,
        "human_review_complete": validation.human_review_complete,
        "exploratory_unverified": validation.exploratory_unverified,
        "positive_class": "admitted",
        "row_count": validation.row_count,
    }
    (output_directory / "run.json").write_text(
        json.dumps(run_metadata, indent=2, sort_keys=True), encoding="utf-8"
    )
    (output_directory / "data-quality.json").write_text(
        json.dumps(validation.to_dict(), indent=2, sort_keys=True), encoding="utf-8"
    )
    (output_directory / "metrics.json").write_text(
        json.dumps(evaluation, indent=2, sort_keys=True), encoding="utf-8"
    )
    predictions.to_csv(output_directory / "oof-predictions.csv", index=False)

    models = evaluation["models"]
    primary = models["combined"]
    process_control = models["process_negative_control"]
    primary_metrics = primary["metrics"]
    process_metrics = process_control["metrics"]
    gates = evaluation["interpretation_gates"]
    review_status = (
        "Human review gate passed."
        if validation.human_review_complete
        else "UNVERIFIED EXPLORATORY RUN: source outcomes and pre-decision timing require review."
    )
    code_fingerprint = str(run_metadata["research_code_sha256"])
    dirty_status = "yes" if run_metadata["working_tree_dirty"] else "no"
    model_card = f"""# Pipeline Admission Inference Model Card

## Status

**Research only. Not approved for clinical or operational use.**

Deployment gate: **{str(gates['deployment_status']).upper()}**

{review_status}

This artifact evaluates associations in a selected historical cohort. It must not
be used to accept, deny, rank, prioritize, or discourage a referral.

## Intended use

- Study whether pre-decision assessment documentation contains reproducible signal.
- Identify documentation and workflow confounding.
- Design a future supervisor-facing evidence review in prospective shadow mode.

## Prohibited use

- Automated or assisted admission decisions.
- Individual risk scores shown to assessors or supervisors.
- Reuse outside the reviewed population, period, and communities.
- Any deployment before independent clinical, privacy, fairness, and legal review.

## Data

- Rows: {validation.row_count}
- Unique people/groups: {validation.unique_groups}
- Person groups with episodes under both outcomes: {validation.groups_with_multiple_outcomes}
- Cohort SHA-256: `{validation.source_sha256}`
- Research-code SHA-256: `{code_fingerprint}`
- Repository working tree dirty at run time: {dirty_status}
- Positive class: admitted
- Labels: {review_status}

The cohort intentionally selects high-information examples and is not prevalence
representative. Predictive values in this evaluation therefore do not estimate
real-world predictive values.

## Pre-specified primary baseline

The primary baseline combines word and character TF-IDF with deterministic
clinical-domain indicators, regularized logistic regression, nested person-grouped
cross-validation, and fold-local sigmoid calibration. The text component uses an
elastic-net linear logistic classifier.

- ROC AUC: {_format_metric(primary_metrics.get('roc_auc'))}
- Average precision: {_format_metric(primary_metrics.get('average_precision'))}
- Brier score: {_format_metric(primary_metrics.get('brier_score'))}
- Balanced accuracy at 0.5: {_format_metric(primary_metrics.get('balanced_accuracy'))}
- Calibration slope: {_format_metric(primary_metrics.get('calibration_slope'))}

These are internal exploratory estimates, not evidence of clinical validity.

## Confounding control

The process-only negative control uses note length, source period, and community.
Its ROC AUC is {_format_metric(process_metrics.get('roc_auc'))}. Material performance
from this control is evidence that workflow or cohort construction may explain part
of the apparent signal.

Process-confounding gate: **{str(gates['process_confounding']['status']).upper()}**

Temporal-validation gate: **{str(gates['temporal_validation']['status']).upper()}**

Community-transportability gate: **{str(gates['community_transportability']['status']).upper()}**

## Validation performed

- Nested stratified group cross-validation by person.
- Grouped bootstrap 95% confidence intervals.
- Calibration and abstention/coverage reporting.
- Community subgroup reporting.
- Leave-one-community-out evaluation when sample size permits.
- Chronological holdout when sample size permits.
- Exact-note cross-label conflict and known decision-language leakage gates.

## Known limitations

- Only 200 deliberately selected high-information episodes.
- Historical source outcomes and pre-decision timing may remain unverified.
- Denial reasons are incomplete and heterogeneous.
- Community, time, documentation style, and source workflow are confounders.
- Demographic fairness cannot be evaluated from this research export.
- Text-model vocabulary may retain sensitive terms and must be treated as PHI.
- Deterministic identifier masking is applied, but it is not a deidentification certification.
- No prospective, silent, external, or clinical-impact validation has occurred.

## Required next evidence

1. Complete outcome, timing, and leakage review for every episode.
2. Independently review the designated second-review subset.
3. Resolve duplicate-person and master-record linkage uncertainty.
4. Add structured disposition-reason labels and exact evidence spans.
5. Repeat validation on a prevalence-representative temporal holdout.
6. Run prospectively in silent shadow mode with no recommendations exposed.
7. Obtain clinical, privacy, fairness, security, and legal approval before any use.
"""
    (output_directory / "model-card.md").write_text(model_card, encoding="utf-8")
