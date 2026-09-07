import numpy as np
import pandas as pd

from admission_inference.evaluation import grouped_splits


def test_person_identity_never_crosses_a_fold_boundary() -> None:
    frame = pd.DataFrame(
        {
            "person_group_id": [group for group in "abcdefghijkl" for _ in range(2)]
        }
    )
    labels = np.asarray([label for label in (0, 1) * 6 for _ in range(2)])
    groups = frame["person_group_id"].to_numpy()
    for train, test in grouped_splits(frame, labels, n_splits=3, seed=42):
        assert set(groups[train]).isdisjoint(set(groups[test]))
