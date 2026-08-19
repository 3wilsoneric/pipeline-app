#!/usr/bin/env python3

import importlib.util
import json
import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKER_PATH = ROOT / "databricks" / "pipeline_extraction_worker.py"
SPEC = importlib.util.spec_from_file_location("pipeline_extraction_worker", WORKER_PATH)
assert SPEC and SPEC.loader
worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = worker
SPEC.loader.exec_module(worker)


class PipelineExtractionWorkerTests(unittest.TestCase):
    def test_builds_deterministic_fields_with_evidence(self):
        pages = [
            worker.PageText(1, "\n".join([
                "Resident Name: Doe, Jane",
                "DOB: 04/12/1981 Age: 45",
                "Gender: Female",
                "Referring Facility: Example Regional Medical Center",
                "Medical Record #: 12345678",
                "Admission Date: 08/17/2026",
                "Primary Payer: County Program",
            ])),
            worker.PageText(2, "\n".join([
                "Emergency Contact: Sample Contact",
                "Primary Diagnosis: Example diagnosis",
                "Allergies: Penicillin",
                "Legal Status: 5250",
            ])),
        ]
        fields = worker.build_intake_fields(pages, 2, {1: "safe/page-1.png", 2: "safe/page-2.png"})
        by_key = {field["field_key"]: field for field in fields}

        self.assertEqual(len(fields), 13)
        self.assertEqual(by_key["referral.full_name"]["proposed_value"], "Jane Doe")
        self.assertEqual(by_key["referral.date_of_birth"]["proposed_value"], "1981-04-12")
        self.assertEqual(by_key["referral.source_admission_date"]["proposed_value"], "2026-08-17")
        self.assertEqual(by_key["referral.legal_status"]["proposed_value"], "5250")
        self.assertEqual(by_key["referral.primary_diagnosis"]["source_page"], 2)
        self.assertEqual(by_key["referral.primary_diagnosis"]["evidence_blob_key"], "safe/page-2.png")
        self.assertEqual(by_key["referral.primary_diagnosis"]["candidates"][0]["source"], "document_intelligence")

    def test_missing_values_remain_null(self):
        fields = worker.build_intake_fields([worker.PageText(1, "No labeled intake facts")], 1, {1: "safe/page-1.png"})
        by_key = {field["field_key"]: field for field in fields}
        missing = by_key["referral.primary_diagnosis"]
        self.assertIsNone(missing["proposed_value"])
        self.assertEqual(missing["confidence"], 0)
        self.assertNotIn("source_page", missing)
        self.assertEqual(missing["candidates"], [])

    def test_rejects_unsafe_blob_paths(self):
        with self.assertRaisesRegex(worker.WorkerError, "blob_key_invalid"):
            worker.split_blob_prefix("raw/packet/../secret.pdf")

    def test_rejects_non_https_callback(self):
        args = base_args()
        args[args.index("--callback-url") + 1] = "http://pipeline.example/api/internal/extraction/report"
        with self.assertRaisesRegex(worker.WorkerError, "callback_url_invalid"):
            worker.parse_args(args)

    def test_callback_payload_stays_bounded(self):
        body = worker.bounded_json_bytes({"status": "succeeded", "fields": []}, worker.MAX_CALLBACK_BYTES, "too_large")
        self.assertEqual(json.loads(body), {"status": "succeeded", "fields": []})
        with self.assertRaisesRegex(worker.WorkerError, "too_large"):
            worker.bounded_json_bytes({"value": "x" * 100}, 10, "too_large")

    def test_file_signatures_are_verified(self):
        worker.validate_signature("application/pdf", b"%PDF-1.7 safe")
        with self.assertRaisesRegex(worker.WorkerError, "uploaded_file_signature_invalid"):
            worker.validate_signature("application/pdf", b"not a pdf")


def base_args():
    return [
        "--packet-id", "document-only",
        "--raw-blob-prefix", "raw/packet/original/file.pdf",
        "--extraction-job-id", "46dc1f76-fca5-4321-9604-0e3a8c84dce3",
        "--attempt-count", "1",
        "--attempt-token", "e69ca235-ce91-4f8c-8a8e-97f9a5d6f299",
        "--job-type", "referral_packet",
        "--storage-account", "pipelineprodexample",
        "--callback-url", "https://pipeline.example/api/internal/extraction/report",
        "--document-intelligence-endpoint", "https://pipeline-docintel.cognitiveservices.azure.com",
    ]


if __name__ == "__main__":
    unittest.main(verbosity=2)
