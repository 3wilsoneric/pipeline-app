from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import asdict
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Sequence, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import GridSearchCV, StratifiedGroupKFold

from .config import ResearchConfig
from .features import period_ordinal
from .metrics import (
    abstention_curve,
    binary_metrics,
    grouped_bootstrap_intervals,
    subgroup_metrics,
)
from .models import ModelSpec, build_model_specs


def encoded_outcome(frame: pd.DataFrame) -> np.ndarray:
    return frame["outcome"].map({"denied": 0, "admitted": 1}).to_numpy(dtype=int)


def grouped_splits(
    frame: pd.DataFrame,
    labels: np.ndarray,
    *,
    n_splits: int,
    seed: int,
) -> List[Tuple[np.ndarray, np.ndarray]]:
    groups = frame["person_group_id"].astype(str).to_numpy()
    splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    splits = list(splitter.split(frame, labels, groups))
    for train_indices, test_indices in splits:
        overlap = set(groups[train_indices]).intersection(groups[test_indices])
        if overlap:
            raise RuntimeError("Grouped split leaked a person identity across train and test")
        if len(np.unique(labels[train_indices])) < 2 or len(np.unique(labels[test_indices])) < 2:
            raise RuntimeError("Grouped split produced a fold without both outcomes")
    return splits


def _serializable_params(params: Mapping[str, object]) -> Dict[str, object]:
    return {
        key: value.item() if isinstance(value, np.generic) else value
        for key, value in params.items()
    }


def _tune(
    spec: ModelSpec,
    frame: pd.DataFrame,
    labels: np.ndarray,
    splits: Sequence[Tuple[np.ndarray, np.ndarray]],
) -> GridSearchCV:
    search = GridSearchCV(
        estimator=clone(spec.estimator),
        param_grid=spec.parameter_grid,
        scoring="neg_log_loss",
        cv=list(splits),
        refit=True,
        n_jobs=-1,
        error_score="raise",
        return_train_score=False,
    )
    search.fit(frame, labels)
    return search


def _calibrated_estimator(
    tuned_estimator: object,
    splits: Sequence[Tuple[np.ndarray, np.ndarray]],
) -> CalibratedClassifierCV:
    return CalibratedClassifierCV(
        estimator=clone(tuned_estimator),
        method="sigmoid",
        cv=list(splits),
        ensemble=True,
        n_jobs=-1,
    )


def nested_grouped_evaluation(
    spec: ModelSpec,
    frame: pd.DataFrame,
    config: ResearchConfig,
) -> tuple[Dict[str, object], pd.DataFrame]:
    labels = encoded_outcome(frame)
    groups = frame["person_group_id"].astype(str).to_numpy()
    outer = grouped_splits(
        frame,
        labels,
        n_splits=config.outer_splits,
        seed=config.random_seed,
    )
    probabilities = np.full(len(frame), np.nan, dtype=float)
    fold_numbers = np.full(len(frame), -1, dtype=int)
    fold_details: List[Dict[str, object]] = []

    for fold_number, (train_indices, test_indices) in enumerate(outer, start=1):
        train_frame = frame.iloc[train_indices].reset_index(drop=True)
        train_labels = labels[train_indices]
        train_groups = groups[train_indices]
        inner_splitter = StratifiedGroupKFold(
            n_splits=config.inner_splits,
            shuffle=True,
            random_state=config.random_seed + fold_number,
        )
        inner = list(inner_splitter.split(train_frame, train_labels, train_groups))
        search = _tune(spec, train_frame, train_labels, inner)
        calibrated = _calibrated_estimator(search.best_estimator_, inner)
        calibrated.fit(train_frame, train_labels)
        fold_probabilities = calibrated.predict_proba(frame.iloc[test_indices])[:, 1]
        probabilities[test_indices] = fold_probabilities
        fold_numbers[test_indices] = fold_number
        fold_details.append(
            {
                "fold": fold_number,
                "train_rows": int(len(train_indices)),
                "test_rows": int(len(test_indices)),
                "best_parameters": _serializable_params(search.best_params_),
                "inner_best_neg_log_loss": float(search.best_score_),
            }
        )

    if np.isnan(probabilities).any() or (fold_numbers < 1).any():
        raise RuntimeError(f"Nested evaluation did not produce one prediction per row for {spec.name}")

    metrics = binary_metrics(labels, probabilities)
    intervals = grouped_bootstrap_intervals(
        labels,
        probabilities,
        groups,
        iterations=config.bootstrap_iterations,
        seed=config.random_seed,
    )
    result: Dict[str, object] = {
        "model": spec.name,
        "purpose": spec.purpose,
        "clinical_candidate": spec.clinical_candidate,
        "evaluation": "nested_stratified_group_cross_validation",
        "positive_class": "admitted",
        "metrics": metrics,
        "confidence_intervals": intervals,
        "abstention_curve": abstention_curve(
            labels, probabilities, config.abstention_thresholds
        ),
        "community_metrics": subgroup_metrics(
            labels,
            probabilities,
            frame["community"].fillna("Unknown").astype(str).tolist(),
            minimum_rows=config.minimum_subgroup_rows,
            minimum_rows_per_outcome=config.minimum_subgroup_rows_per_outcome,
        ),
        "folds": fold_details,
    }
    predictions = pd.DataFrame(
        {
            "record_key": [
                hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:20]
                for value in frame["cohort_id"]
            ],
            "outcome": frame["outcome"].astype(str),
            "probability_admitted": probabilities,
            "predicted_outcome_at_0_5": np.where(probabilities >= 0.5, "admitted", "denied"),
            "outer_fold": fold_numbers,
            "community": frame["community"].fillna("Unknown").astype(str),
            "source_period": frame["source_period"].fillna("Unknown").astype(str),
        }
    )
    return result, predictions


