#!/usr/bin/env node

import assert from "node:assert/strict";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const presentation = loadTypeScriptModule(
  process.cwd(),
  "lib/clinical/clinical-value-presentation.ts",
);
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.equal(
  presentation.humanizeClinicalField("active_medications_json"),
  "Active medications",
);
assert.equal(
  presentation.humanizeClinicalField("mar_compliance_pct_30d"),
  "MAR compliance percent 30d",
);

assert.deepEqual(
  plain(presentation.presentClinicalValue('["F20.9","F20.9","F29"]', "diagnoses_enriched_json")),
  { kind: "list", items: ["F20.9", "F29"] },
);
assert.deepEqual(
  plain(presentation.presentClinicalValue("['Acute', 'Hospital']", "prior_setting_enriched_json")),
  { kind: "list", items: ["Acute", "Hospital"] },
);
assert.deepEqual(
  plain(presentation.presentClinicalValue('{"type":"LPS","status":"needs_review"}', "conservatorship_enriched_json")),
  {
    kind: "record",
    entries: [
      { label: "Type", value: "LPS" },
      { label: "Status", value: "Needs review" },
    ],
  },
);
assert.deepEqual(
  plain(presentation.presentClinicalValue("Hospital | Acute | Hospital", "prior_setting_bucket")),
  { kind: "list", items: ["Hospital", "Acute"] },
);
assert.deepEqual(
  plain(presentation.presentClinicalValue("[]", "document_ids")),
  { kind: "missing", text: "Not reported" },
);
assert.deepEqual(
  plain(presentation.presentClinicalValue("The client's preferred setting", "assessment_notes")),
  { kind: "scalar", text: "The client's preferred setting" },
);
assert.equal(
  presentation.formatClinicalValue('["English","Spanish"]', "primary_language_values_json"),
  "English; Spanish",
);

console.log("Clinical value presentation contracts passed.");
