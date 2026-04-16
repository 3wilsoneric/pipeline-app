"use client";

import React, { useId, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  FileScan,
  FileUp,
  SearchCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";

const requiredPacketFields = [
  "presentingNeeds",
  "levelOfCare",
  "mobility",
  "behaviors",
  "medicationCount",
  "riskNotes",
  "admissionDecision",
  "communityPreference",
  "guardianContact",
  "medicalHistory",
] as const;

type ExtractedFieldKey = (typeof requiredPacketFields)[number];

type ExtractedFields = Record<ExtractedFieldKey, string>;

const mockAssessments = [
  {
    id: 1,
    patientName: "Robert Thompson",
    assessor: "Sarah Johnson",
    type: "Initial Assessment",
    status: "scheduled",
    scheduledDate: "2026-04-10",
    scheduledTime: "10:00 AM",
    location: "County General Hospital",
    priority: "high",
    packageStatus: "missing",
    extractedAt: "",
    uploadedFileName: "",
    extracted: {
      presentingNeeds: "",
      levelOfCare: "",
      mobility: "",
      behaviors: "",
      medicationCount: "",
      riskNotes: "",
      admissionDecision: "",
      communityPreference: "",
      guardianContact: "",
      medicalHistory: "",
    },
    notes: "Emergency referral with elevated safety concerns.",
    recommendation: "Await packet upload before clinician review.",
  },
  {
    id: 2,
    patientName: "Patricia Martinez",
    assessor: "David Chen",
    type: "Follow-up Assessment",
    status: "in-progress",
    scheduledDate: "2026-04-09",
    scheduledTime: "2:00 PM",
    location: "Outpatient Clinic",
    priority: "medium",
    packageStatus: "scanned",
    extractedAt: "Apr 9, 8:42 AM",
    uploadedFileName: "martinez-follow-up.pdf",
    extracted: {
      presentingNeeds: "Mood stabilization, medication review",
      levelOfCare: "Residential",
      mobility: "Independent",
      behaviors: "No acute aggression noted",
      medicationCount: "6 active meds",
      riskNotes: "Monitor sleep disruption and anxiety escalation",
      admissionDecision: "Proceed to clinical staffing",
      communityPreference: "Santa Clarita",
      guardianContact: "Ana Martinez · (555) 311-4400",
      medicalHistory: "Bipolar I disorder, intermittent insomnia",
    },
    notes: "Follow-up after packet review.",
    recommendation: "Proceed to clinical staffing.",
  },
  {
    id: 3,
    patientName: "David Garcia",
    assessor: "Sarah Johnson",
    type: "Initial Assessment",
    status: "completed",
    scheduledDate: "2026-04-08",
    scheduledTime: "9:00 AM",
    location: "Community Center",
    priority: "low",
    packageStatus: "scanned",
    extractedAt: "Apr 8, 7:55 AM",
    uploadedFileName: "garcia-community-intake.pdf",
    extracted: {
      presentingNeeds: "Anxiety management, outpatient coordination",
      levelOfCare: "Community-based",
      mobility: "Independent",
      behaviors: "No safety events documented",
      medicationCount: "2 active meds",
      riskNotes: "Low acute risk",
      admissionDecision: "Route to community support placement",
      communityPreference: "Riverside",
      guardianContact: "Self",
      medicalHistory: "Anxiety disorder, asthma",
    },
    notes: "Packet completed and signed off.",
    recommendation: "Route to community support placement.",
  },
  {
    id: 4,
    patientName: "Mary Robinson",
    assessor: "Michael Lee",
    type: "Crisis Assessment",
    status: "scheduled",
    scheduledDate: "2026-04-10",
    scheduledTime: "4:00 PM",
    location: "St. Mary's Hospital",
    priority: "high",
    packageStatus: "uploaded",
    extractedAt: "",
    uploadedFileName: "robinson-hospital-packet.pdf",
    extracted: {
      presentingNeeds: "",
      levelOfCare: "",
      mobility: "",
      behaviors: "",
      medicationCount: "",
      riskNotes: "",
      admissionDecision: "",
      communityPreference: "",
      guardianContact: "",
      medicalHistory: "",
    },
    notes: "Hospital packet received, scan pending.",
    recommendation: "Run package scan and complete crisis review.",
  },
];

type Assessment = (typeof mockAssessments)[number];

const statusTone = {
  scheduled: "bg-slate-100 text-slate-700 border-slate-300",
  "in-progress": "bg-amber-100 text-amber-700 border-amber-300",
  completed: "bg-slate-100 text-slate-700 border-slate-300",
} as const;

const priorityTone = {
  high: "bg-red-100 text-red-700 border-red-300",
  medium: "bg-amber-100 text-amber-700 border-amber-300",
  low: "bg-sky-100 text-sky-700 border-sky-300",
} as const;

const packageTone = {
  missing: "bg-slate-100 text-slate-700 border-slate-300",
  uploaded: "bg-blue-100 text-blue-700 border-blue-300",
  scanned: "bg-slate-100 text-slate-700 border-slate-300",
} as const;

interface AssessmentsProps {
  searchTerm: string;
}

export default function Assessments({ searchTerm }: AssessmentsProps) {
  const [assessments, setAssessments] = useState(mockAssessments);
  const [filterStatus, setFilterStatus] = useState("All");
  const [selectedId, setSelectedId] = useState(mockAssessments[0].id);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputId = useId();

  const filteredAssessments = useMemo(() => {
    return assessments.filter((assessment) => {
      const matchesSearch =
        assessment.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        assessment.assessor.toLowerCase().includes(searchTerm.toLowerCase()) ||
        assessment.location.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus =
        filterStatus === "All" || assessment.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [assessments, filterStatus, searchTerm]);

  const selectedAssessment =
    filteredAssessments.find((assessment) => assessment.id === selectedId) ??
    filteredAssessments[0] ??
    assessments[0];

  const missingFields = selectedAssessment
    ? getMissingFields(selectedAssessment.extracted)
    : [];

  const completionPercent = selectedAssessment
    ? Math.round(
        ((requiredPacketFields.length - missingFields.length) /
          requiredPacketFields.length) *
          100,
      )
    : 0;

  const updateAssessment = (
    id: number,
    updater: (assessment: Assessment) => Assessment,
  ) => {
    setAssessments((current) =>
      current.map((assessment) =>
        assessment.id === id ? updater(assessment) : assessment,
      ),
    );
  };

  const uploadPackage = (fileName?: string) => {
    if (!selectedAssessment) return;

    updateAssessment(selectedAssessment.id, (assessment) => ({
      ...assessment,
      packageStatus: "uploaded",
      uploadedFileName: fileName ?? assessment.uploadedFileName ?? "packet-upload.pdf",
      notes:
        assessment.notes ||
        "Assessment package uploaded and ready for extraction.",
      recommendation:
        assessment.recommendation || "Run extraction and complete missing fields.",
    }));
  };

  const scanPackage = (fileName?: string) => {
    if (!selectedAssessment) return;

    const extracted = createMockExtraction(selectedAssessment.patientName);

    updateAssessment(selectedAssessment.id, (assessment) => ({
      ...assessment,
      packageStatus: "scanned",
      extractedAt: "Apr 9, 11:18 AM",
      uploadedFileName:
        fileName ?? assessment.uploadedFileName ?? "packet-upload.pdf",
      extracted,
      notes:
        assessment.notes ||
        "Packet extracted into structured fields; complete missing items manually.",
      recommendation: deriveRecommendation(extracted),
    }));
  };

  const handleDroppedFiles = (files: FileList | null) => {
    if (!files?.length || !selectedAssessment) return;
    const fileName = files[0].name;
    uploadPackage(fileName);
    scanPackage(fileName);
  };

  const updateExtractedField = (field: ExtractedFieldKey, value: string) => {
    if (!selectedAssessment) return;

    updateAssessment(selectedAssessment.id, (assessment) => {
      const nextExtracted = {
        ...assessment.extracted,
        [field]: value,
      };

      return {
        ...assessment,
        extracted: nextExtracted,
        recommendation: deriveRecommendation(nextExtracted),
      };
    });
  };

  const updateTextField = (
    field: "notes" | "recommendation",
    value: string,
  ) => {
    if (!selectedAssessment) return;

    updateAssessment(selectedAssessment.id, (assessment) => ({
      ...assessment,
      [field]: value,
    }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <input
        id={fileInputId}
        type="file"
        className="hidden"
        accept=".pdf,.doc,.docx,.txt,.rtf,.png,.jpg,.jpeg"
        onChange={(event) => {
          handleDroppedFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />

      <div className="shrink-0 rounded-2xl border-2 border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b-2 border-slate-200 px-4 py-3">
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
            Packet operations
          </div>
          <div className="text-[12px] text-slate-500">
            {filteredAssessments.length} packets in view
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="text-[12px] text-slate-500">
            New intake starts the packet. This page is for reviewing and finishing packet forms that already exist.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-[12px]"
            >
              <option value="All">All statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="in-progress">In progress</option>
              <option value="completed">Completed</option>
            </select>
            <button
              onClick={() => scanPackage()}
              className="app-gradient-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-medium transition-all"
            >
              <FileScan size={14} />
              Re-run extraction
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[0.9fr_1.4fr]">
        <div className="min-h-0 overflow-hidden rounded-2xl border-2 border-slate-200 bg-white">
          <div className="border-b-2 border-slate-200 px-4 py-3">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              Packet queue
            </div>
            <div className="mt-1 text-[12px] text-slate-500">
              Choose a referral packet and complete the intake form.
            </div>
          </div>
          <div className="h-full overflow-auto p-3">
            <div className="space-y-2">
              {filteredAssessments.map((assessment) => {
                const assessmentMissing = getMissingFields(assessment.extracted);

                return (
                  <button
                    key={assessment.id}
                    onClick={() => setSelectedId(assessment.id)}
                    className={`block w-full rounded-2xl border p-3 text-left transition-colors ${
                      selectedAssessment?.id === assessment.id
                        ? "border-indigo-200 bg-indigo-50/35"
                        : "border-slate-200 bg-slate-50/35 hover:border-slate-300 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[12px] font-medium text-slate-900">
                          {assessment.patientName}
                        </div>
                        <div className="mt-1 text-[12px] text-slate-500">
                          {assessment.type} · {assessment.assessor}
                        </div>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-1 text-[11px] font-medium ${priorityTone[assessment.priority as keyof typeof priorityTone]}`}
                      >
                        {assessment.priority}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge tone={statusTone[assessment.status as keyof typeof statusTone]}>
                        {assessment.status}
                      </Badge>
                      <Badge
                        tone={
                          packageTone[
                            assessment.packageStatus as keyof typeof packageTone
                          ]
                        }
                      >
                        {assessment.packageStatus}
                      </Badge>
                    </div>

                    <div className="mt-3 rounded-2xl border-2 border-slate-200 bg-white p-2 text-[12px] text-slate-500">
                      <div className="flex items-center justify-between">
                        <span>Completion</span>
                        <span className="font-medium text-slate-700">
                          {Math.round(
                            ((requiredPacketFields.length - assessmentMissing.length) /
                              requiredPacketFields.length) *
                              100,
                          )}
                          %
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-slate-200">
                        <div
                          className="h-1.5 rounded-full bg-slate-700"
                          style={{
                            width: `${Math.round(
                              ((requiredPacketFields.length - assessmentMissing.length) /
                                requiredPacketFields.length) *
                                100,
                            )}%`,
                          }}
                        />
                      </div>
                      <div className="mt-2 truncate text-[11px] text-slate-500">
                        {assessmentMissing.length > 0
                          ? `${assessmentMissing.length} fields still need review`
                          : "All required fields captured"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-h-0 overflow-auto rounded-2xl border-2 border-slate-200 bg-white">
          {selectedAssessment && (
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-slate-200 pb-4">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                    Packet workspace
                  </div>
                  <h2 className="mt-1 text-[16px] font-medium text-slate-900">
                    {selectedAssessment.patientName}
                  </h2>
                  <div className="mt-1 text-[12px] text-slate-500">
                    {selectedAssessment.type} · {selectedAssessment.location}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge tone={statusTone[selectedAssessment.status as keyof typeof statusTone]}>
                    {selectedAssessment.status}
                  </Badge>
                  <Badge
                    tone={
                      packageTone[
                        selectedAssessment.packageStatus as keyof typeof packageTone
                      ]
                    }
                  >
                    {selectedAssessment.packageStatus}
                  </Badge>
                </div>
              </div>

              <label
                htmlFor={fileInputId}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  handleDroppedFiles(event.dataTransfer.files);
                }}
                className={`rounded-2xl border border-dashed p-4 transition-colors ${
                  isDragging
                    ? "border-indigo-200 bg-indigo-50/30"
                    : "border-slate-300 bg-slate-50/70"
                } cursor-pointer`}
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500">
                    <UploadCloud size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-slate-900">
                      Add or replace packet files
                    </div>
                    <div className="mt-1 text-[12px] text-slate-500">
                      Use this when a packet already exists and needs a refreshed extraction. Initial packet drop now lives in New intake.
                    </div>
                    <div className="mt-2 text-[12px] text-slate-600">
                      {selectedAssessment.uploadedFileName
                        ? `Current file: ${selectedAssessment.uploadedFileName}`
                        : "No packet file uploaded yet."}
                    </div>
                  </div>
                </div>
              </label>

              <div className="grid gap-3 md:grid-cols-3">
                <CompactCard
                  icon={<FileUp size={15} />}
                  title="File"
                  value={selectedAssessment.uploadedFileName || "Waiting for upload"}
                />
                <CompactCard
                  icon={<SearchCheck size={15} />}
                  title="Extraction"
                  value={
                    selectedAssessment.packageStatus === "scanned"
                      ? `${completionPercent}% complete`
                      : "Pending"
                  }
                />
                <CompactCard
                  icon={<Sparkles size={15} />}
                  title="Routing"
                  value={selectedAssessment.recommendation}
                />
              </div>

              <div className="rounded-2xl border-2 border-slate-200 bg-white">
                <div className="border-b-2 border-slate-200 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-[12px] font-medium text-slate-900">
                        <CheckCircle2 size={15} className="text-slate-700" />
                        Extracted packet form
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        Auto-filled where possible. Complete anything extraction missed.
                      </div>
                    </div>
                    <div className="rounded-xl border-2 border-slate-200 bg-slate-50/70 px-3 py-2 text-right">
                      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                        Missing
                      </div>
                      <div className="mt-1 text-[12px] font-medium text-slate-900">
                        {missingFields.length} fields
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2">
                  {requiredPacketFields.map((field) => (
                    <EditableField
                      key={field}
                      label={fieldLabels[field]}
                      value={selectedAssessment.extracted[field]}
                      missing={selectedAssessment.extracted[field].trim().length === 0}
                      onChange={(value) => updateExtractedField(field, value)}
                    />
                  ))}
                </div>
              </div>

              {missingFields.length > 0 ? (
                <div className="rounded-2xl border-2 border-amber-200 bg-white px-4 py-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={16} className="mt-0.5 text-amber-600" />
                    <div>
                      <div className="text-[12px] font-medium text-amber-900">
                        Manual entry required
                      </div>
                      <div className="mt-1 text-[11px] text-amber-800">
                        Extraction did not populate {missingFields.length} required fields. Finish those fields before final routing.
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-indigo-200 bg-white px-4 py-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 size={16} className="mt-0.5 text-slate-700" />
                    <div>
                      <div className="text-[12px] font-medium text-slate-900">
                        Packet form complete
                      </div>
                      <div className="mt-1 text-[11px] text-slate-600">
                        Required fields are captured. You can finalize notes and routing below.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <TextAreaField
                  label="Clinician notes"
                  value={selectedAssessment.notes}
                  onChange={(value) => updateTextField("notes", value)}
                />
                <TextAreaField
                  label="Routing decision"
                  value={selectedAssessment.recommendation}
                  onChange={(value) => updateTextField("recommendation", value)}
                />
              </div>

              <div className="rounded-2xl border-2 border-slate-200 bg-white">
                <div className="border-b-2 border-slate-200 px-4 py-3">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-slate-900">
                    <CircleAlert size={15} className="text-amber-500" />
                    Review flow
                  </div>
                </div>
                <div className="grid gap-2 px-4 py-4 text-[12px] text-slate-600">
                  <div>1. Drop or upload the packet file.</div>
                  <div>2. Extraction populates the intake form below.</div>
                  <div>3. Complete the missing fields manually.</div>
                  <div>4. Finalize clinician notes and routing decision.</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.06em] ${tone}`}
    >
      {children}
    </span>
  );
}

function CompactCard({
  icon,
  title,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border-2 border-slate-200 bg-slate-50/30 p-3">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
        <span className="text-slate-500">{icon}</span>
        {title}
      </div>
      <div className="mt-2 text-[12px] font-medium leading-5 text-slate-800">
        {value}
      </div>
    </div>
  );
}

function EditableField({
  label,
  value,
  missing,
  onChange,
}: {
  label: string;
  value: string;
  missing: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        missing ? "border-amber-200 bg-white" : "border-indigo-100 bg-indigo-50/18"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="block text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
          {label}
        </label>
        {missing ? (
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-amber-700">
            Missing
          </span>
        ) : (
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-700">
            Captured
          </span>
        )}
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-800 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
      />
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white">
      <div className="border-b-2 border-slate-200 px-4 py-3">
        <label className="block text-[12px] font-medium text-slate-900">
          {label}
        </label>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        className="m-4 w-[calc(100%-2rem)] rounded-xl border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-800 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
      />
    </div>
  );
}

function createMockExtraction(patientName: string): ExtractedFields {
  if (patientName === "Robert Thompson") {
    return {
      presentingNeeds: "Behavioral stabilization, medication reconciliation",
      levelOfCare: "Secure residential",
      mobility: "Standby assist",
      behaviors: "",
      medicationCount: "8 active meds",
      riskNotes: "Recent suicidal ideation reported in ED packet",
      admissionDecision: "",
      communityPreference: "San Pablo",
      guardianContact: "",
      medicalHistory: "Depression, hypertension",
    };
  }

  if (patientName === "Mary Robinson") {
    return {
      presentingNeeds: "Crisis stabilization and placement planning",
      levelOfCare: "High-acuity residential",
      mobility: "Walker assist",
      behaviors: "Recent agitation overnight",
      medicationCount: "",
      riskNotes: "Requires close psychiatric observation",
      admissionDecision: "",
      communityPreference: "San Francisco",
      guardianContact: "Pat Robinson · (555) 101-8800",
      medicalHistory: "",
    };
  }

  return {
    presentingNeeds: "General behavioral health review",
    levelOfCare: "Residential review",
    mobility: "",
    behaviors: "",
    medicationCount: "",
    riskNotes: "",
    admissionDecision: "",
    communityPreference: "",
    guardianContact: "",
    medicalHistory: "",
  };
}

function deriveRecommendation(extracted: ExtractedFields) {
  const missing = getMissingFields(extracted);

  if (missing.length > 0) {
    return `Complete ${missing.length} missing form fields before final routing.`;
  }

  return "Packet complete and ready for clinician review and routing.";
}

function getMissingFields(extracted: ExtractedFields) {
  return requiredPacketFields.filter((field) => extracted[field].trim().length === 0);
}

const fieldLabels: Record<ExtractedFieldKey, string> = {
  presentingNeeds: "Presenting needs",
  levelOfCare: "Recommended level of care",
  mobility: "Mobility",
  behaviors: "Behavior / observation flags",
  medicationCount: "Medication count",
  riskNotes: "Risk notes",
  admissionDecision: "Admission decision",
  communityPreference: "Community preference",
  guardianContact: "Guardian / family contact",
  medicalHistory: "Medical history",
};