def fit_final_model(
    spec: ModelSpec,
    frame: pd.DataFrame,
    config: ResearchConfig,
) -> tuple[CalibratedClassifierCV, Dict[str, object]]:
    labels = encoded_outcome(frame)
    splits = grouped_splits(
        frame,
        labels,
        n_splits=config.outer_splits,
        seed=config.random_seed + 100,
    )
    search = _tune(spec, frame, labels, splits)
    calibrated = _calibrated_estimator(search.best_estimator_, splits)
    calibrated.fit(frame, labels)
    metadata = {
        "model": spec.name,
        "best_parameters": _serializable_params(search.best_params_),
        "best_grouped_cv_neg_log_loss": float(search.best_score_),
        "calibration": "sigmoid with materialized person-grouped folds",
        "training_rows": int(len(frame)),
    }
    return calibrated, metadata


def _best_parameter_mode(folds: Iterable[Mapping[str, object]]) -> Dict[str, object]:
    encoded = [json.dumps(fold["best_parameters"], sort_keys=True) for fold in folds]
    if not encoded:
        return {}
    return json.loads(Counter(encoded).most_common(1)[0][0])


def _holdout_evaluation(
    spec: ModelSpec,
    train_frame: pd.DataFrame,
    test_frame: pd.DataFrame,
    config: ResearchConfig,
    *,
    seed_offset: int,
) -> Dict[str, object]:
    train_labels = encoded_outcome(train_frame)
    test_labels = encoded_outcome(test_frame)
    train_group_count = train_frame["person_group_id"].nunique()
    splits_count = min(config.inner_splits, int(train_group_count))
    if splits_count < 2 or len(np.unique(train_labels)) < 2 or len(np.unique(test_labels)) < 2:
        return {"status": "insufficient_data"}
    try:
        splits = grouped_splits(
            train_frame,
            train_labels,
            n_splits=splits_count,
            seed=config.random_seed + seed_offset,
        )
    except (ValueError, RuntimeError):
        return {"status": "insufficient_data"}
    search = _tune(spec, train_frame, train_labels, splits)
    calibrated = _calibrated_estimator(search.best_estimator_, splits)
    calibrated.fit(train_frame, train_labels)
    probabilities = calibrated.predict_proba(test_frame)[:, 1]
    return {
        "status": "evaluated",
        "train_rows": int(len(train_frame)),
        "test_rows": int(len(test_frame)),
        "best_parameters": _serializable_params(search.best_params_),
        "metrics": binary_metrics(test_labels, probabilities),
    }


def temporal_holdout(
    spec: ModelSpec,
    frame: pd.DataFrame,
    config: ResearchConfig,
) -> Dict[str, object]:
    ordinals = frame["source_period"].map(period_ordinal).to_numpy(dtype=int)
    valid = sorted(set(int(value) for value in ordinals if value > 0))
    if len(valid) < 3:
        return {"status": "insufficient_data", "reason": "Fewer than three parsed periods."}

    for cutoff in reversed(valid[1:]):
        train_mask = (ordinals > 0) & (ordinals < cutoff)
        test_mask = ordinals >= cutoff
        train = frame.loc[train_mask].reset_index(drop=True)
        test = frame.loc[test_mask].reset_index(drop=True)
        if len(train) < 60 or len(test) < 20:
            continue
        if train["outcome"].nunique() < 2 or test["outcome"].nunique() < 2:
            continue
        if train["outcome"].value_counts().min() < 15 or test["outcome"].value_counts().min() < 8:
            continue
        result = _holdout_evaluation(spec, train, test, config, seed_offset=200)
        result["cutoff_period_ordinal"] = int(cutoff)
        result["parsed_rows"] = int((ordinals > 0).sum())
        return result
    return {
        "status": "insufficient_data",
        "reason": "No chronological split retained enough rows from both outcomes.",
        "parsed_rows": int((ordinals > 0).sum()),
    }


