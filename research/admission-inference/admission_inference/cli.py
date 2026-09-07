from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

import pandas as pd

from .config import load_config
from .contracts import CohortValidationError, load_and_validate_cohort
from .evaluation import run_full_evaluation
from .pool import build_expanded_pool
from .prospective import ProspectiveContractError, profile_prospective_export
from .reporting import write_run_artifacts


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG = PACKAGE_ROOT / "config.json"
DEFAULT_PROSPECTIVE_CONTRACT = PACKAGE_ROOT / "prospective-model-contract.json"
DEFAULT_OUTPUT_ROOT = REPOSITORY_ROOT / "outputs" / "admission-inference"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pipeline-admission-inference",
        description="Research-only admission inference evaluation harness.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate", help="Validate a cohort without training.")
    validate.add_argument("--input", type=Path, required=True)
    validate.add_argument("--config", type=Path, default=DEFAULT_CONFIG)

    prepare = subparsers.add_parser(
        "prepare-review",
        help="Create a PHI-sensitive supervisor verification worksheet.",
    )
    prepare.add_argument("--input", type=Path, required=True)
    prepare.add_argument("--output", type=Path, required=True)
    prepare.add_argument("--config", type=Path, default=DEFAULT_CONFIG)

    train = subparsers.add_parser("train", help="Run the complete research evaluation.")
    train.add_argument("--input", type=Path, required=True)
    train.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    train.add_argument("--output", type=Path)
    train.add_argument(
        "--exploratory-unverified",
        action="store_true",
        help="Permit an explicitly labeled run before human verification is complete.",
    )
    train.add_argument(
        "--bootstrap-iterations",
        type=int,
        help="Override the configured grouped bootstrap count for a local smoke run.",
    )

    expand = subparsers.add_parser(
        "expand-pool",
        help="Build a provenance-preserving referral pool from an ALLO canvas capture.",
    )
    expand.add_argument("--source-root", type=Path, required=True)
    expand.add_argument("--output", type=Path, required=True)
    expand.add_argument("--seed-cohort", type=Path)

    prospective = subparsers.add_parser(
        "profile-prospective",
        help="Validate signed assessment snapshots and publish aggregate associations.",
    )
    prospective.add_argument("--input", type=Path, required=True)
    prospective.add_argument("--output", type=Path, required=True)
    prospective.add_argument(
        "--contract",
        type=Path,
        default=DEFAULT_PROSPECTIVE_CONTRACT,
    )
    return parser


def _safe_summary(report: object) -> str:
    payload = report.to_dict()
    return json.dumps(payload, indent=2, sort_keys=True)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "profile-prospective":
        result = profile_prospective_export(
            input_path=args.input.resolve(),
            contract_path=args.contract.resolve(),
            output_directory=args.output.resolve(),
        )
        print(json.dumps(result.to_dict(), indent=2, sort_keys=True))
        print("Prospective profile complete. No model was trained.")
        print("RESEARCH ONLY. Do not use these outputs for an admission decision.")
        return 0
    if args.command == "expand-pool":
        report = build_expanded_pool(
            source_root=args.source_root.resolve(),
            output_directory=args.output.resolve(),
            seed_cohort_path=args.seed_cohort.resolve() if args.seed_cohort else None,
        )
        print(json.dumps(report["counts"], indent=2, sort_keys=True))
        print(f"Expanded referral pool created: {args.output.resolve()}")
        print("PHI-SENSITIVE RESEARCH DATA. Human review is required before modeling.")
        return 0

    config = load_config(args.config.resolve())
    if getattr(args, "bootstrap_iterations", None) is not None:
        if args.bootstrap_iterations < 20:
            raise CohortValidationError("At least 20 bootstrap iterations are required")
        config = replace(config, bootstrap_iterations=args.bootstrap_iterations)

    require_review = args.command == "train"
    exploratory = bool(getattr(args, "exploratory_unverified", False))
    frame, validation = load_and_validate_cohort(
        args.input.resolve(),
        config,
        exploratory_unverified=exploratory,
        require_review=require_review,
    )
    print(_safe_summary(validation))
    if args.command == "validate":
        print("Cohort contract validation passed. No model was trained.")
        return 0
    if args.command == "prepare-review":
        output_path = args.output.resolve()
        if output_path.exists():
            raise CohortValidationError(f"Review worksheet already exists: {output_path}")
        preferred_columns = [
            "cohort_id",
            "outcome",
            "secondary_review_required",
            "person_group_id",
            "source_canvas_id",
            "source_canvas_name",
            "source_project_name",
            "community",
            "source_period",
            "source_locator",
            "assessment_note_model_text",
        ]
        worksheet = frame[[column for column in preferred_columns if column in frame.columns]].copy()
        worksheet["annotation_status"] = ""
        worksheet["outcome_verified"] = ""
        worksheet["pre_decision_verified"] = ""
        worksheet["leakage_reviewed"] = ""
        worksheet["reviewer_id"] = ""
        worksheet["disposition_category"] = ""
        worksheet["contributing_factors_semicolon_separated"] = ""
        worksheet["decisive_evidence_span"] = ""
        worksheet["review_uncertainty"] = ""
        worksheet["reviewer_notes"] = ""
        output_path.parent.mkdir(parents=True, exist_ok=True)
        worksheet.to_csv(output_path, index=False)
        print(f"PHI-sensitive review worksheet created: {output_path}")
        return 0

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_directory = (
        args.output.resolve()
        if args.output
        else DEFAULT_OUTPUT_ROOT / f"run-{timestamp}-{validation.source_sha256[:10]}"
    )
    if output_directory.exists():
        raise CohortValidationError(f"Output directory already exists: {output_directory}")

    evaluation, predictions = run_full_evaluation(frame, config, output_directory)
    write_run_artifacts(
        output_directory=output_directory,
        repository_root=REPOSITORY_ROOT,
        validation=validation,
        config=config,
        evaluation=evaluation,
        predictions=predictions,
    )
    print(f"Research run complete: {output_directory}")
    print("RESEARCH ONLY. Do not use these outputs for an admission decision.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (CohortValidationError, ProspectiveContractError) as error:
        print(f"Cohort validation failed: {error}", file=sys.stderr)
        raise SystemExit(2)
