import numpy as np

from admission_inference.metrics import abstention_curve, binary_metrics


def test_metrics_use_admitted_as_positive_class() -> None:
    labels = np.asarray([0, 0, 1, 1])
    probabilities = np.asarray([0.1, 0.4, 0.6, 0.9])
    metrics = binary_metrics(labels, probabilities)
    assert metrics["sensitivity_admitted"] == 1.0
    assert metrics["specificity_denied"] == 1.0


def test_abstention_reports_coverage() -> None:
    labels = np.asarray([0, 0, 1, 1])
    probabilities = np.asarray([0.1, 0.49, 0.51, 0.9])
    curve = abstention_curve(labels, probabilities, (0.5, 0.8))
    assert curve[0]["coverage"] == 1.0
    assert curve[1]["coverage"] == 0.5
