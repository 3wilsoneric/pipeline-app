from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Mapping, Sequence

from sklearn.base import BaseEstimator
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.preprocessing import MaxAbsScaler
from sklearn.linear_model import LogisticRegression, SGDClassifier

from .features import ClinicalSignalTransformer, ProcessFeatureTransformer, TextColumnSelector


@dataclass(frozen=True)
class ModelSpec:
    name: str
    purpose: str
    estimator: BaseEstimator
    parameter_grid: Mapping[str, Sequence[object]]
    clinical_candidate: bool


def _text_features() -> Pipeline:
    return Pipeline(
        steps=[
            ("select_text", TextColumnSelector()),
            (
                "tfidf",
                FeatureUnion(
                    transformer_list=[
                        (
                            "word",
                            TfidfVectorizer(
                                lowercase=True,
                                strip_accents="unicode",
                                ngram_range=(1, 2),
                                min_df=2,
                                max_df=0.97,
                                max_features=12000,
                                sublinear_tf=True,
                            ),
                        ),
                        (
                            "character",
                            TfidfVectorizer(
                                analyzer="char_wb",
                                lowercase=True,
                                ngram_range=(3, 5),
                                min_df=2,
                                max_features=16000,
                                sublinear_tf=True,
                            ),
                        ),
                    ]
                ),
            ),
        ]
    )


def _elastic_net_classifier(seed: int) -> SGDClassifier:
    return SGDClassifier(
        loss="log_loss",
        penalty="elasticnet",
        class_weight="balanced",
        max_iter=5000,
        tol=1e-4,
        average=True,
        random_state=seed,
    )


def build_model_specs(seed: int) -> List[ModelSpec]:
    clinical = Pipeline(
        steps=[
            ("features", ClinicalSignalTransformer()),
            ("scale", MaxAbsScaler()),
            (
                "classifier",
                LogisticRegression(
                    solver="liblinear",
                    class_weight="balanced",
                    max_iter=3000,
                    random_state=seed,
                ),
            ),
        ]
    )

    text = Pipeline(
        steps=[
            ("features", _text_features()),
            ("classifier", _elastic_net_classifier(seed)),
        ]
    )

    combined = Pipeline(
        steps=[
            (
                "features",
                FeatureUnion(
                    transformer_list=[
                        ("text", _text_features()),
                        ("clinical", ClinicalSignalTransformer()),
                    ]
                ),
            ),
            ("scale", MaxAbsScaler()),
            ("classifier", _elastic_net_classifier(seed)),
        ]
    )

    process_control = Pipeline(
        steps=[
            ("features", ProcessFeatureTransformer()),
            ("scale", MaxAbsScaler()),
            (
                "classifier",
                LogisticRegression(
                    solver="liblinear",
                    class_weight="balanced",
                    max_iter=3000,
                    random_state=seed,
                ),
            ),
        ]
    )

    elastic_grid: Dict[str, Sequence[object]] = {
        "classifier__alpha": (0.00001, 0.0001, 0.001, 0.01),
        "classifier__l1_ratio": (0.0, 0.25, 0.5),
    }
    regularized_grid: Dict[str, Sequence[object]] = {
        "classifier__C": (0.05, 0.2, 1.0, 5.0, 20.0),
        "classifier__penalty": ("l1", "l2"),
    }

    return [
        ModelSpec(
            name="clinical_signals",
            purpose="Interpretable deterministic clinical-domain signal baseline.",
            estimator=clinical,
            parameter_grid=regularized_grid,
            clinical_candidate=True,
        ),
        ModelSpec(
            name="word_character_text",
            purpose="Word and character TF-IDF language baseline.",
            estimator=text,
            parameter_grid=elastic_grid,
            clinical_candidate=True,
        ),
        ModelSpec(
            name="combined",
            purpose="Language baseline augmented by deterministic clinical-domain signals.",
            estimator=combined,
            parameter_grid=elastic_grid,
            clinical_candidate=True,
        ),
        ModelSpec(
            name="process_negative_control",
            purpose=(
                "Workflow-confounding check using note length, source period, and community; "
                "never a clinical candidate."
            ),
            estimator=process_control,
            parameter_grid=regularized_grid,
            clinical_candidate=False,
        ),
    ]
