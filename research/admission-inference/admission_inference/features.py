from __future__ import annotations

import re
from typing import Dict, Iterable, List, Mapping, Sequence

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.base import BaseEstimator, TransformerMixin


CLINICAL_SIGNAL_PATTERNS: Mapping[str, Sequence[str]] = {
    "orientation_cognition": (
        r"\borient(?:ed|ation)\b",
        r"\baware\s+x?[1-4]\b",
        r"\bcognit(?:ion|ive)\b",
        r"\bmemory\b",
    ),
    "diagnosis_symptoms": (
        r"\bschizophren\w*\b",
        r"\bbipolar\b",
        r"\bpsych(?:osis|otic|iatric)\w*\b",
        r"\bdepress\w*\b",
        r"\banxiety\b",
    ),
    "medication_support": (
        r"\bmed(?:ication|ications|s)?\b",
        r"\bcompliant\b",
        r"\brefus(?:al|als|e|es|ed)\b",
        r"\bprn\b",
        r"\binjection\b",
    ),
    "function_adl": (
        r"\badls?\b",
        r"\bambulat\w*\b",
        r"\bwheelchair\b",
        r"\btransfer\w*\b",
        r"\bassist(?:ance|ed)?\b",
        r"\bincontin\w*\b",
    ),
    "behavior_safety": (
        r"\baggress\w*\b",
        r"\bassault\w*\b",
        r"\bviol(?:ence|ent)\b",
        r"\barson\b",
        r"\bawol\b",
        r"\belop(?:e|ement|ed|ing)\b",
        r"\bself[- ]harm\b",
    ),
    "perceptual_si_hi": (
        r"\bhallucinat\w*\b",
        r"\bah\b",
        r"\bvh\b",
        r"\bsuicid\w*\b",
        r"\bhomicid\w*\b",
        r"\bsi\b",
        r"\bhi\b",
    ),
    "substance_use": (
        r"\bsubstance\w*\b",
        r"\bmeth\w*\b",
        r"\balcohol\w*\b",
        r"\bcannabis\b",
        r"\bdrug\s+use\b",
    ),
    "medical_needs": (
        r"\bdiabet\w*\b",
        r"\bseizure\w*\b",
        r"\bwound\b",
        r"\boxygen\b",
        r"\bcolostom\w*\b",
        r"\bileostom\w*\b",
        r"\ballerg(?:y|ies|ic)\b",
    ),
    "sleep_social": (
        r"\bsleep\w*\b",
        r"\broommate\w*\b",
        r"\bfamily\b",
        r"\bsocial\s+support\b",
        r"\bhomeless\w*\b",
    ),
    "legal_conservatorship": (
        r"\bconserv(?:ed|ator|atorship)\b",
        r"\blps\b",
        r"\btcon\b",
        r"\bmurphy(?:'s)?\b",
        r"\bprobation\b",
        r"\bparole\b",
    ),
}


def _coerce_text_rows(values: object) -> List[str]:
    if isinstance(values, pd.DataFrame):
        source = values.iloc[:, 0]
    elif isinstance(values, pd.Series):
        source = values
    else:
        array = np.asarray(values, dtype=object)
        source = array.reshape(-1)
    return [str(value or "") for value in source]


class TextColumnSelector(BaseEstimator, TransformerMixin):
    def __init__(self, column: str = "model_input_text") -> None:
        self.column = column

    def fit(self, frame: pd.DataFrame, y: object = None) -> "TextColumnSelector":
        return self

    def transform(self, frame: pd.DataFrame) -> List[str]:
        return frame[self.column].fillna("").astype(str).tolist()


class ClinicalSignalTransformer(BaseEstimator, TransformerMixin):
    def __init__(self, column: str = "model_input_text") -> None:
        self.column = column

    def fit(self, frame: pd.DataFrame, y: object = None) -> "ClinicalSignalTransformer":
        self.feature_names_in_ = np.asarray([self.column], dtype=object)
        return self

    def transform(self, frame: pd.DataFrame) -> sparse.csr_matrix:
        texts = frame[self.column].fillna("").astype(str).tolist()
        matrix = np.zeros((len(texts), len(CLINICAL_SIGNAL_PATTERNS) * 2), dtype=float)
        for row_index, text in enumerate(texts):
            lowered = text.lower()
            for signal_index, patterns in enumerate(CLINICAL_SIGNAL_PATTERNS.values()):
                matches = sum(len(re.findall(pattern, lowered, flags=re.IGNORECASE)) for pattern in patterns)
                matrix[row_index, signal_index * 2] = float(matches > 0)
                matrix[row_index, signal_index * 2 + 1] = float(min(matches, 5))
        return sparse.csr_matrix(matrix)

    def get_feature_names_out(self, input_features: object = None) -> np.ndarray:
        names: List[str] = []
        for signal in CLINICAL_SIGNAL_PATTERNS:
            names.extend((f"clinical__{signal}__present", f"clinical__{signal}__count"))
        return np.asarray(names, dtype=object)


class ProcessFeatureTransformer(BaseEstimator, TransformerMixin):
    """Negative-control features that must never be presented as clinical evidence."""

    feature_names: Sequence[str] = (
        "process__note_word_count",
        "process__source_year",
        "process__source_month",
    )

    def fit(self, frame: pd.DataFrame, y: object = None) -> "ProcessFeatureTransformer":
        communities = sorted(
            value for value in frame["community"].fillna("Unknown").astype(str).unique() if value
        )
        self.communities_ = tuple(communities)
        return self

    @staticmethod
    def _period_parts(value: str) -> tuple[int, int]:
        text = str(value or "").strip().lower()
        year_match = re.search(r"\b(20\d{2})\b", text)
        short_year_match = re.match(r"^\s*(2\d)\b", text)
        year = int(year_match.group(1)) if year_match else 0
        if not year and short_year_match:
            year = 2000 + int(short_year_match.group(1))
        months = {
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
        month = next((number for name, number in months.items() if name in text), 0)
        return year, month

    def transform(self, frame: pd.DataFrame) -> sparse.csr_matrix:
        rows: List[List[float]] = []
        community_index = {name: index for index, name in enumerate(self.communities_)}
        for _, row in frame.iterrows():
            text = str(row.get("model_input_text", "") or "")
            year, month = self._period_parts(str(row.get("source_period", "") or ""))
            values = [float(len(text.split())), float(year), float(month)]
            communities = [0.0] * len(self.communities_)
            community = str(row.get("community", "Unknown") or "Unknown")
            if community in community_index:
                communities[community_index[community]] = 1.0
            rows.append(values + communities)
        return sparse.csr_matrix(np.asarray(rows, dtype=float))

    def get_feature_names_out(self, input_features: object = None) -> np.ndarray:
        community_names = [f"process__community__{value}" for value in self.communities_]
        return np.asarray(list(self.feature_names) + community_names, dtype=object)


def period_ordinal(value: str) -> int:
    year, month = ProcessFeatureTransformer._period_parts(value)
    if not year or not month:
        return 0
    return year * 12 + month
