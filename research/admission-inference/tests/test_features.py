import pandas as pd

from admission_inference.features import ClinicalSignalTransformer, ProcessFeatureTransformer


def test_clinical_signal_transformer_is_deterministic() -> None:
    frame = pd.DataFrame(
        {
            "assessment_note_model_text": [
                "Client is oriented x4, ambulatory, and takes medications as ordered."
            ],
            "model_input_text": [
                "Client is oriented x4, ambulatory, and takes medications as ordered."
            ],
        }
    )
    transformer = ClinicalSignalTransformer().fit(frame)
    first = transformer.transform(frame).toarray()
    second = transformer.transform(frame).toarray()
    assert first.tolist() == second.tolist()
    assert first.sum() > 0


def test_process_control_uses_only_documentation_context() -> None:
    frame = pd.DataFrame(
        {
            "assessment_note_model_text": ["Short assessment note."],
            "model_input_text": ["Short assessment note."],
            "community": ["San Pablo"],
            "source_period": ["2026 May"],
            "outcome": ["admitted"],
            "reason_evidence_available": ["true"],
            "quality_score": ["999"],
        }
    )
    transformer = ProcessFeatureTransformer().fit(frame)
    names = transformer.get_feature_names_out().tolist()
    assert not any("outcome" in name for name in names)
    assert not any("reason" in name for name in names)
    assert not any("quality" in name for name in names)
