#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const read = (file) => readFileSync(file, "utf8");
const access = read("lib/note-lab/note-lab-access.ts");
const page = read("app/(standalone-review)/note-lab/practice/page.tsx");
const workspace = read("components/pipeline/note-lab/AssessmentPracticeWorkspace.tsx");
const coach = read("components/pipeline/training/PipelineGuidedCoach.tsx");
const scenarioSource = read("lib/note-lab/assessment-practice-scenario.ts");
const assessmentWorkspace = read("components/pipeline/AssessmentWorkspace.tsx");
const schema = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-tool-schema.ts");
const interview = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-interview-schema.ts");
const writing = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-field-writing-spec.ts");
const practice = loadTypeScriptModule(process.cwd(), "lib/note-lab/assessment-practice-scenario.ts");

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });
const data = practice.createAssessmentPracticeData();

check("practice route is authenticated, role-scoped, and hidden from indexing",
  page.includes("getAssessmentPracticeUser") && page.includes("notFound()")
  && page.includes("index: false") && page.includes("follow: false") && page.includes("nocache: true"));
check("practice access includes assessors and supervisors but not viewers",
  access.includes('practiceRoles = new Set(["admin", "assessment_coordinator", "reviewer"])')
  && !access.includes('practiceRoles = new Set(["admin", "assessment_coordinator", "reviewer", "viewer"])'));
check("practice data is explicitly synthetic and deterministic",
  data.resident_name === "Jordan Practice" && data.community === "Training community"
  && data.source_file === "synthetic-practice-packet.pdf"
  && data.assessment_notes.includes("Synthetic training scenario"));
check("practice scenario is created from the canonical empty assessment",
  scenarioSource.includes("createEmptyAssessmentToolData") && Object.keys(data).length === Object.keys(schema.createEmptyAssessmentToolData()).length);
check("practice renders canonical sections and conditional questions",
  workspace.includes("assessmentInterviewSections") && workspace.includes("getAssessmentInterviewQuestions")
  && workspace.includes("getRequiredAssessmentInterviewQuestions")
  && interview.assessmentInterviewSections.length === schema.assessmentToolSections.length
  && interview.assessmentInterviewSections.every((section) => interview.getAssessmentInterviewQuestions(section.key, data).length > 0));
check("language guidance comes from the canonical writing specification",
  workspace.includes("getAssessmentFieldWritingSpec") && workspace.includes("Example")
  && workspace.includes("specification.formatTemplate") && workspace.includes("specification.strongExample")
  && workspace.includes("getAssessmentNarrativeGuide") && workspace.includes("narrativeGuide.purpose"));
check("visible writing guidance uses natural prose rather than pipe separators",
  writing.getAssessmentFieldWritingSpecCoverage().coveredFields.every((field) => {
    const specification = writing.getAssessmentFieldWritingSpec(field);
    return specification && !specification.formatTemplate.includes("|") && !specification.strongExample.includes("|");
  }));
check("intake carryover is visibly distinguished from assessment answers",
  workspace.includes("isAssessmentIntakeInheritedField")
  && workspace.includes("From intake")
  && workspace.includes("This field carries forward from intake. Confirm or correct it during the assessment."));
check("practice autosave is browser-local and has no clinical persistence dependency",
  !workspace.includes("fetch(") && !workspace.includes("/api/") && !workspace.includes("indexedDB")
  && workspace.includes("window.localStorage") && workspace.includes("assessmentPracticeStoragePrefix")
  && !workspace.includes("sessionStorage")
  && !workspace.includes("AssessmentWorkspace") && !scenarioSource.includes("server-only"));
check("practice cannot sign, schedule, extract, or create a clinical record",
  !workspace.includes("Sign assessment") && !workspace.includes("Schedule assessment")
  && !workspace.includes("extraction") && !workspace.includes("Create assessment")
  && !workspace.includes("Save assessment"));
check("authored narrative questions expose their own compact guide disclosure",
  workspace.includes("hasUsefulWritingGuidance")
  && workspace.includes("PracticeQuestionGuide")
  && workspace.includes("<details")
  && workspace.includes("<summary")
  && workspace.includes("Guide for ${label}"));
check("self-evident controls cannot open filler guidance",
  workspace.includes('question.control === "textarea"')
  && !workspace.includes("structuredQuestionGuidance")
  && !workspace.includes("questionAction")
  && !workspace.includes("Open writing guide for"));
check("question guidance stays inline without a modal or forced sequence",
  workspace.includes("data-practice-field")
  && workspace.includes('aria-label={`Guide for ${label}`}')
  && !workspace.includes('role="dialog"')
  && !workspace.includes("QuestionGuidanceDialog")
  && !workspace.includes("guidedQuestionSteps")
  && !workspace.includes("Next field")
  && !workspace.includes("Finish walkthrough")
  && !workspace.includes("OK, go to question"));
check("production assessment remains a separately persisted clinical surface",
  assessmentWorkspace.includes("/api/assessments/") && assessmentWorkspace.includes("@/lib/offline/offline-assessment-store")
  && !assessmentWorkspace.includes("assessment-practice-scenario") && !assessmentWorkspace.includes("practice-assessment"));
check("practice copy stays restrained",
  !workspace.includes("Welcome to") && !workspace.includes("How to use")
  && workspace.includes("Guide <ChevronDown") && !workspace.includes("Practice complete")
  && !workspace.includes("Finish practice") && workspace.includes("Save and continue")
  && workspace.includes(">Back</button>") && !workspace.includes("Next section")
  && !workspace.includes("Open guide for ${section.label}"));
check("section progress is recoverable and explicitly committed before advancing",
  workspace.includes("readStoredAssessmentPractice")
  && workspace.includes("writeStoredAssessmentPractice")
  && workspace.includes("Autosaved in this browser")
  && workspace.includes("saveAndContinue"));
check("practice mirrors the production assessment interaction model",
  workspace.includes("assessmentPracticeNavigationGroups")
  && workspace.includes('aria-label="Assessment section navigation"')
  && workspace.includes('question.control === "yes_no"')
  && workspace.includes('question.control === "rating"')
  && workspace.includes('type="checkbox"')
  && workspace.includes("setAssessmentUnableReason"));
check("the resting guide launcher is hidden on the assessment practice route",
  coach.includes('pathname.startsWith("/note-lab/")')
  && coach.includes('pathname === "/note-lab"')
  && coach.includes("return null"));
check("assessment practice no longer depends on the global tutorial overlay",
  !workspace.includes("dispatchOperatorGuide")
  && !workspace.includes("ASSESSMENT_PRACTICE_TUTORIAL_ID"));

const failed = checks.filter((item) => !item.ok);
process.stdout.write(`${JSON.stringify({ ok: failed.length === 0, checks }, null, 2)}\n`);
if (failed.length > 0) process.exitCode = 1;
