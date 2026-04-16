"use client";

import React, { useId, useState } from "react";
import {
  Activity,
  CheckCircle2,
  FileStack,
  UploadCloud,
  X,
} from "lucide-react";

type ReferralFormData = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  age: string;
  gender: string;
  phone: string;
  email: string;
  address: string;
  emergencyContact: string;
  emergencyPhone: string;
  diagnosis: string;
  symptoms: string;
  riskLevel: string;
  suicidalIdeation: boolean;
  homicidalIdeation: boolean;
  substanceUse: boolean;
  substanceDetails: string;
  currentMedications: string;
  allergies: string;
  medicalConditions: string;
  source: string;
  referringProvider: string;
  referringFacility: string;
  referringPhone: string;
  priority: string;
  legalStatus: string;
  medicalClearance: string;
  packetStatus: string;
  packetSummary: string;
  releaseOnFile: boolean;
  medListReceived: boolean;
  clinicalNotesReceived: boolean;
  preferredAdmissionDate: string;
  notes: string;
  specialNeeds: string;
};

type ReferralExtraction = {
  [K in keyof ReferralFormData]?: ReferralFormData[K];
};

type StringFieldKey = {
  [K in keyof ReferralFormData]: ReferralFormData[K] extends string ? K : never;
}[keyof ReferralFormData];

interface NewReferralModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (referralData: ReferralFormData) => void;
}

const initialFormData: ReferralFormData = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  age: "",
  gender: "",
  phone: "",
  email: "",
  address: "",
  emergencyContact: "",
  emergencyPhone: "",
  diagnosis: "",
  symptoms: "",
  riskLevel: "",
  suicidalIdeation: false,
  homicidalIdeation: false,
  substanceUse: false,
  substanceDetails: "",
  currentMedications: "",
  allergies: "",
  medicalConditions: "",
  source: "",
  referringProvider: "",
  referringFacility: "",
  referringPhone: "",
  priority: "medium",
  legalStatus: "voluntary",
  medicalClearance: "pending",
  packetStatus: "partial",
  packetSummary: "",
  releaseOnFile: false,
  medListReceived: false,
  clinicalNotesReceived: false,
  preferredAdmissionDate: "",
  notes: "",
  specialNeeds: "",
};

const steps = [
  { number: 1, title: "Packet", icon: FileStack },
  { number: 2, title: "Intake Form", icon: Activity },
  { number: 3, title: "Review", icon: CheckCircle2 },
];

