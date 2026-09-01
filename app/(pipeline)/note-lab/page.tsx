import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import NoteLabWorkspace from "@/components/pipeline/note-lab/NoteLabWorkspace";
import {
  NOTE_LAB_CALIBRATION_TARGET,
  NOTE_LAB_CALIBRATION_VERSION,
} from "@/lib/note-lab/note-lab-contracts";
import { noteLabDocumentationCriteria } from "@/lib/note-lab/assessment-language-standards";
import { getNoteLabUser } from "@/lib/note-lab/note-lab-access";
import { getNoteLabSession } from "@/lib/note-lab/note-lab-store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Assessment Language Lab | Pipeline",
  description: "Private supervisor workspace for field-specific assessment language decisions.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function NoteLabPage() {
  const user = await getNoteLabUser(new Headers(await headers()));
  if (!user) notFound();
  const initialSession = await getNoteLabSession(user.id).catch(() => ({
    enabled: true,
    available: false,
    message: "Assessment Language Lab is temporarily unavailable.",
    calibrationVersion: NOTE_LAB_CALIBRATION_VERSION,
    revision: 0,
    persistence: "unavailable" as const,
    scenario: null,
    calibration: {
      targetDecisions: NOTE_LAB_CALIBRATION_TARGET,
      decisionsCompleted: 0,
      currentStep: 1,
      remaining: NOTE_LAB_CALIBRATION_TARGET,
      progressPercent: 0,
      complete: false,
      estimatedMinutesRemaining: 23,
      fieldSteps: [],
      trail: [],
      profile: {
        schemaVersion: 3 as const,
        calibrationVersion: NOTE_LAB_CALIBRATION_VERSION,
        status: "collecting" as const,
        targetDecisions: NOTE_LAB_CALIBRATION_TARGET,
        decisionsCompleted: 0,
        fieldsReviewed: 0,
        purposeTracksReviewed: 0,
        criteria: [],
        sampleOutcomes: { teach: 0, revise: 0, do_not_teach: 0 },
        revisionReasons: [],
        fieldStandards: [],
        inferredRules: [],
      },
    },
    stats: {
      decisionsCompleted: 0,
      fieldsAvailable: 0,
      criteriaAvailable: noteLabDocumentationCriteria.length,
      corpusSamplesAvailable: 0,
    },
  }));
  return <NoteLabWorkspace initialSession={initialSession} reviewerName={firstName(user.name)} />;
}

function firstName(displayName: string) {
  const naturalOrder = displayName.includes(",")
    ? displayName.split(",").slice(1).join(",").trim()
    : displayName.trim();
  return naturalOrder.split(/\s+/).find(Boolean) ?? "Supervisor";
}
