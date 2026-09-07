import json
import re
from pathlib import Path

import pandas as pd
import pytest

from admission_inference.prospective import (
    ProspectiveContractError,
    load_prospective_contract,
    profile_prospective_export,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = PACKAGE_ROOT / "prospective-model-contract.json"
RULE_REGISTRY_PATH = PACKAGE_ROOT / "evidence-rule-registry.json"


def row(index: int, outcome: str = "accepted") -> dict:
    return {
        "referral_id": index,
        "assessment_id": f"assessment-{index}",
        "canonical_client_id": f"client-{index}",
        "assessment_version": 1,
        "assessment_schema_version": "pipeline_assessment_tool_v1",
        "signed_at": f"2026-0{1 + (index % 3)}-05T18:00:00Z",
        "assessment_data": {
            "resident_name": f"Synthetic Person {index}",
            "date_of_birth": "1980-01-01",
            "assessment_notes": "This direct narrative must not be exported.",
            "assessment_date": f"2026-0{1 + (index % 3)}-05",
            "admit_date": "2025-12-01",
            "prior_setting_bucket": "state_hospital",
            "ambulatory": "yes" if index % 4 else "no",
            "diagnosis_categories": ["schizophrenia"],
            "overall_hygiene_rating": 4,
            "medication_adherence": "yes",
        },
        "field_provenance": {
            "ambulatory": [{"review_status": "accepted"}],
            "medication_adherence": [{"review_status": "edited"}],
        },
        "audit": {
            "community": ["San Pablo", "Turlock", "Santa Clarita"][index % 3],
            "assessor_id": f"assessor-{index % 4}",
            "referral_source": "County",
        },
        "decision": {
            "outcome": outcome,
            "decided_at": f"2026-0{1 + (index % 3)}-06T18:00:00Z",
        },
        "recommendation": {
            "outcome": "accept" if outcome == "accepted" else "decline",
            "recommended_at": f"2026-0{1 + (index % 3)}-05T20:00:00Z",
        },
    }


def write_rows(path: Path, rows: list[dict]) -> Path:
    path.write_text("".join(json.dumps(value) + "\n" for value in rows), encoding="utf-8")
    return path


def test_contract_predictors_exist_in_assessment_schema() -> None:
    contract = load_prospective_contract(CONTRACT_PATH)
    schema_source = (
        REPOSITORY_ROOT / "lib" / "assessment" / "assessment-tool-schema.ts"
    ).read_text(encoding="utf-8")
    assessment_fields = set(re.findall(r'field\("([a-z0-9_]+)"', schema_source))
    groups = contract["structured_predictors"]
    configured = set(groups["categorical"] + groups["multi_select"] + groups["numeric"])
    explicitly_classified = set(configured)
    for interval in groups["derived_intervals"]:
        configured.add(interval["start_field"])
        configured.add(interval["end_field"])
        explicitly_classified.add(interval["start_field"])
        explicitly_classified.add(interval["end_field"])
    explicitly_classified.update(contract["narrative_shadow_fields"])
    explicitly_classified.update(contract["audit_only_dimensions"])
    explicitly_classified.update(contract["prohibited_predictors"])
    assert configured.issubset(assessment_fields)
    assert not configured.intersection(contract["prohibited_predictors"])
    assert set(contract["core_fields"]).issubset(configured)
    conditional_fields = set(contract["conditional_activation"])
    derived_names = {item["name"] for item in groups["derived_intervals"]}
    assert conditional_fields.issubset(configured | derived_names)
    question_source = (
        REPOSITORY_ROOT / "lib" / "assessment" / "assessment-interview-schema.ts"
    ).read_text(encoding="utf-8")
    question_fields = set(re.findall(r'q\("([a-z0-9_]+)"', question_source))
    assert question_fields.issubset(explicitly_classified)
    assert len(contract["narrative_shadow_fields"]) == len(
        set(contract["narrative_shadow_fields"])
    )


def test_evidence_rules_reference_real_fields_and_cannot_make_decisions() -> None:
    registry = json.loads(RULE_REGISTRY_PATH.read_text(encoding="utf-8"))
    schema_source = (
        REPOSITORY_ROOT / "lib" / "assessment" / "assessment-tool-schema.ts"
    ).read_text(encoding="utf-8")
    assessment_fields = set(re.findall(r'field\("([a-z0-9_]+)"', schema_source))
    allowed_actions = set(registry["allowed_actions"])
    for rule in registry["candidate_rules"]:
        assert rule["action"] in allowed_actions
        assert rule["decision_effect"] == "none"
        referenced = {
            condition["field"]
            for key in ("when", "when_any")
            for condition in rule.get(key, [])
        }
        referenced.update(rule.get("require", []))
        assert referenced.issubset(assessment_fields)


def test_profile_exports_structured_values_without_direct_identifiers(tmp_path: Path) -> None:
    input_path = write_rows(
        tmp_path / "signed.ndjson",
        [row(index, "accepted" if index <= 10 else "declined") for index in range(1, 21)],
    )
    output = tmp_path / "profile"

    result = profile_prospective_export(
        input_path=input_path,
        contract_path=CONTRACT_PATH,
        output_directory=output,
    )

    assert result.signed_episode_count == 20
    assert result.labeled_episode_count == 20
    snapshots = pd.read_csv(output / "prospective-structured-snapshots.csv")
    assert "resident_name" not in snapshots.columns
    assert "date_of_birth" not in snapshots.columns
    assert "assessment_notes" not in snapshots.columns
    assert snapshots["person_group_id"].str.len().eq(64).all()
    assert set(snapshots["decision_outcome"]) == {"accepted", "declined"}
    assert set(snapshots["needs_more_information"]) == {"no"}
    assert snapshots["audit__extraction_edit_rate"].eq(0.5).all()
    associations = pd.read_csv(output / "prospective-univariate-associations.csv")
    assert "ambulatory" in set(associations["field"])
    assert "q_value_bh" in associations.columns
    suppressed = associations[associations["suppressed"].astype(bool)]
    assert suppressed["accepted_n"].isna().all()
    assert suppressed["declined_n"].isna().all()
    report = json.loads((output / "prospective-quality-report.json").read_text())
    assert report["safety"]["trained_model"] is False
    assert report["readiness"]["ready_for_user_facing_assistance"] is False


def test_decision_before_signature_is_rejected(tmp_path: Path) -> None:
    invalid = row(1)
    invalid["decision"]["decided_at"] = "2025-12-31T18:00:00Z"
    with pytest.raises(ProspectiveContractError, match="predates"):
        profile_prospective_export(
            input_path=write_rows(tmp_path / "invalid.ndjson", [invalid]),
            contract_path=CONTRACT_PATH,
            output_directory=tmp_path / "profile",
        )


def test_unsigned_assessment_is_rejected(tmp_path: Path) -> None:
    invalid = row(1)
    invalid["signed_at"] = ""
    with pytest.raises(ProspectiveContractError, match="signed_at"):
        profile_prospective_export(
            input_path=write_rows(tmp_path / "invalid.ndjson", [invalid]),
            contract_path=CONTRACT_PATH,
            output_directory=tmp_path / "profile",
        )


def test_recommendation_before_signature_is_rejected(tmp_path: Path) -> None:
    invalid = row(1)
    invalid["recommendation"]["recommended_at"] = "2025-12-31T18:00:00Z"
    with pytest.raises(ProspectiveContractError, match="recommendation predates"):
        profile_prospective_export(
            input_path=write_rows(tmp_path / "invalid.ndjson", [invalid]),
            contract_path=CONTRACT_PATH,
            output_directory=tmp_path / "profile",
        )
