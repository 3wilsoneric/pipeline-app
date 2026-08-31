import {
  getAssessmentNarrativeGuide,
  getAssessmentNarrativeGuideCoverage,
} from "./assessment-narrative-guide";
import type { AssessmentToolFieldKey } from "./assessment-tool-schema";

export type AssessmentAnswerFormat =
  | "dated_history"
  | "observation_report"
  | "risk_sequence"
  | "source_status_action"
  | "structured_lines"
  | "support_plan";

export type AssessmentFieldWritingSpec = {
  field: AssessmentToolFieldKey;
  label: string;
  preferredFormat: AssessmentAnswerFormat;
  formatLabel: string;
  lengthGuidance: string;
  formatTemplate: string;
  requiredElements: readonly string[];
  strongExample: string;
  guardrail: string;
};

type WritingSpecInput = Omit<
  AssessmentFieldWritingSpec,
  "field" | "label" | "formatLabel" | "guardrail"
>;

const formatLabels: Record<AssessmentAnswerFormat, string> = {
  dated_history: "Dated history",
  observation_report: "Observation and report",
  risk_sequence: "Current risk sequence",
  source_status_action: "Source, status, action",
  structured_lines: "Structured lines",
  support_plan: "Need and support plan",
};

const writingSpecs: Partial<Record<AssessmentToolFieldKey, WritingSpecInput>> = {
  prior_placements: {
    preferredFormat: "dated_history",
    lengthGuidance: "One line per placement",
    formatTemplate: "Setting | Approximate dates or duration | Why it ended | Source | What supported stability",
    requiredElements: ["Setting type", "Dates or duration", "Reason it ended", "Information source", "Support that helped"],
    strongExample: "Board-and-care | approximately 8 months | notice issued after repeated nighttime departures | discharge summary | evening check-ins reduced departures.",
  },
  prior_awol_failed_placements: {
    preferredFormat: "dated_history",
    lengthGuidance: "One line per event or placement",
    formatTemplate: "Date/timeframe | Setting | Observable event | Outcome | Source",
    requiredElements: ["Timeframe", "Setting", "What occurred", "Outcome", "Information source"],
    strongExample: "Spring 2025 | adult residential setting | left without notifying staff twice in one week | returned with outreach; placement later ended | facility discharge note.",
  },
  prior_5150_5250_holds: {
    preferredFormat: "dated_history",
    lengthGuidance: "One line per verified hold",
    formatTemplate: "Date/timeframe | Hold type | Presenting concern | Disposition | Verification source",
    requiredElements: ["Date or bounded timeframe", "Verified hold type", "Presenting concern", "Disposition", "Record source"],
    strongExample: "March 2025 | 5150 per hospital record | danger-to-self concern | admitted for stabilization, then discharged to residential care | discharge summary.",
  },
  crisis_er_utilization: {
    preferredFormat: "dated_history",
    lengthGuidance: "Most recent event first; 1-3 lines",
    formatTemplate: "Date/timeframe | Reason for visit | Intervention | Disposition | Source",
    requiredElements: ["Recency", "Reason crisis care was used", "Intervention", "Disposition", "Source"],
    strongExample: "Two weeks before assessment | escalating insomnia and agitation | evaluated in the ED; no admission | returned to current facility with follow-up | collateral and ED paperwork.",
  },
  secondary_diagnoses: {
    preferredFormat: "structured_lines",
    lengthGuidance: "One diagnosis per line",
    formatTemplate: "Exact diagnosis wording | Active or historical if documented | Source and date",
    requiredElements: ["Exact source wording", "Status when documented", "Source", "Record date when available"],
    strongExample: "Type 2 diabetes mellitus | active | hospital discharge summary dated [date].",
  },
  current_symptoms: {
    preferredFormat: "observation_report",
    lengthGuidance: "3-5 sentences",
    formatTemplate: "Direct observation. Client report with frequency/recency. Functional effect. Collateral agreement or conflict.",
    requiredElements: ["Direct observation", "Client-reported symptom", "Frequency or recency", "Functional effect", "Collateral or unknowns"],
    strongExample: "During the assessment, the client spoke softly and responded after brief pauses. The client reports anxiety most evenings for the past month, which delays sleep. Facility staff report the same evening pattern; severity has not been independently measured.",
  },
  cognition_orientation: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Orientation observed. Attention, memory, and thought process observed. Accommodation used. Limitation or collateral.",
    requiredElements: ["Orientation", "Attention or memory", "Thought process", "Interview reliability", "Accommodation or limitation"],
    strongExample: "The client was oriented to person, place, date, and situation. Responses were linear, though two questions required repetition. Recent recall was intact for the interview; remote history was supplemented by the discharge record.",
  },
  dress_assistance_details: {
    preferredFormat: "support_plan",
    lengthGuidance: "1-3 sentences",
    formatTemplate: "Task ability | Assistance level | Frequency | Cue, device, or safety concern | Source",
    requiredElements: ["Specific dressing task", "Assistance level", "Frequency", "Cue or device", "Observed versus reported"],
    strongExample: "Per staff report, the client selects clothing independently but needs one verbal prompt each morning to fasten buttons. No hands-on assistance or adaptive device is currently used.",
  },
  bathing_assistance_details: {
    preferredFormat: "support_plan",
    lengthGuidance: "1-3 sentences",
    formatTemplate: "Bathing step | Assistance level | Frequency | Safety support | Source",
    requiredElements: ["Specific bathing step", "Assistance level", "Frequency", "Safety support", "Observed versus reported"],
    strongExample: "Facility staff report standby assistance for shower entry and exit three times weekly. The client washes independently once positioned; a shower chair is used for fall prevention.",
  },
  adl_needs: {
    preferredFormat: "support_plan",
    lengthGuidance: "One line per ADL requiring support",
    formatTemplate: "ADL | Current ability | Assistance and frequency | Device or cue | Change from baseline",
    requiredElements: ["Specific ADL", "Current ability", "Assistance level", "Frequency", "Baseline or recent change"],
    strongExample: "Laundry | completes sorting and folding | staff starts the machine weekly and provides one reminder | no device | unchanged from reported baseline.",
  },
  mobility: {
    preferredFormat: "support_plan",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Mobility observed/reported. Device or assistance. Transfer and distance limits. Fall or safety consideration.",
    requiredElements: ["Observed or reported mobility", "Device", "Assistance level", "Transfer or distance limitation", "Safety concern"],
    strongExample: "The client walked approximately 50 feet with a front-wheeled walker and standby assistance. Staff report one-person assistance for shower transfers. No recent fall was reported; the latest fall record was not available.",
  },
  language_barrier_details: {
    preferredFormat: "support_plan",
    lengthGuidance: "2-3 sentences",
    formatTemplate: "Barrier observed | Effect on understanding or expression | Accommodation used | Response | Remaining limitation",
    requiredElements: ["Language or communication barrier", "Effect on interview", "Accommodation", "Observed response", "Remaining limitation"],
    strongExample: "The client primarily communicates in Spanish and requested interpretation for clinical questions. With a qualified interpreter, the client answered consistently and asked clarifying questions. Written English materials were not assessed for comprehension.",
  },
  linear_conversation_details: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Observed thought/speech pattern | Concrete example | Effect on interview | Prompt that helped | Remaining limitation",
    requiredElements: ["Observable pattern", "Concrete example", "Effect on reliability", "Helpful prompt or pacing", "Unresolved limitation"],
    strongExample: "Responses frequently shifted topics before answering the question. When asked about sleep, the client moved to an unrelated housing concern. Short questions and redirection produced a direct answer on three subsequent topics.",
  },
  peer_interaction_notes: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-3 sentences",
    formatTemplate: "Current interaction pattern | Frequency/context | Effect | Support that changes the outcome | Source",
    requiredElements: ["Observable interaction", "Frequency or context", "Effect on peers", "Effective support", "Source"],
    strongExample: "Per unit staff, the client joins peers for meals daily and usually responds appropriately. During crowded recreation periods, the client withdraws and returns after staff offer a quieter space.",
  },
  staff_interaction_notes: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-3 sentences",
    formatTemplate: "Current interaction pattern | Frequency/context | Effect | Effective staff approach | Source",
    requiredElements: ["Observable interaction", "Frequency or context", "Effect on care", "Effective approach", "Source"],
    strongExample: "Staff report the client accepts routine direction but asks for repeated explanation when plans change. A written schedule and one-step prompts reduce repeated questioning.",
  },
  programming_notes: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Program/activity | Attendance frequency | Participation observed | Barrier | Support that helps",
    requiredElements: ["Specific program", "Attendance frequency", "Participation level", "Barrier", "Helpful support"],
    strongExample: "The client attends two of five scheduled groups most weeks and participates when directly invited. Morning sedation is the reported barrier. Afternoon groups and a ten-minute reminder improve attendance.",
  },
  forensic_involvement_details: {
    preferredFormat: "source_status_action",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Verified status/event | Jurisdiction and date | Current requirement | Source | Verification still needed",
    requiredElements: ["Exact status or event", "Jurisdiction", "Relevant date", "Current requirement", "Verification source"],
    strongExample: "Per the county court order dated [date], the client is participating in a diversion program in [jurisdiction]. Monthly reporting is listed as active. The next reporting date requires confirmation with the assigned officer.",
  },
  arrest_last_two_years_details: {
    preferredFormat: "dated_history",
    lengthGuidance: "One line per arrest",
    formatTemplate: "Date | Jurisdiction | Charge as documented | Disposition/status | Source",
    requiredElements: ["Date", "Jurisdiction", "Documented charge", "Disposition or status", "Source"],
    strongExample: "[Date] | county jurisdiction | misdemeanor trespass per booking record | case status not available | booking summary supplied with referral.",
  },
  court_requirements: {
    preferredFormat: "source_status_action",
    lengthGuidance: "One line per active requirement",
    formatTemplate: "Requirement | Effective dates | Responsible party | Verification source | Follow-up",
    requiredElements: ["Exact requirement", "Effective date or term", "Responsible party", "Source", "Unresolved follow-up"],
    strongExample: "Attend monthly behavioral-health court review | active through [date] per order | client and assigned case manager | court order | confirm transportation plan before placement.",
  },
  court_dates: {
    preferredFormat: "structured_lines",
    lengthGuidance: "One hearing per line",
    formatTemplate: "Date and time | Court/jurisdiction | Purpose | Attendance requirement | Source",
    requiredElements: ["Date and time", "Court or jurisdiction", "Purpose", "Attendance requirement", "Verification source"],
    strongExample: "[Date/time] | county superior court | status review | remote attendance listed | minute order dated [date].",
  },
  probation_parole_justice: {
    preferredFormat: "source_status_action",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Supervision status | Agency/contact | Conditions | End/review date | Verification gap",
    requiredElements: ["Current supervision status", "Agency or contact", "Conditions", "Relevant date", "Verification gap"],
    strongExample: "The referral packet lists active probation supervision through [date]. The supervising agency is [agency], with monthly contact required. Officer contact information is present; current compliance has not been verified.",
  },
  medications_at_intake: {
    preferredFormat: "structured_lines",
    lengthGuidance: "One medication per line",
    formatTemplate: "Medication | Dose | Route | Frequency | Documented indication | Source/status",
    requiredElements: ["Medication name", "Dose", "Route", "Frequency", "MAR/pharmacy/prescriber source or reconciliation gap"],
    strongExample: "Olanzapine | 10 mg | oral | nightly | indication not listed on MAR | verified against MAR dated [date].",
  },
  prn_patterns: {
    preferredFormat: "structured_lines",
    lengthGuidance: "One PRN medication per line",
    formatTemplate: "PRN medication | Trigger | Uses in timeframe | Observed effect | Adverse effect | Source",
    requiredElements: ["Medication", "Trigger", "Frequency in a stated period", "Effect", "Adverse effect or none reported", "Source"],
    strongExample: "Hydroxyzine 25 mg PO PRN | anxiety | used twice in the past 14 days | staff documented reduced pacing | no adverse effect documented | MAR.",
  },
  substance_effect_on_baseline: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Substance/pattern | Baseline without use | Specific change with use | Functional/safety effect | Source",
    requiredElements: ["Substance pattern", "Baseline comparison", "Specific change", "Functional or safety effect", "Source or uncertainty"],
    strongExample: "The client reports stimulant use was associated with two to three nights without sleep and increased suspiciousness. During reported abstinence, sleep returned to six hours nightly. Collateral confirms the sleep pattern but not the amount used.",
  },
  substance_use_insight_details: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Client's stated understanding | Specific consequence recognized/not recognized | Readiness or goal | Collateral difference",
    requiredElements: ["Client's own account", "Recognized consequence", "Area not recognized", "Current goal or readiness", "Collateral disagreement"],
    strongExample: "The client identifies alcohol use as contributing to missed medication doses but does not connect it with prior housing loss. The client states a goal of avoiding alcohol after discharge. The case manager reports prior ambivalence about treatment.",
  },
  treatment_history: {
    preferredFormat: "dated_history",
    lengthGuidance: "One line per treatment episode",
    formatTemplate: "Program/type | Timeframe | Completion/status | Outcome | Helpful support/barrier | Source",
    requiredElements: ["Treatment type", "Timeframe", "Completion status", "Outcome", "Support or barrier"],
    strongExample: "Outpatient substance-use program | approximately 3 months in 2024 | did not complete | attended more consistently with transportation support | client report; program record unavailable.",
  },
  behavioral_history: {
    preferredFormat: "observation_report",
    lengthGuidance: "3-5 sentences",
    formatTemplate: "Most recent behavior and timeframe. Frequency/pattern. Trigger. Outcome/impact. Effective response and source.",
    requiredElements: ["Observable behavior", "Recency and frequency", "Trigger", "Outcome or impact", "Effective response", "Source"],
    strongExample: "Per facility staff, the most recent verbal outburst occurred one week ago and similar episodes occur about twice monthly. Episodes follow unexpected schedule changes and involve raised voice without threats or physical contact. A written schedule and ten minutes of space have shortened episodes.",
  },
  triggers: {
    preferredFormat: "structured_lines",
    lengthGuidance: "One trigger-response pair per line",
    formatTemplate: "Trigger/context | Early signs | Typical response | Effective support | Source",
    requiredElements: ["Specific trigger", "Early sign", "Observable response", "Effective support", "Source"],
    strongExample: "Unexpected room changes | repeated questioning and pacing | raises voice and leaves the area | previewing changes and offering two choices | staff report.",
  },
  physical_altercation_details: {
    preferredFormat: "risk_sequence",
    lengthGuidance: "Most recent event first; 3-5 sentences",
    formatTemplate: "Most recent event/date | Antecedent | Observable actions | Injury/intervention | Current precautions | Source",
    requiredElements: ["Event date or timeframe", "Antecedent", "Observable actions", "Injury or intervention", "Current precautions", "Source"],
    strongExample: "Per incident report, the most recent altercation occurred three months ago after a dispute over shared space. The client pushed a peer once; no injury was documented. Staff separated both parties, and no further physical events are recorded. Current precautions are routine conflict monitoring.",
  },
  last_self_harm_incident: {
    preferredFormat: "risk_sequence",
    lengthGuidance: "3-5 sentences",
    formatTemplate: "Date/timeframe | Behavior | Intent/precipitant as assessed | Injury/intervention | Outcome | Source",
    requiredElements: ["Most recent date", "Specific behavior", "Intent only if assessed", "Injury", "Intervention and outcome", "Source"],
    strongExample: "The discharge summary documents the most recent self-harm event approximately nine months ago. The client scratched the forearm after a family conflict; intent was not documented and no medical treatment was required. Staff increased observation temporarily, with no later event in the available record.",
  },
  current_self_harm_details: {
    preferredFormat: "risk_sequence",
    lengthGuidance: "3-6 sentences",
    formatTemplate: "Current ideation | Intent | Plan | Means/access | Recent behavior | Protective factors | Escalation source",
    requiredElements: ["Current ideation", "Intent", "Plan", "Means or access", "Recent behavior", "Protective factors", "Responsible clinical contact"],
    strongExample: "The client reports current passive thoughts of self-harm without stated intent or plan. The client denies access to the previously used means and reports no self-harm behavior in the past six months. The client identifies a sibling and treatment goals as protective factors. The current report was communicated to the responsible clinician under the safety protocol.",
  },
  current_safety_measures: {
    preferredFormat: "support_plan",
    lengthGuidance: "One line per active measure",
    formatTemplate: "Measure | Frequency/level | Responsible role | Start/review date | Escalation trigger | Source",
    requiredElements: ["Specific precaution", "Frequency or level", "Responsible role", "Review timing", "Escalation trigger", "Authorizing source"],
    strongExample: "Safety check every 15 minutes | nursing staff | initiated [date], review each shift | escalate for stated intent, plan, or new behavior | current nursing order.",
  },
  last_assault_details: {
    preferredFormat: "risk_sequence",
    lengthGuidance: "3-5 sentences",
    formatTemplate: "Most recent date | Antecedent | Observable actions | Injury | Intervention/outcome | Source",
    requiredElements: ["Most recent date", "Antecedent", "Observable actions", "Injury", "Intervention and outcome", "Source"],
    strongExample: "Per the incident record, the most recent assault occurred approximately 14 months ago during an argument about personal property. The client struck another resident once; a minor bruise was documented. Staff separated the residents and changed room assignments, with no later assault in the available record.",
  },
  elopement_risk: {
    preferredFormat: "risk_sequence",
    lengthGuidance: "3-5 sentences",
    formatTemplate: "Most recent departure/attempt | Pattern and trigger | Destination/return | Current intent | Precautions | Source",
    requiredElements: ["Most recent event", "Frequency or pattern", "Trigger", "Outcome or return", "Current intent", "Precaution"],
    strongExample: "Staff report the client last left without notice four months ago after a denied pass and returned independently after two hours. Two similar events occurred that month. The client denies current intent to leave; current support is advance review of passes and check-in at shift change.",
  },
  aggression_risk: {
    preferredFormat: "risk_sequence",
    lengthGuidance: "3-5 sentences",
    formatTemplate: "Current risk status | Recent behavior/timeframe | Trigger | Severity/impact | Protective factors | Effective response",
    requiredElements: ["Current versus historical status", "Recent behavior", "Trigger", "Severity or impact", "Protective factor", "Effective response"],
    strongExample: "No current threats or physical aggression were observed or reported. The most recent verbal threat was documented two months ago after an unexpected limit was set; no weapon or injury was involved. The client responds to space, clear choices, and follow-up with a familiar staff member.",
  },
  si_hi_history: {
    preferredFormat: "risk_sequence",
    lengthGuidance: "3-6 sentences",
    formatTemplate: "Current SI/HI | Historical event and date | Intent/plan/means as assessed | Behavior/intervention | Protective factors | Source",
    requiredElements: ["Current SI status", "Current HI status", "Most recent historical event", "Intent/plan/means only if assessed", "Protective factors", "Source"],
    strongExample: "The client denies current suicidal and homicidal ideation, intent, and plan. The hospital record documents suicidal ideation without an attempt approximately one year ago; access to means was not described. The client identifies family contact and housing goals as protective factors.",
  },
  auditory_hallucination_nature: {
    preferredFormat: "observation_report",
    lengthGuidance: "3-5 sentences",
    formatTemplate: "Client-described experience | Most recent occurrence/frequency | Command or safety content | Distress/impact | Observation/collateral",
    requiredElements: ["Client's description", "Recency", "Frequency", "Command or safety relevance", "Distress or impact", "Observation separated from report"],
    strongExample: "The client reports hearing an unfamiliar voice calling their name several evenings per week, most recently yesterday. The client denies command content and describes mild distraction during reading. No response to unseen stimuli was observed during this assessment; staff report occasional nighttime self-talk.",
  },
  auditory_hallucination_triggers: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-3 sentences",
    formatTemplate: "Trigger/context | Frequency of association | Client response | Source/uncertainty",
    requiredElements: ["Specific context", "How consistently it precedes symptoms", "Client response", "Source", "Uncertainty"],
    strongExample: "The client reports voices are more likely after two nights of poor sleep and in crowded spaces. Quiet space and sleep improve the experience. Staff confirm the sleep association but have not observed a consistent crowd-related pattern.",
  },
  visual_hallucination_details: {
    preferredFormat: "observation_report",
    lengthGuidance: "3-5 sentences",
    formatTemplate: "Client-described visual experience | Recency/frequency/duration | Context | Distress/safety impact | Observation/collateral",
    requiredElements: ["Description in neutral language", "Recency", "Frequency or duration", "Context", "Distress or safety effect", "Source"],
    strongExample: "The client reports seeing brief shadows at the edge of vision about once weekly, most recently three days ago, usually when falling asleep. The client reports no resulting unsafe behavior. No visual tracking of unseen stimuli was observed during the interview.",
  },
  visual_hallucination_recent: {
    preferredFormat: "dated_history",
    lengthGuidance: "1-3 sentences",
    formatTemplate: "Most recent date/timeframe | What the client experienced | Duration/context | Response/outcome",
    requiredElements: ["Most recent occurrence", "Description", "Duration", "Context", "Response or outcome"],
    strongExample: "The client reports the most recent visual experience occurred three nights ago while falling asleep, lasted less than one minute, and resolved after turning on the light.",
  },
  olfactory_hallucination_details: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Reported smell | Recency/frequency | Context | Alternative source checked | Distress/impact",
    requiredElements: ["Client-described smell", "Recency", "Frequency", "Context", "Environmental or medical source status", "Impact"],
    strongExample: "The client reports smelling smoke without an identified source about twice monthly, most recently one week ago. Staff checked the immediate environment and found no smoke. The experience causes the client to leave the room but has not led to emergency action.",
  },
  olfactory_hallucination_impact: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-3 sentences",
    formatTemplate: "Experience | Effect on behavior/function | Distress/safety consequence | Helpful response",
    requiredElements: ["Specific functional effect", "Distress", "Safety consequence", "Coping or support", "Observed outcome"],
    strongExample: "When the client reports the smell, they stop the current activity and check nearby rooms. Distress is described as moderate; no unsafe response is reported. Grounding and an environmental check usually allow return to activity within ten minutes.",
  },
  tactile_hallucination_details: {
    preferredFormat: "observation_report",
    lengthGuidance: "3-5 sentences",
    formatTemplate: "Client-described sensation | Location | Recency/frequency | Medical/environmental source status | Distress/functional effect",
    requiredElements: ["Client's description", "Body location", "Recency", "Frequency", "Other source assessed or unknown", "Impact"],
    strongExample: "The client reports a crawling sensation on both forearms several evenings per week, most recently yesterday. No visible skin change was noted by staff, and a medical cause has not been ruled out. The sensation interrupts sleep for approximately 20 minutes.",
  },
  gustatory_hallucination_details: {
    preferredFormat: "observation_report",
    lengthGuidance: "3-5 sentences",
    formatTemplate: "Client-described taste | Recency/frequency | Context | Medical/medication source status | Nutrition/safety effect",
    requiredElements: ["Client's description", "Recency", "Frequency", "Context", "Alternative source status", "Impact on eating or safety"],
    strongExample: "The client reports a metallic taste without food present about once weekly, most recently four days ago. The client continues eating and reports no choking or food refusal. Medication and dental causes have not been reviewed in the available record.",
  },
  hallucination_coping_strategies: {
    preferredFormat: "support_plan",
    lengthGuidance: "One line per strategy",
    formatTemplate: "Symptom/context | Coping strategy | Independent or prompted | Observed effect | Source",
    requiredElements: ["Symptom context", "Specific strategy", "Level of prompting", "Observed effect", "Source"],
    strongExample: "Auditory experiences at night | headphones and grounding exercise | used independently | client reports reduced distress from 7/10 to 3/10 | client report.",
  },
  hallucination_distress_impairment: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Experience | Distress level | Frequency | Effect on sleep/self-care/participation/safety | Source",
    requiredElements: ["Specific experience", "Distress", "Frequency", "Functional domain affected", "Severity or duration", "Source"],
    strongExample: "The client describes moderate distress from nighttime voices approximately three evenings weekly. Sleep onset is delayed by about one hour, while self-care and meal attendance are reportedly unchanged. This is based on client report and one week of staff observation.",
  },
  hallucination_functional_impact: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Symptom | Specific functional task affected | Frequency/severity | Support needed | Response",
    requiredElements: ["Specific symptom", "Functional task", "Frequency", "Support needed", "Outcome with support"],
    strongExample: "Reported voices interrupt reading groups about once weekly. The client leaves for a quieter area and returns with one staff prompt, usually within 15 minutes. No effect on bathing or meals is reported.",
  },
  hallucination_treatment_history: {
    preferredFormat: "dated_history",
    lengthGuidance: "One line per intervention",
    formatTemplate: "Treatment/support | Timeframe | Target symptom | Response | Adverse effect/barrier | Source",
    requiredElements: ["Intervention", "Timeframe", "Target symptom", "Observed or reported response", "Barrier or adverse effect", "Source"],
    strongExample: "Medication adjustment | during hospitalization in 2025 | auditory experiences | discharge summary notes reduced frequency | sedation documented | hospital record.",
  },
  physical_health_diagnoses: {
    preferredFormat: "structured_lines",
    lengthGuidance: "One condition per line",
    formatTemplate: "Condition exactly as documented | Current status | Treating source | Record date | Verification gap",
    requiredElements: ["Exact condition wording", "Current status", "Source", "Record date", "Unverified item"],
    strongExample: "Hypertension | active; current control not stated | primary-care problem list dated [date] | latest blood-pressure record not supplied.",
  },
  physical_health_measures: {
    preferredFormat: "support_plan",
    lengthGuidance: "One line per active measure",
    formatTemplate: "Condition | Medication/monitoring/support | Frequency | Responsible role | Follow-up needed",
    requiredElements: ["Condition", "Specific measure", "Frequency", "Responsible role", "Follow-up or missing record"],
    strongExample: "Hypertension | prescribed medication and blood-pressure check | weekly per current order | nursing staff | obtain latest primary-care note before transition.",
  },
  diabetic_details: {
    preferredFormat: "support_plan",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Diabetes type/status | Medication | Glucose monitoring | Diet/support | Recent concern | Source",
    requiredElements: ["Documented type or unknown", "Medication", "Monitoring frequency", "Diet or assistance", "Recent concern", "Source"],
    strongExample: "The record lists type 2 diabetes treated with oral medication. Staff check glucose each morning per MAR and the client follows a carbohydrate-managed diet without hands-on assistance. No recent hypoglycemic event is documented in the supplied record.",
  },
  special_diet_details: {
    preferredFormat: "support_plan",
    lengthGuidance: "1-3 sentences",
    formatTemplate: "Diet order | Reason if documented | Texture/fluid limits | Assistance/monitoring | Source and date",
    requiredElements: ["Exact diet", "Documented reason", "Texture or fluid restriction", "Assistance", "Source"],
    strongExample: "Current order is a low-sodium regular-texture diet; the indication is listed as hypertension. No fluid restriction or feeding assistance is documented. Source: diet order dated [date].",
  },
  skin_integrity_details: {
    preferredFormat: "support_plan",
    lengthGuidance: "One line per issue",
    formatTemplate: "Location | Current condition | Measurement/stage if documented | Treatment | Monitoring | Source/date",
    requiredElements: ["Location", "Current appearance or documented stage", "Treatment", "Monitoring frequency", "Source and date"],
    strongExample: "Right heel | healing abrasion; no stage documented | covered dressing | checked each shift by nursing | wound note dated [date].",
  },
  additional_health_notes: {
    preferredFormat: "source_status_action",
    lengthGuidance: "Only new, placement-relevant information; 1-4 sentences",
    formatTemplate: "New health fact | Current effect/support need | Source | Verification or follow-up action",
    requiredElements: ["New health fact", "Placement relevance", "Source", "Current support", "Follow-up"],
    strongExample: "The client reports intermittent dental pain that limits hard foods. No dental evaluation is included in the packet. The current facility provides soft-food alternatives and will request a dental appointment.",
  },
  family_involvement: {
    preferredFormat: "support_plan",
    lengthGuidance: "One line per involved person",
    formatTemplate: "Relationship | Contact frequency | Support provided | Reliability/willingness | Client consent | Source",
    requiredElements: ["Relationship", "Contact pattern", "Specific support", "Willingness or reliability", "Consent", "Source"],
    strongExample: "Sibling | weekly phone contact | emotional support and transportation to appointments | willingness confirmed by phone | client consents to coordination.",
  },
  friendships_social_connections: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Connection/relationship | Contact frequency | Activity/support | Client satisfaction | Barrier or concern",
    requiredElements: ["Type of connection", "Frequency", "Shared activity or support", "Client's view", "Barrier"],
    strongExample: "The client identifies two friends from a prior program and speaks with one by phone about twice monthly. The client values the contact but reports transportation limits in-person visits. No current conflict was reported.",
  },
  prior_living_situation: {
    preferredFormat: "dated_history",
    lengthGuidance: "Describe the setting immediately before the current one",
    formatTemplate: "Setting | Dates/duration | Household/support | Reason for transition | Source",
    requiredElements: ["Setting type", "Duration", "Who lived/provided support", "Reason for transition", "Source"],
    strongExample: "Room-and-board setting | approximately six months | shared room with medication reminders from staff | transferred after hospitalization | client and discharge summary agree.",
  },
  housing_history: {
    preferredFormat: "dated_history",
    lengthGuidance: "Most recent first; one line per period",
    formatTemplate: "Timeframe | Housing type | Duration/stability | Why it changed | Support/barrier | Source",
    requiredElements: ["Timeframe", "Housing type", "Duration", "Reason for change", "Support or barrier", "Source"],
    strongExample: "2024 to early 2025 | supportive housing | approximately ten months | lease ended after repeated unpaid rent | representative payee support was not in place | case-manager report.",
  },
  benefits_income_status: {
    preferredFormat: "source_status_action",
    lengthGuidance: "One line per benefit or income source",
    formatTemplate: "Benefit/income | Active/suspended/pending/unknown | Amount if verified | Payee/contact | Action needed | Source",
    requiredElements: ["Benefit type", "Current status", "Verified amount only if relevant", "Payee or contact", "Next action", "Source"],
    strongExample: "SSI | suspended during hospitalization per benefits letter | amount not verified | no current payee listed | case manager to submit reinstatement documents before discharge.",
  },
  preferred_facility_characteristics: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-4 sentences in the client's voice",
    formatTemplate: "Preferred characteristic | Client's reason | Priority | Acceptable alternative | Support needed",
    requiredElements: ["Client-stated preference", "Reason", "Priority", "Acceptable alternative", "Support needed"],
    strongExample: "The client prefers a smaller residence because crowded common areas increase anxiety. A private room is preferred but not required. The client would consider a shared room if a quiet area and predictable schedule are available.",
  },
  discharge_planning_goals: {
    preferredFormat: "support_plan",
    lengthGuidance: "One line per goal",
    formatTemplate: "Client goal | Why it matters | Next step | Responsible person | Target timeframe | Barrier/support",
    requiredElements: ["Client-stated goal", "Reason", "Next step", "Owner", "Timeframe", "Barrier or support"],
    strongExample: "Resume community college | supports the client's stated vocational goal | obtain transcript and meet counselor | client with case-manager support | within 60 days of placement | transportation planning needed.",
  },
  placement_preferences_concerns: {
    preferredFormat: "observation_report",
    lengthGuidance: "2-4 sentences",
    formatTemplate: "Preference/concern | Client's reason | Deal breaker or flexibility | Needed accommodation | Unresolved question",
    requiredElements: ["Preference or concern", "Client's reason", "Priority or flexibility", "Needed support", "Unresolved question"],
    strongExample: "The client is concerned about placement far from family because weekly visits are a primary support. The client is flexible about community if public transportation is available. Weekend transportation options remain to be confirmed.",
  },
  additional_information: {
    preferredFormat: "source_status_action",
    lengthGuidance: "Only information not captured elsewhere; 1-4 sentences",
    formatTemplate: "New fact | Why it matters | Source/status | Owner and next action",
    requiredElements: ["New, nonduplicative fact", "Assessment or placement relevance", "Source", "Verification status", "Next action when needed"],
    strongExample: "The case manager reports the client's identification card is expired, which may delay benefits reinstatement. A replacement request has not been verified. The case manager will confirm submission before transition.",
  },
  placement_process_questions: {
    preferredFormat: "source_status_action",
    lengthGuidance: "One question per line",
    formatTemplate: "Question/concern | Raised by whom | Why it matters | Owner | Follow-up date/status",
    requiredElements: ["Specific question", "Who raised it", "Placement relevance", "Responsible owner", "Follow-up timing"],
    strongExample: "Can the residence support weekly off-site therapy? | client and therapist | continuity of care | placement coordinator | confirm before community review.",
  },
};

export function getAssessmentFieldWritingSpec(field: AssessmentToolFieldKey): AssessmentFieldWritingSpec | null {
  const guide = getAssessmentNarrativeGuide(field);
  const specification = writingSpecs[field];
  if (!guide || !specification) return null;
  return {
    field,
    label: guide.label,
    formatLabel: formatLabels[specification.preferredFormat],
    guardrail: guide.guardrail,
    ...specification,
  };
}

export function getAssessmentFieldWritingSpecCoverage() {
  const coachableFields = getAssessmentNarrativeGuideCoverage().coachableFields;
  const missingFields = coachableFields.filter((field) => !writingSpecs[field]);
  return {
    coachableFields,
    coveredFields: coachableFields.filter((field) => Boolean(writingSpecs[field])),
    missingFields,
  };
}

const coverage = getAssessmentFieldWritingSpecCoverage();
if (coverage.missingFields.length > 0) {
  throw new Error(`Assessment writing specifications are missing for: ${coverage.missingFields.join(", ")}`);
}
