#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"

if [[ "${1:-}" == "setup" ]]; then
  python3 -m venv "$VENV"
  "$VENV/bin/python" -m pip install --upgrade pip
  "$VENV/bin/python" -m pip install -r "$ROOT/requirements.txt"
  echo "Admission inference research environment is ready."
  exit 0
fi

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Environment missing. Run: $0 setup" >&2
  exit 2
fi

if [[ "${1:-}" == "test" ]]; then
  PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}" \
    "$VENV/bin/python" -m pytest "$ROOT/tests" -q
  exit 0
fi

PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}" \
  "$VENV/bin/python" -m admission_inference.cli "$@"
