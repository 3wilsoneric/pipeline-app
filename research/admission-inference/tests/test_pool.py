import json
from pathlib import Path

from admission_inference.pool import (
    build_expanded_pool,
    extract_assessment_summary,
    extract_source_status,
    infer_community,
    infer_period,
)


def test_status_comes_from_final_section_not_clinical_denial() -> None:
    text = "Summary\nClient denies SI and HI.\nInterview\nSECTION\nRejected\nASSIGNEE"
    status = extract_source_status(text)
    assert status.state == "denied"
    assert status.label == "Rejected"


def test_pending_status_is_not_converted_to_denied() -> None:
    status = extract_source_status("Summary\nNo concerns.\nInterview\nSECTION\nPending Interview")
    assert status.state == "pending"


def test_summary_extraction_is_bounded_before_interview() -> None:
    text = "Header\nSummary\nClient is oriented x4.\nInterview\nDo not include this."
    assert extract_assessment_summary(text) == "Client is oriented x4."


def test_project_metadata_parsing() -> None:
    assert infer_community("26 April AHMSC") == "Santa Clarita"
    assert infer_community("2025 March JCWH Admissions") == "JC Wallace House"
    assert infer_period("26 April AHMSC") == "2026-04"
    assert infer_period("Aug 26' AHMSC") == "2026-08"


def test_pool_keeps_weak_labels_out_of_model_candidates(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    source_root.mkdir()
    canvas_rows = [
        {
            "canvas": {
                "id": "1",
                "name": "Example Person 1/1",
                "project_id": "p1",
                "url": "https://example.invalid/1",
            },
            "project": {"id": "p1", "name": "2026 January San Pablo Admissions"},
                "plain_text": (
                    "Summary\nClient is oriented x4 and independently ambulatory. "
                    "Client reports stable sleep and takes medication daily. "
                    "Staff report the client is calm and cooperative. Client completes "
                    "ADLs without assistance and reports no recent aggression or falls.\nInterview\n"
                "SECTION\nRejected\nASSIGNEE"
            ),
            "captured_at": "2026-01-02T00:00:00Z",
        },
        {
            "canvas": {
                "id": "2",
                "name": "Sparse Example 1/2",
                "project_id": "p1",
                "url": "https://example.invalid/2",
            },
            "project": {"id": "p1", "name": "2026 January San Pablo Admissions"},
            "plain_text": "Summary\nNo.\nInterview\nSECTION\nDenied\nASSIGNEE",
            "captured_at": "2026-01-02T00:00:00Z",
        },
    ]
    with (source_root / "canvas-content.ndjson").open("w") as destination:
        for row in canvas_rows:
            destination.write(json.dumps(row) + "\n")
    with (source_root / "pipeline-canvas-content-record-links.ndjson").open("w") as destination:
        for canvas_id in ("1", "2"):
            destination.write(
                json.dumps(
                    {
                        "source_canvas_id": canvas_id,
                        "canonical_link_status": "unmatched",
                        "source_sha256": f"source-{canvas_id}",
                    }
                )
                + "\n"
            )
    (source_root / "pipeline-client-history-with-allo-notes.json").write_text(
        json.dumps({"clients": []})
    )

    output = tmp_path / "output"
    report = build_expanded_pool(
        source_root=source_root,
        output_directory=output,
        seed_cohort_path=None,
    )
    assert report["counts"]["outcome_labeled_records"] == 2
    assert report["counts"]["model_ready_pending_human_review"] == 1
    assert (output / "human-review-queue.csv").is_file()
    assert (output / "next-expansion-review.csv").is_file()
