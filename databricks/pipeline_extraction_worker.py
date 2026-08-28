#!/usr/bin/env python3
"""Scan-gated, deterministic referral packet extraction for Pipeline.

This file is deployed as a Databricks Python script task. It deliberately uses
only Pipeline-owned storage, a Unity Catalog service credential, Azure Document
Intelligence, and the authenticated Pipeline worker callback.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable
from urllib.parse import quote, urlparse


DOCUMENT_INTELLIGENCE_API_VERSION = "2024-11-30"
MALWARE_RESULT_TAG = "Malware scanning scan result"
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
MAX_CALLBACK_BYTES = 2 * 1024 * 1024
MAX_OCR_RESULT_BYTES = 50 * 1024 * 1024
MAX_PAGE_COUNT = 10_000
SUPPORTED_JOB_TYPES = {"referral_packet", "assessment_workbook", "document_preview"}
SUPPORTED_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/tiff",
    "image/heic",
}
UTC = timezone.utc
DATE_PATTERN = re.compile(r"\b(0?[1-9]|1[0-2])[/\-](0?[1-9]|[12]\d|3[01])[/\-]((?:19|20)\d{2})\b")


class WorkerError(RuntimeError):
    def __init__(self, code: str, retryable: bool = False):
        super().__init__(code)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class PageText:
    page_number: int
    text: str


@dataclass(frozen=True)
class ExtractedValue:
    value: str
    confidence: float
    page_number: int


@dataclass(frozen=True)
class WorkerConfig:
    packet_id: str
    extraction_job_id: str
    attempt_count: int
    attempt_token: str
    job_type: str
    raw_container: str
    raw_blob_key: str
    storage_account: str
    callback_url: str
    document_intelligence_endpoint: str
    service_credential: str
    secret_scope: str
    callback_secret_key: str
    artifacts_container: str
    ocr_container: str
    evidence_container: str
    scan_wait_seconds: int


def parse_args(argv: list[str] | None = None) -> WorkerConfig:
    parser = argparse.ArgumentParser(description="Pipeline referral packet extraction worker")
    parser.add_argument("--packet-id", required=True)
    parser.add_argument("--raw-blob-prefix", required=True)
    parser.add_argument("--extraction-job-id", required=True)
    parser.add_argument("--attempt-count", required=True, type=int)
    parser.add_argument("--attempt-token", required=True)
    parser.add_argument("--job-type", required=True, choices=sorted(SUPPORTED_JOB_TYPES))
    parser.add_argument("--storage-account", required=True)
    parser.add_argument("--callback-url", required=True)
    parser.add_argument("--document-intelligence-endpoint", required=True)
    parser.add_argument("--service-credential", default="pipeline_extraction_service")
    parser.add_argument("--secret-scope", default="pipeline-extraction")
    parser.add_argument("--callback-secret-key", default="worker-shared-secret")
    parser.add_argument("--artifacts-container", default="artifacts")
    parser.add_argument("--ocr-container", default="ocr")
    parser.add_argument("--evidence-container", default="evidence")
    parser.add_argument("--scan-wait-seconds", type=int, default=300)
    args = parser.parse_args(argv)

    raw_container, raw_blob_key = split_blob_prefix(args.raw_blob_prefix)
    if args.attempt_count < 1 or args.attempt_count > 1_000_000:
        raise WorkerError("attempt_count_invalid")
    require_uuid(args.extraction_job_id, "extraction_job_id_invalid")
    require_uuid(args.attempt_token, "attempt_token_invalid")
    callback_url = require_https_url(args.callback_url, "callback_url_invalid")
    endpoint = require_https_url(args.document_intelligence_endpoint, "document_intelligence_endpoint_invalid")
    if not re.fullmatch(r"[a-z0-9]{3,24}", args.storage_account):
        raise WorkerError("storage_account_invalid")

    return WorkerConfig(
        packet_id=args.packet_id,
        extraction_job_id=args.extraction_job_id,
        attempt_count=args.attempt_count,
        attempt_token=args.attempt_token,
        job_type=args.job_type,
        raw_container=raw_container,
        raw_blob_key=raw_blob_key,
        storage_account=args.storage_account,
        callback_url=callback_url,
        document_intelligence_endpoint=endpoint,
        service_credential=safe_name(args.service_credential, "service_credential_invalid"),
        secret_scope=safe_name(args.secret_scope, "secret_scope_invalid"),
        callback_secret_key=safe_name(args.callback_secret_key, "callback_secret_key_invalid"),
        artifacts_container=safe_container(args.artifacts_container),
        ocr_container=safe_container(args.ocr_container),
        evidence_container=safe_container(args.evidence_container),
        scan_wait_seconds=max(30, min(1800, args.scan_wait_seconds)),
    )


def main(argv: list[str] | None = None) -> int:
    config: WorkerConfig | None = None
    try:
        config = parse_args(argv)
        run_worker(config)
        safe_log("worker_succeeded", config)
        return 0
    except WorkerError as error:
        if config is not None:
            safe_log(error.code, config)
            try:
                post_report(config, {
                    "status": "failed",
                    "error_code": error.code,
                    "retryable": error.retryable,
                })
            except Exception:
                safe_log("worker_failure_callback_failed", config)
        else:
            print(json.dumps({"event": "worker_configuration_failed", "code": error.code}), file=sys.stderr)
        return 1
    except Exception:
        if config is not None:
            safe_log("worker_unhandled_failure", config)
            try:
                post_report(config, {
                    "status": "failed",
                    "error_code": "worker_unhandled_failure",
                    "retryable": True,
                })
            except Exception:
                safe_log("worker_failure_callback_failed", config)
        return 1


def run_worker(config: WorkerConfig) -> None:
    credential = get_service_credential(config.service_credential)
    blob_service = get_blob_service(config.storage_account, credential)
    source_blob = blob_service.get_blob_client(config.raw_container, config.raw_blob_key)

    scan_status = wait_for_malware_scan(source_blob, config.scan_wait_seconds)
    if scan_status == "infected":
        digest = hash_blob(source_blob)
        post_report(config, {
            "status": "succeeded",
            "verified_sha256": digest,
            "malware_scan_status": "infected",
        })
        return
    if scan_status == "failed":
        digest = hash_blob(source_blob)
        post_report(config, {
            "status": "succeeded",
            "verified_sha256": digest,
            "malware_scan_status": "failed",
        })
        return
    if scan_status != "clean":
        raise WorkerError("malware_scan_pending", retryable=True)

    content_type, document_bytes = download_blob(source_blob)
    digest = hashlib.sha256(document_bytes).hexdigest()
    validate_signature(content_type, document_bytes)

    if config.job_type == "document_preview":
        preview_key = artifact_key(config, "preview", extension_for(content_type))
        upload_blob(blob_service, config.artifacts_container, preview_key, document_bytes, content_type)
        post_report(config, {
            "status": "succeeded",
            "verified_sha256": digest,
            "malware_scan_status": "clean",
            "preview": {
                "blob_container": config.artifacts_container,
                "blob_key": preview_key,
                "content_type": content_type,
            },
        })
        return

    source_url = create_read_url(blob_service, config)
    analysis = analyze_document(config.document_intelligence_endpoint, credential, source_url)
    pages = pages_from_analysis(analysis)
    if not pages:
        raise WorkerError("document_intelligence_empty_result", retryable=False)
    page_count = len(analysis.get("analyzeResult", {}).get("pages", []))
    if page_count < 1 or page_count > MAX_PAGE_COUNT:
        raise WorkerError("document_page_count_invalid", retryable=False)

    ocr_key = artifact_key(config, "ocr", "json")
    ocr_bytes = bounded_json_bytes(analysis, MAX_OCR_RESULT_BYTES, "ocr_result_too_large")
    upload_blob(blob_service, config.ocr_container, ocr_key, ocr_bytes, "application/json")

    evidence_keys = render_page_evidence(
        blob_service,
        config,
        document_bytes,
        content_type,
        {page.page_number for page in pages},
    )
    fields = build_intake_fields(pages, page_count, evidence_keys)
    output = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "extraction_job_id": config.extraction_job_id,
        "page_count": page_count,
        "fields": fields,
    }
    output_key = artifact_key(config, "extraction", "json")
    output_bytes = bounded_json_bytes(output, MAX_CALLBACK_BYTES, "extraction_output_too_large")
    upload_blob(blob_service, config.artifacts_container, output_key, output_bytes, "application/json")

    artifacts = [
        {
            "kind": "ocr_json",
            "blob_container": config.ocr_container,
            "blob_key": ocr_key,
            "content_type": "application/json",
            "byte_size": len(ocr_bytes),
        },
        {
            "kind": "extraction_output",
            "blob_container": config.artifacts_container,
            "blob_key": output_key,
            "content_type": "application/json",
            "byte_size": len(output_bytes),
        },
    ]
    for key in sorted(set(evidence_keys.values())):
        artifacts.append({
            "kind": "evidence",
            "blob_container": config.evidence_container,
            "blob_key": key,
            "content_type": "image/png",
        })

    post_report(config, {
        "status": "succeeded",
        "verified_sha256": digest,
        "malware_scan_status": "clean",
        "page_count": page_count,
        "artifacts": artifacts,
        "fields": fields,
    })


def wait_for_malware_scan(blob_client: Any, maximum_wait_seconds: int) -> str:
    deadline = time.monotonic() + maximum_wait_seconds
    while time.monotonic() < deadline:
        try:
            raw_value = blob_client.get_blob_tags().get(MALWARE_RESULT_TAG, "")
        except Exception as error:
            if status_code(error) in {401, 403}:
                raise WorkerError("malware_scan_tag_forbidden", retryable=False) from error
            raw_value = ""
        normalized = str(raw_value).strip().lower()
        if normalized == "no threats found":
            return "clean"
        if normalized == "malicious":
            return "infected"
        if normalized in {"error", "not scanned"}:
            return "failed"
        time.sleep(5)
    return "pending"


def download_blob(blob_client: Any) -> tuple[str, bytes]:
    properties = blob_client.get_blob_properties()
    declared_size = int(properties.size or 0)
    if declared_size < 1 or declared_size > MAX_DOWNLOAD_BYTES:
        raise WorkerError("source_blob_size_invalid", retryable=False)
    content_type = str(properties.content_settings.content_type or "application/octet-stream").split(";", 1)[0].lower()
    if content_type not in SUPPORTED_CONTENT_TYPES:
        raise WorkerError("source_content_type_unsupported", retryable=False)
    data = blob_client.download_blob(max_concurrency=2).readall()
    if len(data) != declared_size or len(data) > MAX_DOWNLOAD_BYTES:
        raise WorkerError("source_blob_size_mismatch", retryable=False)
    return content_type, data


def hash_blob(blob_client: Any) -> str:
    digest = hashlib.sha256()
    downloader = blob_client.download_blob(max_concurrency=2)
    total = 0
    for chunk in downloader.chunks():
        total += len(chunk)
        if total > MAX_DOWNLOAD_BYTES:
            raise WorkerError("source_blob_size_invalid", retryable=False)
        digest.update(chunk)
    return digest.hexdigest()


def analyze_document(endpoint: str, credential: Any, source_url: str) -> dict[str, Any]:
    import requests

    token = credential.get_token("https://cognitiveservices.azure.com/.default").token
    url = (
        f"{endpoint}/documentintelligence/documentModels/prebuilt-layout:analyze"
        f"?_overload=analyzeDocument&api-version={DOCUMENT_INTELLIGENCE_API_VERSION}"
    )
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"urlSource": source_url},
        timeout=(10, 60),
    )
    if response.status_code != 202:
        raise upstream_error("document_intelligence_submit", response.status_code)
    operation_url = response.headers.get("Operation-Location", "")
    if not operation_url or not operation_url.startswith(f"{endpoint}/"):
        raise WorkerError("document_intelligence_operation_invalid", retryable=False)

    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        time.sleep(max(1, min(10, parse_retry_after(response.headers.get("Retry-After")))))
        token = credential.get_token("https://cognitiveservices.azure.com/.default").token
        response = requests.get(operation_url, headers={"Authorization": f"Bearer {token}"}, timeout=(10, 60))
        if response.status_code != 200:
            raise upstream_error("document_intelligence_poll", response.status_code)
        if len(response.content) > MAX_OCR_RESULT_BYTES:
            raise WorkerError("ocr_result_too_large", retryable=False)
        payload = response.json()
        status = str(payload.get("status", "")).lower()
        if status == "succeeded":
            return payload
        if status in {"failed", "canceled"}:
            raise WorkerError("document_intelligence_analysis_failed", retryable=False)
        if status not in {"notstarted", "running"}:
            raise WorkerError("document_intelligence_status_invalid", retryable=False)
    raise WorkerError("document_intelligence_timeout", retryable=True)


def pages_from_analysis(payload: dict[str, Any]) -> list[PageText]:
    result = payload.get("analyzeResult")
    if not isinstance(result, dict):
        return []
    pages: list[PageText] = []
    for index, raw_page in enumerate(result.get("pages", []), start=1):
        if not isinstance(raw_page, dict):
            continue
        page_number = raw_page.get("pageNumber", index)
        if not isinstance(page_number, int) or page_number < 1:
            continue
        lines = raw_page.get("lines", [])
        text = "\n".join(
            str(line.get("content", "")).strip()
            for line in lines
            if isinstance(line, dict) and str(line.get("content", "")).strip()
        )
        pages.append(PageText(page_number, normalize_text(text)))
    return pages


def render_page_evidence(
    blob_service: Any,
    config: WorkerConfig,
    document_bytes: bytes,
    content_type: str,
    page_numbers: set[int],
) -> dict[int, str]:
    try:
        import fitz
    except ImportError as error:
        raise WorkerError("evidence_renderer_unavailable", retryable=False) from error

    try:
        document = fitz.open(stream=document_bytes, filetype=file_type_for(content_type))
    except Exception as error:
        raise WorkerError("evidence_document_invalid", retryable=False) from error
    evidence: dict[int, str] = {}
    try:
        for page_number in sorted(page_numbers):
            if page_number < 1 or page_number > document.page_count:
                continue
            page = document.load_page(page_number - 1)
            matrix = fitz.Matrix(1.5, 1.5)
            png = page.get_pixmap(matrix=matrix, alpha=False).tobytes("png")
            key = artifact_key(config, f"evidence-page-{page_number}", "png")
            upload_blob(blob_service, config.evidence_container, key, png, "image/png")
            evidence[page_number] = key
    finally:
        document.close()
    return evidence


def build_intake_fields(pages: list[PageText], page_count: int, evidence: dict[int, str]) -> list[dict[str, Any]]:
    name = extract_name(pages)
    birth_date, age = extract_birth(pages)
    values: list[tuple[str, ExtractedValue | None]] = [
        ("referral.full_name", name),
        ("referral.date_of_birth", birth_date),
        ("referral.age", age),
        ("referral.gender", find_labeled(pages, r"(?:gender|sex)\s*[:|-]\s*(male|female|nonbinary|non-binary)\b", 0.94, title_case)),
        ("referral.referring_facility", find_labeled(pages, r"(?:referring\s+(?:facility|hospital)|facility|program)\s*[:|-]\s*([^\n|]{3,100})", 0.90)),
        ("referral.source_record_number", find_labeled(pages, r"(?:resident|medical\s*record|record|mrn)\s*#?\s*[:|-]?\s*(\d{5,14})", 0.94)),
        ("referral.source_admission_date", extract_admission_date(pages, birth_date.value if birth_date else None)),
        ("referral.payer", find_labeled(pages, r"primary\s*payer\s*[:|-]?\s*([^\n|]{2,100})", 0.88)),
        ("referral.emergency_contact", find_labeled(pages, r"(?:responsible\s+person|emergency\s+contact|conservator\s+name|guardian\s+name)\s*[:|-]\s*([^\n|]{3,100})", 0.87)),
        ("referral.primary_diagnosis", find_labeled(pages, r"primary\s+diagnosis\s*[:|-]\s*([^\n|]{3,160})", 0.92)),
        ("referral.allergies", find_labeled(pages, r"(?:allerg(?:y|ies)|nkda)\s*[:|-]?\s*([^\n|]{2,140})", 0.84)),
        ("referral.legal_status", extract_legal_status(pages)),
    ]
    summary = ExtractedValue(
        f"{page_count} source page{'s' if page_count != 1 else ''} preserved; "
        f"{'identity located' if name else 'identity needs review'}; "
        f"{'clinical diagnosis located' if values[9][1] else 'clinical diagnosis needs review'}. "
        "Values were generated deterministically and require human confirmation.",
        0.99,
        1,
    )
    values.append(("referral.packet_summary", summary))
    return [field_payload(key, value, evidence) for key, value in values]


def field_payload(key: str, extracted: ExtractedValue | None, evidence: dict[int, str]) -> dict[str, Any]:
    value = clean_value(extracted.value) if extracted else None
    page = extracted.page_number if extracted else None
    evidence_key = evidence.get(page) if page else None
    candidate = []
    if value is not None and extracted is not None:
        candidate.append({
            "source": "document_intelligence",
            "value": value,
            "confidence": extracted.confidence,
            "source_page": page,
            **({"evidence_blob_key": evidence_key} if evidence_key else {}),
        })
    return {
        "field_key": key,
        "proposed_value": value,
        "confidence": extracted.confidence if value is not None and extracted else 0,
        **({"source_page": page} if page else {}),
        **({"evidence_blob_key": evidence_key} if evidence_key else {}),
        "candidates": candidate,
    }


def extract_name(pages: Iterable[PageText]) -> ExtractedValue | None:
    candidates: dict[str, ExtractedValue] = {}
    for page in pages:
        for line in text_lines(page.text):
            match = re.search(r"(?:resident|patient|client)\s*name\s*[:|-]\s*([A-Za-z][A-Za-z'., -]{2,80})", line, re.I)
            if match:
                name = normalize_name(match.group(1))
                if name:
                    candidates.setdefault(name.casefold(), ExtractedValue(name, 0.94, page.page_number))
            titled = re.search(r"\b(?:Mr|Ms|Mrs|Miss)\.?\s+([A-Za-z][A-Za-z'. -]{1,50}),\s*([A-Za-z][A-Za-z'.-]{1,30})", line, re.I)
            if titled:
                name = f"{title_case(titled.group(2))} {title_case(titled.group(1))}"
                candidates.setdefault(name.casefold(), ExtractedValue(name, 0.97, page.page_number))
    # A packet containing more than one identity must be resolved by a human,
    # never by whichever patient's page happened to appear first.
    return next(iter(candidates.values())) if len(candidates) == 1 else None


def extract_birth(pages: Iterable[PageText]) -> tuple[ExtractedValue | None, ExtractedValue | None]:
    current_year = date.today().year
    candidates: dict[str, tuple[ExtractedValue, ExtractedValue]] = {}
    for page in pages:
        for line in text_lines(page.text):
            if not re.search(r"date\s*of\s*birth|birth\s*date|\bdob\b", line, re.I):
                continue
            match = DATE_PATTERN.search(line)
            if not match:
                continue
            iso = iso_date(match)
            age_match = re.search(r"\bage\s*[:|-]?\s*(\d{1,3})\b", line, re.I)
            age = int(age_match.group(1)) if age_match else current_year - int(match.group(3))
            if age < 0 or age > 120:
                continue
            candidates.setdefault(
                iso,
                (ExtractedValue(iso, 0.96, page.page_number), ExtractedValue(str(age), 0.94, page.page_number)),
            )
    if len(candidates) != 1:
        return None, None
    return next(iter(candidates.values()))


def extract_admission_date(pages: Iterable[PageText], excluded: str | None) -> ExtractedValue | None:
    for page in pages:
        for line in text_lines(page.text):
            if not re.search(r"admission\s*date|init\s*adm|orig\s*adm", line, re.I):
                continue
            for match in DATE_PATTERN.finditer(line):
                value = iso_date(match)
                if value != excluded:
                    return ExtractedValue(value, 0.91, page.page_number)
    return None


def extract_legal_status(pages: Iterable[PageText]) -> ExtractedValue | None:
    explicit = find_labeled(pages, r"(?:legal\s+status|hold\s+type|conservatorship\s+status)\s*[:|-]\s*([^\n|]{2,120})", 0.86)
    if explicit:
        return explicit
    for page in pages:
        hold = re.search(r"\b(5150|5250|5270|voluntary)\b", page.text, re.I)
        if hold:
            return ExtractedValue(hold.group(1).upper(), 0.82, page.page_number)
        if re.search(r"\bconservator(?:ship)?\b", page.text, re.I):
            return ExtractedValue("Conservator listed in packet", 0.76, page.page_number)
    return None


def find_labeled(
    pages: Iterable[PageText],
    pattern: str,
    confidence: float,
    transform: Callable[[str], str] = lambda value: value,
) -> ExtractedValue | None:
    compiled = re.compile(pattern, re.I)
    for page in pages:
        match = compiled.search(page.text)
        if match:
            value = clean_value(transform(match.group(1)))
            if value:
                return ExtractedValue(value, confidence, page.page_number)
    return None


def post_report(config: WorkerConfig, report: dict[str, Any]) -> None:
    import requests

    payload = {
        "extraction_job_id": config.extraction_job_id,
        "attempt_count": config.attempt_count,
        "attempt_token": config.attempt_token,
        **report,
    }
    body = bounded_json_bytes(payload, MAX_CALLBACK_BYTES, "callback_payload_too_large")
    secret = get_secret(config.secret_scope, config.callback_secret_key)
    response = requests.post(
        config.callback_url,
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "User-Agent": "pipeline-databricks-worker/1",
        },
        data=body,
        timeout=(10, 60),
    )
    if response.status_code not in {200, 201}:
        raise upstream_error("pipeline_callback", response.status_code)


def get_service_credential(name: str) -> Any:
    try:
        return dbutils.credentials.getServiceCredentialsProvider(name)  # type: ignore[name-defined]  # noqa: F821
    except Exception as error:
        raise WorkerError("service_credential_unavailable", retryable=False) from error


def get_secret(scope: str, key: str) -> str:
    try:
        value = dbutils.secrets.get(scope=scope, key=key)  # type: ignore[name-defined]  # noqa: F821
    except Exception as error:
        raise WorkerError("callback_secret_unavailable", retryable=False) from error
    if not value or len(value) < 32:
        raise WorkerError("callback_secret_invalid", retryable=False)
    return value


def get_blob_service(account: str, credential: Any) -> Any:
    try:
        from azure.storage.blob import BlobServiceClient
        return BlobServiceClient(f"https://{account}.blob.core.windows.net", credential=credential)
    except Exception as error:
        raise WorkerError("blob_client_unavailable", retryable=False) from error


def create_read_url(blob_service: Any, config: WorkerConfig) -> str:
    from azure.storage.blob import BlobSasPermissions, generate_blob_sas

    starts_at = datetime.now(UTC) - timedelta(minutes=5)
    expires_at = datetime.now(UTC) + timedelta(minutes=20)
    try:
        delegation_key = blob_service.get_user_delegation_key(starts_at, expires_at)
        signature = generate_blob_sas(
            account_name=config.storage_account,
            container_name=config.raw_container,
            blob_name=config.raw_blob_key,
            user_delegation_key=delegation_key,
            permission=BlobSasPermissions(read=True),
            start=starts_at,
            expiry=expires_at,
            protocol="https",
        )
    except Exception as error:
        raise WorkerError("source_read_url_failed", retryable=True) from error
    encoded_key = "/".join(quote(part, safe="") for part in config.raw_blob_key.split("/"))
    return f"https://{config.storage_account}.blob.core.windows.net/{config.raw_container}/{encoded_key}?{signature}"


def upload_blob(blob_service: Any, container: str, key: str, data: bytes, content_type: str) -> None:
    from azure.storage.blob import ContentSettings

    try:
        blob_service.get_blob_client(container, key).upload_blob(
            data,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type),
        )
    except Exception as error:
        raise WorkerError("artifact_upload_failed", retryable=True) from error


def validate_signature(content_type: str, data: bytes) -> None:
    valid = (
        (content_type == "application/pdf" and data.startswith(b"%PDF-"))
        or (content_type == "image/png" and data.startswith(b"\x89PNG"))
        or (content_type == "image/jpeg" and data.startswith(b"\xff\xd8\xff"))
        or (content_type == "image/tiff" and (data.startswith(b"II*\x00") or data.startswith(b"MM\x00*")))
        or (content_type == "image/heic" and b"ftyp" in data[4:16])
    )
    if not valid:
        raise WorkerError("uploaded_file_signature_invalid", retryable=False)


def split_blob_prefix(value: str) -> tuple[str, str]:
    if "/" not in value:
        raise WorkerError("raw_blob_prefix_invalid")
    container, key = value.split("/", 1)
    return safe_container(container), safe_blob_key(key)


def safe_container(value: str) -> str:
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?", value):
        raise WorkerError("blob_container_invalid")
    return value


def safe_blob_key(value: str) -> str:
    if not value or len(value) > 900 or ".." in value or any(char in value for char in "?#\\"):
        raise WorkerError("blob_key_invalid")
    return value


def safe_name(value: str, code: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_.-]{2,128}", value):
        raise WorkerError(code)
    return value


def require_uuid(value: str, code: str) -> None:
    if not re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}", value):
        raise WorkerError(code)


def require_https_url(value: str, code: str) -> str:
    parsed = urlparse(value.rstrip("/"))
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise WorkerError(code)
    return value.rstrip("/")


def artifact_key(config: WorkerConfig, label: str, extension: str) -> str:
    safe_label = re.sub(r"[^a-z0-9-]", "-", label.lower()).strip("-")[:80]
    return safe_blob_key(
        f"extraction/{config.extraction_job_id}/attempt-{config.attempt_count}/{safe_label}.{extension}"
    )


def file_type_for(content_type: str) -> str:
    return {
        "application/pdf": "pdf",
        "image/png": "png",
        "image/jpeg": "jpeg",
        "image/tiff": "tiff",
        "image/heic": "heic",
    }[content_type]


def extension_for(content_type: str) -> str:
    return {
        "application/pdf": "pdf",
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/tiff": "tiff",
        "image/heic": "heic",
    }[content_type]


def normalize_text(value: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[\t ]+", " ", value.replace("\r", "\n"))).strip()


def text_lines(value: str) -> list[str]:
    return [clean_value(line) for line in value.splitlines() if clean_value(line)]


def clean_value(value: str) -> str | None:
    cleaned = re.sub(r"\s+", " ", re.sub(r"[_|]+", " ", str(value))).strip(" :;,.-\t\n")
    return cleaned or None


def normalize_name(value: str) -> str | None:
    cleaned = re.sub(r"\b(?:he/him|she/her|they/them)\b.*$", "", value, flags=re.I)
    cleaned = clean_value(cleaned)
    if not cleaned:
        return None
    if "," in cleaned:
        last, first = (part.strip() for part in cleaned.split(",", 1))
        cleaned = f"{first} {last}"
    words = [word for word in cleaned.split() if re.fullmatch(r"[A-Za-z][A-Za-z'.-]*", word)]
    return " ".join(title_case(word) for word in words) if 2 <= len(words) <= 5 else None


def title_case(value: str) -> str:
    return " ".join(word[:1].upper() + word[1:].lower() for word in value.strip().split())


def iso_date(match: re.Match[str]) -> str:
    return f"{match.group(3)}-{int(match.group(1)):02d}-{int(match.group(2)):02d}"


def bounded_json_bytes(value: Any, maximum: int, code: str) -> bytes:
    body = json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    if len(body) > maximum:
        raise WorkerError(code, retryable=False)
    return body


def parse_retry_after(value: str | None) -> int:
    try:
        return int(value or "2")
    except ValueError:
        return 2


def upstream_error(prefix: str, status: int) -> WorkerError:
    retryable = status in {408, 409, 425, 429} or status >= 500
    return WorkerError(f"{prefix}_rejected", retryable=retryable)


def status_code(error: Exception) -> int | None:
    value = getattr(error, "status_code", None)
    return value if isinstance(value, int) else None


def safe_log(event: str, config: WorkerConfig) -> None:
    print(json.dumps({
        "event": event,
        "extraction_job_id": config.extraction_job_id,
        "attempt_count": config.attempt_count,
        "job_type": config.job_type,
    }))


if __name__ == "__main__":
    raise SystemExit(main())
