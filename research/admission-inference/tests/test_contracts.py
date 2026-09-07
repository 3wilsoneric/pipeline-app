from pathlib import Path

import pandas as pd
import pytest

from admission_inference.config import ResearchConfig
from admission_inference.contracts import (
    CohortValidationError,
    deidentify_predictor_text,
    load_and_validate_cohort,
)


def config() -> ResearchConfig:
    return ResearchConfig(
        random_seed=7,
        outer_splits=2,
        inner_splits=2,
        bootstrap_iterations=20,
        minimum_rows=4,
        minimum_rows_per_outcome=2,
        minimum_subgroup_rows=2,
        minimum_subgroup_rows_per_outcome=1,
        abstention_thresholds=(0.5, 0.7),
    )


def cohort() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "cohort_id": ["a1", "a2", "d1", "d2"],
            "outcome": ["admitted", "admitted", "denied", "denied"],
            "person_group_id": ["p1", "p2", "p3", "p4"],
            "assessment_note_model_text": [
                "Client reports stable sleep and takes medication.",
                "Client is oriented and independently ambulatory.",
                "Client reports recent aggression and needs support.",
                "Client describes current substance use and hallucinations.",
            ],
            "community": ["A", "B", "A", "B"],
            "source_period": ["2026 Jan", "2026 Jan", "2026 Feb", "2026 Feb"],
            "note_sha256": ["h1", "h2", "h3", "h4"],
        }
    )


def write(frame: pd.DataFrame, tmp_path: Path) -> Path:
    path = tmp_path / "cohort.csv"
    frame.to_csv(path, index=False)
    return path


def test_unreviewed_training_requires_explicit_exploratory_flag(tmp_path: Path) -> None:
    with pytest.raises(CohortValidationError, match="Human verification is incomplete"):
        load_and_validate_cohort(
            write(cohort(), tmp_path),
            config(),
            exploratory_unverified=False,
            require_review=True,
        )


def test_exploratory_flag_labels_unreviewed_data(tmp_path: Path) -> None:
    _, report = load_and_validate_cohort(
        write(cohort(), tmp_path),
        config(),
        exploratory_unverified=True,
        require_review=True,
    )
    assert report.exploratory_unverified is True
    assert report.human_review_complete is False


def test_final_outcome_language_is_rejected(tmp_path: Path) -> None:
    frame = cohort()
    frame.loc[0, "assessment_note_model_text"] = "Client was approved for admission."
    with pytest.raises(CohortValidationError, match="final-outcome language"):
        load_and_validate_cohort(
            write(frame, tmp_path),
            config(),
            exploratory_unverified=True,
            require_review=True,
        )


def test_clinical_denial_language_is_not_mistaken_for_outcome(tmp_path: Path) -> None:
    frame = cohort()
    frame.loc[0, "assessment_note_model_text"] = "Client denies SI and HI."
    _, report = load_and_validate_cohort(
        write(frame, tmp_path),
        config(),
        exploratory_unverified=True,
        require_review=True,
    )
    assert sum(report.leakage_counts.values()) == 0


def test_exact_note_with_conflicting_outcomes_is_rejected(tmp_path: Path) -> None:
    frame = cohort()
    frame.loc[2, "note_sha256"] = "h1"
    with pytest.raises(CohortValidationError, match="conflicting outcomes"):
        load_and_validate_cohort(
            write(frame, tmp_path),
            config(),
            exploratory_unverified=True,
            require_review=True,
        )


def test_predictor_text_masks_common_identifiers_and_source_name() -> None:
    text, counts = deidentify_predictor_text(
        "Call Daisy at (213) 555-0182 on 6/19 or email team@example.org.",
        "Daisy Franco (HV) 6/19",
    )
    assert "Daisy" not in text
    assert "213" not in text
    assert "example.org" not in text
    assert "6/19" not in text
    assert counts["source_name_token"] == 1
