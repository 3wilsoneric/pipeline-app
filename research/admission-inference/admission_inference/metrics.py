from __future__ import annotations

import math
from typing import Dict, Iterable, List, Mapping, Sequence

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    log_loss,
    precision_score,
    recall_score,
    roc_auc_score,
)


def _safe_float(value: float) -> float | None:
    return float(value) if math.isfinite(float(value)) else None


def binary_metrics(
    y_true: np.ndarray,
    probabilities: np.ndarray,
    *,
    include_calibration: bool = True,
) -> Dict[str, float | None]:
    y_true = np.asarray(y_true, dtype=int)
    probabilities = np.clip(np.asarray(probabilities, dtype=float), 1e-6, 1 - 1e-6)
    predictions = (probabilities >= 0.5).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, predictions, labels=[0, 1]).ravel()

    calibration_intercept: float | None = None
    calibration_slope: float | None = None
    if include_calibration and len(np.unique(y_true)) == 2:
        logits = np.log(probabilities / (1 - probabilities)).reshape(-1, 1)
        calibration = LogisticRegression(C=1e9, solver="lbfgs", max_iter=2000)
        calibration.fit(logits, y_true)
        calibration_intercept = float(calibration.intercept_[0])
        calibration_slope = float(calibration.coef_[0, 0])

    return {
        "n": float(len(y_true)),
        "prevalence_admitted": _safe_float(np.mean(y_true)),
        "roc_auc": _safe_float(roc_auc_score(y_true, probabilities))
        if len(np.unique(y_true)) == 2
        else None,
        "average_precision": _safe_float(average_precision_score(y_true, probabilities))
        if len(np.unique(y_true)) == 2
        else None,
        "brier_score": _safe_float(brier_score_loss(y_true, probabilities)),
        "log_loss": _safe_float(log_loss(y_true, probabilities, labels=[0, 1])),
        "accuracy": _safe_float(accuracy_score(y_true, predictions)),
        "balanced_accuracy": _safe_float(balanced_accuracy_score(y_true, predictions)),
        "precision_admitted": _safe_float(precision_score(y_true, predictions, zero_division=0)),
        "sensitivity_admitted": _safe_float(recall_score(y_true, predictions, zero_division=0)),
        "specificity_denied": _safe_float(tn / (tn + fp)) if (tn + fp) else None,
        "negative_predictive_value": _safe_float(tn / (tn + fn)) if (tn + fn) else None,
        "f1_admitted": _safe_float(f1_score(y_true, predictions, zero_division=0)),
        "calibration_intercept": calibration_intercept,
        "calibration_slope": calibration_slope,
        "true_negative": float(tn),
        "false_positive": float(fp),
        "false_negative": float(fn),
        "true_positive": float(tp),
    }


def grouped_bootstrap_intervals(
    y_true: np.ndarray,
    probabilities: np.ndarray,
    groups: Sequence[str],
    *,
    iterations: int,
    seed: int,
) -> Dict[str, Mapping[str, float]]:
    y_true = np.asarray(y_true, dtype=int)
    probabilities = np.asarray(probabilities, dtype=float)
    groups_array = np.asarray(groups, dtype=object)
    unique_groups = np.unique(groups_array)
    indices_by_group = {
        group: np.flatnonzero(groups_array == group) for group in unique_groups
    }
    rng = np.random.default_rng(seed)
    tracked = (
        "roc_auc",
        "average_precision",
        "brier_score",
        "balanced_accuracy",
        "sensitivity_admitted",
        "specificity_denied",
    )
    samples: Dict[str, List[float]] = {name: [] for name in tracked}

    for _ in range(iterations):
        chosen = rng.choice(unique_groups, size=len(unique_groups), replace=True)
        sample_indices = np.concatenate([indices_by_group[group] for group in chosen])
        if len(np.unique(y_true[sample_indices])) < 2:
            continue
        result = binary_metrics(
            y_true[sample_indices],
            probabilities[sample_indices],
            include_calibration=False,
        )
        for name in tracked:
            value = result.get(name)
            if value is not None:
                samples[name].append(float(value))

    intervals: Dict[str, Mapping[str, float]] = {}
    for name, values in samples.items():
        if not values:
            continue
        intervals[name] = {
            "lower_95": float(np.percentile(values, 2.5)),
            "upper_95": float(np.percentile(values, 97.5)),
            "successful_bootstraps": float(len(values)),
        }
    return intervals


def abstention_curve(
    y_true: np.ndarray,
    probabilities: np.ndarray,
    thresholds: Iterable[float],
) -> List[Dict[str, float | None]]:
    y_true = np.asarray(y_true, dtype=int)
    probabilities = np.asarray(probabilities, dtype=float)
    confidence = np.maximum(probabilities, 1 - probabilities)
    predictions = (probabilities >= 0.5).astype(int)
    rows: List[Dict[str, float | None]] = []
    for threshold in thresholds:
        covered = confidence >= threshold
        count = int(covered.sum())
        if not count:
            rows.append(
                {
                    "confidence_threshold": float(threshold),
                    "coverage": 0.0,
                    "n_covered": 0.0,
                    "accuracy_when_covered": None,
                    "admitted_recall_when_covered": None,
                    "denied_recall_when_covered": None,
                }
            )
            continue
        covered_y = y_true[covered]
        covered_predictions = predictions[covered]
        admitted = covered_y == 1
        denied = covered_y == 0
        rows.append(
            {
                "confidence_threshold": float(threshold),
                "coverage": float(count / len(y_true)),
                "n_covered": float(count),
                "accuracy_when_covered": float(np.mean(covered_y == covered_predictions)),
                "admitted_recall_when_covered": float(
                    np.mean(covered_predictions[admitted] == 1)
                )
                if admitted.any()
                else None,
                "denied_recall_when_covered": float(np.mean(covered_predictions[denied] == 0))
                if denied.any()
                else None,
            }
        )
    return rows


def subgroup_metrics(
    y_true: np.ndarray,
    probabilities: np.ndarray,
    subgroup_values: Sequence[str],
    *,
    minimum_rows: int,
    minimum_rows_per_outcome: int,
) -> List[Dict[str, object]]:
    y_true = np.asarray(y_true, dtype=int)
    probabilities = np.asarray(probabilities, dtype=float)
    subgroups = np.asarray(subgroup_values, dtype=object)
    results: List[Dict[str, object]] = []
    for subgroup in sorted(set(subgroups)):
        mask = subgroups == subgroup
        labels = y_true[mask]
        counts = np.bincount(labels, minlength=2)
        if int(mask.sum()) < minimum_rows or int(counts.min()) < minimum_rows_per_outcome:
            results.append(
                {
                    "subgroup": str(subgroup),
                    "status": "insufficient_data",
                    "n": int(mask.sum()),
                    "denied": int(counts[0]),
                    "admitted": int(counts[1]),
                }
            )
            continue
        results.append(
            {
                "subgroup": str(subgroup),
                "status": "evaluated",
                "n": int(mask.sum()),
                "denied": int(counts[0]),
                "admitted": int(counts[1]),
                "metrics": binary_metrics(labels, probabilities[mask]),
            }
        )
    return results
