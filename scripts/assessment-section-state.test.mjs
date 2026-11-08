import assert from "node:assert/strict";
import test from "node:test";
import { clean, root } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const schema = loadTypeScriptModule(root, "lib/assessment/assessment-tool-schema.ts");
const drafts = loadTypeScriptModule(root, "lib/pipeline/user-workspace-state-types.ts");
const sections = [...schema.assessmentToolSections];
const data = { ...schema.createEmptyAssessmentToolData(), resident_name: "Synthetic section verification" };
const draft = { schema: 1, assessmentId: "asm_synthetic", referralId: 1, savedAt: "2026-11-07T00:00:00Z",
  baseVersion: 1, sectionVersions: Object.fromEntries(sections.map(section => [section, 1])), data, baseData: data };

test("all 4,096 canonical dirty-section subsets survive parsing and JSON recovery", () => {
  assert.equal(sections.length, 12);
  for (let mask = 0; mask < 2 ** sections.length; mask++) {
    const dirtySections = sections.filter((_, index) => mask & (1 << index));
    const parsed = drafts.parsePipelineAssessmentDraft({ ...draft, dirtySections });
    assert.ok(parsed, `mask ${mask}`);
    assert.deepEqual(clean(parsed.dirtySections), dirtySections, `mask ${mask}`);
    assert.deepEqual(clean(drafts.parsePipelineAssessmentDraft(JSON.parse(JSON.stringify(parsed)))), clean(parsed));
    assert.deepEqual(clean(parsed.data), clean(data));
    assert.deepEqual(clean(parsed.baseData), clean(data));
  }
});

test("duplicate, unknown, excessive and malformed section states cannot become recovery drafts", () => {
  for (const dirtySections of [null, {}, "identity", ["unknown"], [...sections, "unknown"], [...sections, sections[0]], [sections[0], sections[0]]]) {
    assert.equal(drafts.parsePipelineAssessmentDraft({ ...draft, dirtySections }), null);
  }
  for (const section of sections) {
    const field = schema.assessmentToolFieldDefinitions.find(item => item.section === section);
    assert.ok(drafts.parsePipelineAssessmentDraft({ ...draft, dirtySections: sections, activeSection: section, activeQuestion: field.key }));
    const other = schema.assessmentToolFieldDefinitions.find(item => item.section !== section);
    assert.equal(drafts.parsePipelineAssessmentDraft({ ...draft, dirtySections: sections, activeSection: section, activeQuestion: other.key }), null);
  }
});