export default function NewReferralModal({
  isOpen,
  onClose,
  onSubmit,
}: NewReferralModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<ReferralFormData>(initialFormData);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedPacketName, setUploadedPacketName] = useState("");
  const fileInputId = useId();

  if (!isOpen) return null;

  const handleChange = <K extends keyof ReferralFormData>(
    field: K,
    value: ReferralFormData[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleClose = () => {
    setCurrentStep(1);
    setFormData(initialFormData);
    setUploadedPacketName("");
    onClose();
  };

  const handleSubmit = () => {
    onSubmit(formData);
    setCurrentStep(1);
    setFormData(initialFormData);
    setUploadedPacketName("");
    onClose();
  };

  const applyPacketExtraction = (fileName: string) => {
    setUploadedPacketName(fileName);

    const extracted = createMockReferralExtraction(fileName);

    setFormData((prev) => ({
      ...prev,
      ...extracted,
      packetStatus: "partial",
    }));
  };

  const handleDroppedFiles = (files: FileList | null) => {
    if (!files?.length) return;
    applyPacketExtraction(files[0].name);
  };

  const missingPacketFields = getMissingPacketFields(formData);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
        <div
          className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"
          onClick={(event) => event.stopPropagation()}
        >
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

        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
              New intake
            </div>
            <h2 className="mt-1 text-xl font-medium tracking-[-0.04em] text-slate-900">
              Start intake
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="grid gap-3 md:grid-cols-3">
            {steps.map((step) => {
              const Icon = step.icon;
              const isActive = currentStep === step.number;
              const isComplete = currentStep > step.number;

              return (
                <div
                  key={step.number}
                  className={`rounded-xl border px-3 py-3 ${
                    isActive
                      ? "border-slate-300 bg-white"
                      : isComplete
                        ? "border-slate-200 bg-white"
                        : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        isActive
                          ? "bg-slate-200 text-slate-900"
                          : isComplete
                            ? "bg-slate-900 text-white"
                            : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      <Icon size={15} />
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        Step {step.number}
                      </div>
                      <div className="text-sm font-medium text-slate-900">
                        {step.title}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5">
          {currentStep === 1 && (
            <div className="space-y-5">
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
                className={`block rounded-2xl border border-dashed p-4 transition-colors ${
                  isDragging
                    ? "border-slate-300 bg-slate-100"
                    : "border-slate-300 bg-slate-50"
                } cursor-pointer`}
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500">
                    <UploadCloud size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-slate-900">
                      Drop packet to start the intake
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      The packet should populate the full intake form first. After that, you only complete the fields it missed.
                    </div>
                    <div className="mt-2 text-[11px] text-slate-600">
                      {uploadedPacketName
                        ? `Current packet: ${uploadedPacketName}`
                        : "No packet uploaded yet."}
                    </div>
                  </div>
                </div>
              </label>

              <div className="rounded-2xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                      Packet intake
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      Review what was captured now. The next step is the full populated intake form.
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      Missing
                    </div>
                    <div className="mt-1 text-[12px] font-medium text-slate-900">
                      {missingPacketFields.length}
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2">
                  {packetFieldDefinitions.map((field) => (
                    <PacketFieldCard
                      key={field.field}
                      label={field.label}
                      value={formData[field.field]}
                      missing={!String(formData[field.field]).trim()}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  What happens next
                </div>
                <div className="mt-2 text-[12px] leading-6 text-slate-600">
                  Continue to the intake form to verify what was extracted and manually fill the remaining gaps in one place.
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-4">
              <FormSection
                title="Person"
                description="Verify demographics and complete missing identity details."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="First name"
                    value={formData.firstName}
                    onChange={(value) => handleChange("firstName", value)}
                    placeholder="Jordan"
                    missing={!formData.firstName.trim()}
                  />
                  <Field
                    label="Last name"
                    value={formData.lastName}
                    onChange={(value) => handleChange("lastName", value)}
                    placeholder="Taylor"
                    missing={!formData.lastName.trim()}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <Field
                    label="Date of birth"
                    type="date"
                    value={formData.dateOfBirth}
                    onChange={(value) => handleChange("dateOfBirth", value)}
                    missing={!formData.dateOfBirth.trim()}
                  />
                  <Field
                    label="Age"
                    type="number"
                    value={formData.age}
                    onChange={(value) => handleChange("age", value)}
                    placeholder="42"
                  />
                  <SelectField
                    label="Gender"
                    value={formData.gender}
                    onChange={(value) => handleChange("gender", value)}
                    options={["Male", "Female", "Non-binary", "Unknown"]}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="Phone"
                    value={formData.phone}
                    onChange={(value) => handleChange("phone", value)}
                    placeholder="(555) 010-1244"
                  />
                  <Field
                    label="Email"
                    type="email"
                    value={formData.email}
                    onChange={(value) => handleChange("email", value)}
                    placeholder="jordan@example.org"
                  />
                </div>

                <Field
                  label="Current address"
                  value={formData.address}
                  onChange={(value) => handleChange("address", value)}
                  placeholder="123 Main Street, Boise, ID"
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="Emergency contact"
                    value={formData.emergencyContact}
                    onChange={(value) => handleChange("emergencyContact", value)}
                    placeholder="Pat Taylor"
                  />
                  <Field
                    label="Emergency phone"
                    value={formData.emergencyPhone}
                    onChange={(value) => handleChange("emergencyPhone", value)}
                    placeholder="(555) 010-4411"
                  />
                </div>
              </FormSection>

              <FormSection
                title="Clinical"
                description="Confirm the extracted packet details and add the rest of the clinical picture."
              >
                <Field
                  label="Primary diagnosis"
                  value={formData.diagnosis}
                  onChange={(value) => handleChange("diagnosis", value)}
                  placeholder="Major depressive disorder, SI"
                  missing={!formData.diagnosis.trim()}
                />

                <TextAreaField
                  label="Presenting symptoms"
                  value={formData.symptoms}
                  onChange={(value) => handleChange("symptoms", value)}
                  placeholder="Brief clinical picture, behaviors, recent events, and current concerns."
                />

                <div className="grid gap-4 md:grid-cols-3">
                  <SelectField
                    label="Risk level"
                    value={formData.riskLevel}
                    onChange={(value) => handleChange("riskLevel", value)}
                    options={["Low", "Moderate", "High", "Critical"]}
                  />
                  <SelectField
                    label="Legal status"
                    value={formData.legalStatus}
                    onChange={(value) => handleChange("legalStatus", value)}
                    options={["voluntary", "hold", "conservatorship"]}
                  />
                  <SelectField
                    label="Medical clearance"
                    value={formData.medicalClearance}
                    onChange={(value) => handleChange("medicalClearance", value)}
                    options={["pending", "requested", "complete"]}
                    missing={!formData.medicalClearance.trim()}
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <ToggleCard
                    label="Suicidal ideation"
                    checked={formData.suicidalIdeation}
                    onChange={(checked) => handleChange("suicidalIdeation", checked)}
                  />
                  <ToggleCard
                    label="Homicidal ideation"
                    checked={formData.homicidalIdeation}
                    onChange={(checked) => handleChange("homicidalIdeation", checked)}
                  />
                  <ToggleCard
                    label="Substance use concerns"
                    checked={formData.substanceUse}
                    onChange={(checked) => handleChange("substanceUse", checked)}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <TextAreaField
                    label="Current medications"
                    value={formData.currentMedications}
                    onChange={(value) => handleChange("currentMedications", value)}
                    placeholder="Current psychiatric and medical meds."
                    missing={!formData.currentMedications.trim()}
                  />
                  <TextAreaField
                    label="Allergies / medical conditions"
                    value={formData.allergies}
                    onChange={(value) => handleChange("allergies", value)}
                    placeholder="Known allergies, chronic conditions, notable restrictions."
                  />
                </div>
              </FormSection>

              <FormSection
                title="Referral Source"
                description="Capture where the referral came from and what timing or placement details matter."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <SelectField
                    label="Referral source"
                    value={formData.source}
                    onChange={(value) => handleChange("source", value)}
                    options={["Hospital discharge", "Family direct", "Physician referral", "Community partner", "Self referral"]}
                    missing={!formData.source.trim()}
                  />
                  <SelectField
                    label="Priority"
                    value={formData.priority}
                    onChange={(value) => handleChange("priority", value)}
                    options={["low", "medium", "high"]}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="Referring provider"
                    value={formData.referringProvider}
                    onChange={(value) => handleChange("referringProvider", value)}
                    placeholder="Dr. Michael Lee"
                    missing={!formData.referringProvider.trim()}
                  />
                  <Field
                    label="Referring facility"
                    value={formData.referringFacility}
                    onChange={(value) => handleChange("referringFacility", value)}
                    placeholder="St. Mary's ED"
                    missing={!formData.referringFacility.trim()}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="Referring phone"
                    value={formData.referringPhone}
                    onChange={(value) => handleChange("referringPhone", value)}
                    placeholder="(555) 220-8822"
                  />
                  <Field
                    label="Preferred admit date"
                    type="date"
                    value={formData.preferredAdmissionDate}
                    onChange={(value) => handleChange("preferredAdmissionDate", value)}
                  />
                </div>

                <TextAreaField
                  label="Special needs / placement notes"
                  value={formData.specialNeeds}
                  onChange={(value) => handleChange("specialNeeds", value)}
                  placeholder="Behavioral support, mobility needs, staffing considerations, rooming notes."
                />
              </FormSection>

              <FormSection
                title="Packet Details"
                description="Complete the packet checklist and leave final intake notes."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <SelectField
                    label="Packet status"
                    value={formData.packetStatus}
                    onChange={(value) => handleChange("packetStatus", value)}
                    options={["missing", "partial", "ready for review"]}
                  />
                  <Field
                    label="Packet summary"
                    value={formData.packetSummary}
                    onChange={(value) => handleChange("packetSummary", value)}
                    placeholder="Psych eval, med list, recent vitals, discharge summary"
                    missing={!formData.packetSummary.trim()}
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <ToggleCard
                    label="Release on file"
                    checked={formData.releaseOnFile}
                    onChange={(checked) => handleChange("releaseOnFile", checked)}
                  />
                  <ToggleCard
                    label="Medication list received"
                    checked={formData.medListReceived}
                    onChange={(checked) => handleChange("medListReceived", checked)}
                  />
                  <ToggleCard
                    label="Clinical notes received"
                    checked={formData.clinicalNotesReceived}
                    onChange={(checked) => handleChange("clinicalNotesReceived", checked)}
                  />
                </div>

                <TextAreaField
                  label="Additional intake notes"
                  value={formData.notes}
                  onChange={(value) => handleChange("notes", value)}
                  placeholder="Anything the admitting team should review before clinician handoff."
                />
              </FormSection>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-4">
              <ReviewCard
                title="Person"
                rows={[
                  ["Name", `${formData.firstName} ${formData.lastName}`.trim() || "Not entered"],
                  ["DOB", formData.dateOfBirth || "Not entered"],
                  ["Contact", formData.phone || "Not entered"],
                  ["Emergency contact", formData.emergencyContact || "Not entered"],
                ]}
              />
              <ReviewCard
                title="Clinical"
                rows={[
                  ["Diagnosis", formData.diagnosis || "Not entered"],
                  ["Risk level", formData.riskLevel || "Not entered"],
                  ["Legal status", formData.legalStatus || "Not entered"],
                  ["Medical clearance", formData.medicalClearance || "Not entered"],
                ]}
              />
              <ReviewCard
                title="Source"
                rows={[
                  ["Referral source", formData.source || "Not entered"],
                  ["Provider", formData.referringProvider || "Not entered"],
                  ["Facility", formData.referringFacility || "Not entered"],
                  ["Priority", formData.priority || "Not entered"],
                ]}
              />
              <ReviewCard
                title="Documents"
                rows={[
                  ["Packet status", formData.packetStatus || "Not entered"],
                  ["Packet summary", formData.packetSummary || "Not entered"],
                  ["Release on file", formData.releaseOnFile ? "Yes" : "No"],
                  ["Clinical notes", formData.clinicalNotesReceived ? "Received" : "Missing"],
                ]}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
          <div className="text-xs text-slate-500">
            Step {currentStep} of {steps.length}
          </div>
          <div className="flex items-center gap-2">
            {currentStep > 1 && (
              <button
                onClick={() => setCurrentStep((step) => step - 1)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
              >
                Back
              </button>
            )}
            {currentStep < steps.length ? (
              <button
                onClick={() => setCurrentStep((step) => step + 1)}
                className="app-gradient-button rounded-lg px-4 py-2 text-sm font-medium transition-all"
              >
                {currentStep === 1 ? "Continue to form" : "Continue"}
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                className="app-gradient-button rounded-lg px-4 py-2 text-sm font-medium transition-all"
              >
                Submit intake
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const packetFieldDefinitions: Array<{
  field: StringFieldKey;
  label: string;
}> = [
  { field: "firstName", label: "First name" },
  { field: "lastName", label: "Last name" },
  { field: "dateOfBirth", label: "Date of birth" },
  { field: "diagnosis", label: "Diagnosis" },
  { field: "currentMedications", label: "Current medications" },
  { field: "source", label: "Referral source" },
  { field: "referringProvider", label: "Referring provider" },
  { field: "referringFacility", label: "Referring facility" },
  { field: "packetSummary", label: "Packet summary" },
  { field: "medicalClearance", label: "Medical clearance" },
];

function PacketFieldCard({
  label,
  value,
  missing,
}: {
  label: string;
  value: string;
  missing: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-3 ${
        missing ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
          {label}
        </div>
        <div
          className={`text-[10px] font-medium uppercase tracking-[0.12em] ${
            missing ? "text-amber-700" : "text-slate-700"
          }`}
        >
          {missing ? "Missing" : "Captured"}
        </div>
      </div>
      <div className="mt-2 text-[12px] text-slate-700">
        {String(value).trim() || "Not extracted"}
      </div>
    </div>
  );
}

function createMockReferralExtraction(fileName: string): ReferralExtraction {
  const lowerName = fileName.toLowerCase();

  if (lowerName.includes("robert") || lowerName.includes("thompson")) {
    return {
      firstName: "Robert",
      lastName: "Thompson",
      dateOfBirth: "1993-02-14",
      age: "32",
      gender: "Male",
      phone: "(555) 010-1244",
      emergencyContact: "Linda Thompson",
      emergencyPhone: "(555) 010-7721",
      diagnosis: "Depression with suicidal ideation",
      symptoms: "Recent ED presentation, SI, depressed mood, withdrawal.",
      riskLevel: "High",
      currentMedications: "Sertraline, trazodone, lisinopril",
      allergies: "NKDA",
      source: "Hospital discharge",
      referringProvider: "Dr. Michael Lee",
      referringFacility: "County General ED",
      referringPhone: "(555) 220-8822",
      priority: "high",
      medicalClearance: "pending",
      packetSummary: "ED note and medication list extracted; psych consult still missing",
      releaseOnFile: true,
      medListReceived: true,
      clinicalNotesReceived: true,
      notes: "Packet auto-populated from uploaded intake packet.",
    };
  }

  if (lowerName.includes("mary") || lowerName.includes("robinson")) {
    return {
      firstName: "Mary",
      lastName: "Robinson",
      dateOfBirth: "1958-10-21",
      age: "67",
      gender: "Female",
      diagnosis: "Major depression",
      symptoms: "Crisis presentation, worsening mood symptoms, acute agitation overnight.",
      riskLevel: "High",
      currentMedications: "Venlafaxine, quetiapine",
      source: "Physician referral",
      referringProvider: "Dr. Sarah Patel",
      referringFacility: "St. Mary's Hospital",
      referringPhone: "(555) 331-0081",
      priority: "high",
      medicalClearance: "requested",
      packetSummary: "Hospital packet uploaded; several administrative items still missing",
      releaseOnFile: false,
      medListReceived: true,
      clinicalNotesReceived: true,
      notes: "Packet auto-populated from uploaded hospital packet.",
    };
  }

  return {
    packetSummary: "Packet uploaded and partially extracted.",
    notes: "Packet auto-populated from uploaded intake packet.",
    packetStatus: "partial",
  };
}

function getMissingPacketFields(formData: ReferralFormData) {
  return packetFieldDefinitions.filter(({ field }) => !String(formData[field]).trim());
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
          {title}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">{description}</div>
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  missing = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  missing?: boolean;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-700">
        {label}
        {missing ? <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-amber-700">Missing</span> : null}
      </label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border px-3 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-slate-300 focus:ring-2 focus:ring-slate-200 ${
          missing ? "border-amber-300 bg-amber-50/40" : "border-slate-300"
        }`}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  missing = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  missing?: boolean;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-700">
        {label}
        {missing ? <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-amber-700">Missing</span> : null}
      </label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-lg border px-3 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-slate-300 focus:ring-2 focus:ring-slate-200 ${
          missing ? "border-amber-300 bg-amber-50/40" : "border-slate-300"
        }`}
      >
        <option value="">Select</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  missing = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  missing?: boolean;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-700">
        {label}
        {missing ? <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-amber-700">Missing</span> : null}
      </label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        className={`w-full rounded-lg border px-3 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-slate-300 focus:ring-2 focus:ring-slate-200 ${
          missing ? "border-amber-300 bg-amber-50/40" : "border-slate-300"
        }`}
      />
    </div>
  );
}

function ToggleCard({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-300"
      />
    </label>
  );
}

function ReviewCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 text-sm font-medium text-slate-900">{title}</div>
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[140px_1fr] gap-3 text-sm">
            <div className="text-slate-500">{label}</div>
            <div className="text-slate-800">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