def leave_one_community_out(
    spec: ModelSpec,
    frame: pd.DataFrame,
    config: ResearchConfig,
) -> List[Dict[str, object]]:
    results: List[Dict[str, object]] = []
    communities = frame["community"].fillna("Unknown").astype(str)
    for index, community in enumerate(sorted(communities.unique())):
        test = frame.loc[communities == community].reset_index(drop=True)
        train = frame.loc[communities != community].reset_index(drop=True)
        test_counts = test["outcome"].value_counts()
        if (
            len(test) < config.minimum_subgroup_rows
            or len(test_counts) < 2
            or int(test_counts.min()) < config.minimum_subgroup_rows_per_outcome
        ):
            results.append(
                {
                    "community": community,
                    "status": "insufficient_data",
                    "test_rows": int(len(test)),
                }
            )
            continue
        result = _holdout_evaluation(
            spec,
            train,
            test,
            config,
            seed_offset=300 + index,
        )
        result["community"] = community
        results.append(result)
    return results


def run_full_evaluation(
    frame: pd.DataFrame,
    config: ResearchConfig,
    output_directory: Path,
) -> tuple[Dict[str, object], pd.DataFrame]:
    specs = build_model_specs(config.random_seed)
    model_results: Dict[str, object] = {}
    prediction_frames: List[pd.DataFrame] = []
    final_models: Dict[str, object] = {}
    final_metadata: Dict[str, object] = {}

    for spec in specs:
        print(f"Evaluating {spec.name} with nested person-grouped folds...", flush=True)
        result, predictions = nested_grouped_evaluation(spec, frame, config)
        model_results[spec.name] = result
        predictions.insert(0, "model", spec.name)
        prediction_frames.append(predictions)
        final_model, metadata = fit_final_model(spec, frame, config)
        final_models[spec.name] = final_model
        final_metadata[spec.name] = metadata

    primary_spec = next(spec for spec in specs if spec.name == "combined")
    external_validation = {
        "primary_model": "combined",
        "temporal_holdout": temporal_holdout(primary_spec, frame, config),
        "leave_one_community_out": leave_one_community_out(primary_spec, frame, config),
    }
    process_auc = model_results["process_negative_control"]["metrics"]["roc_auc"]
    community_holdouts = external_validation["leave_one_community_out"]
    interpretation_gates = {
        "deployment_status": "blocked",
        "human_review": "evaluated by the input contract and recorded in run.json",
        "process_confounding": {
            "status": "pass" if process_auc is not None and process_auc < 0.65 else "fail",
            "criterion": "process-only negative-control ROC AUC must be below 0.65",
            "observed_roc_auc": process_auc,
        },
        "temporal_validation": {
            "status": "pass"
            if external_validation["temporal_holdout"].get("status") == "evaluated"
            else "fail",
            "observed": external_validation["temporal_holdout"].get("status"),
        },
        "community_transportability": {
            "status": "pass"
            if community_holdouts
            and all(result.get("status") == "evaluated" for result in community_holdouts)
            else "fail",
            "evaluated_communities": sum(
                result.get("status") == "evaluated" for result in community_holdouts
            ),
            "total_communities": len(community_holdouts),
        },
        "prospective_shadow_validation": {
            "status": "fail",
            "observed": "not performed",
        },
    }
    comparison = {
        "primary_model": "combined",
        "primary_model_selection": "pre-specified before evaluation",
        "models": model_results,
        "external_validation": external_validation,
        "interpretation_gates": interpretation_gates,
        "final_model_metadata": final_metadata,
        "config": asdict(config),
    }

    output_directory.mkdir(parents=True, exist_ok=False)
    model_path = output_directory / "research-models.joblib"
    joblib.dump(final_models, model_path, compress=3)
    reloaded_models = joblib.load(model_path)
    if set(reloaded_models) != set(final_models):
        raise RuntimeError("Serialized research model bundle failed its round-trip check")
    (output_directory / "MODEL_ARTIFACT_CONTAINS_PHI.txt").write_text(
        "RESEARCH ONLY. The serialized text-vectorizer vocabulary may contain PHI.\n"
        "Do not copy this directory to source control or an unapproved system.\n",
        encoding="utf-8",
    )
    predictions = pd.concat(prediction_frames, ignore_index=True)
    return comparison, predictions
