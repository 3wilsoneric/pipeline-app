# Test Effectiveness and Extraction Corpus

## Purpose

This layer tests whether Pipeline's safety suite can detect realistic defects. It is deliberately separate from the numbered assurance-control registry until a human reviews the assertions and the disposable PostgreSQL 16 recovery environment is certified.

## Operator commands

Run the bounded, offline effectiveness bundle:

~~~bash
npm run certify:test-effectiveness
~~~

Run its parts:

~~~bash
npm run test:critical-safety
npm run certify:seeded-defects
npm run certify:master-merge
npm run check:storage-consistency
npm run check:allo-import-identity
npm run check:extraction-quality
~~~

Check whether the governed human-labeled corpus is large and diverse enough:

~~~bash
PIPELINE_EXTRACTION_CORPUS_PATH=/absolute/protected/path/expected.json \
  npm run check:extraction-corpus
~~~

The corpus command is expected to fail until the human labeling work is complete.

## Corpus tiers

- Deep tier: 25 packets. Label every target field with the accepted value, page number, normalized bounding box, and short source text.
- Wide tier: at least 150 additional packets. Label accepted field values and required-field presence.
- Include at least 15 handwritten packets, 15 low-quality scans, and 15 mixed-layout packets.
- Keep the real corpus in approved governed storage, never Git. Use opaque fixture IDs and emit aggregate metrics only.

Schema version 2 document metadata:

~~~json
{
  "fixture_id": "opaque-id",
  "metadata": {
    "labeling_tier": "deep",
    "document_type": "mixed_packet",
    "scan_quality": "low",
    "handwriting": true
  },
  "fields": {
    "demographics.date_of_birth": {
      "value": "YYYY-MM-DD",
      "required": true,
      "page": 2,
      "evidence_bbox": [0.1, 0.2, 0.4, 0.28],
      "source_text": "bounded source phrase"
    }
  }
}
~~~

## Human approval quality

Do not inject intentionally wrong PHI into live work without written compliance, clinical-leadership, and workforce approval. Start with an offline synthetic review exercise. Measure reviewer catch rate, false correction rate, median review time, and agreement by field risk. If live blinded quality cases are later approved, make them clearly synthetic at persistence boundaries, exclude them from clinical and productivity reporting, and provide immediate debrief and remediation.

## Required human review

1. A senior engineer who did not write the production workflow reads all assertions in "scripts/critical-safety-contracts.mjs".
2. Admissions leadership approves the corpus field list and risk tiers.
3. Two labelers independently label a shared calibration subset; disagreements are adjudicated before the wide pass.
4. A disposable PostgreSQL 16 restore is certified before disaster recovery is called ready.

Recommended order: seeded defects, labeled corpus, semantic merge certification, then reviewer-quality measurement.
