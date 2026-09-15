import { createHash } from "node:crypto";

import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { buildPipelineDemoReferral, getPipelineDemoScenario } from "@/lib/demo/demo-scenarios";
import { isPersonaDemo, personaCookie, personaUser, requirePersonaDemoUser } from "@/lib/demo/persona-session";
import { touchWorkspaceMember } from "@/lib/pipeline/workspace-members";

export const runtime = "nodejs";

const journeyTag = "pipeline-assessor-journey-v1";

const cases = [
  { key: "taylor", name: "Taylor Rivera", community: "San Pablo", assigned: true, packet: true, assessment: "unscheduled" },
  { key: "maya", name: "Maya Torres", community: "Santa Clarita", assigned: true, packet: false, assessment: "none" },
  { key: "noah", name: "Noah Chen", community: "Turlock", assigned: true, packet: true, assessment: "none" },
  { key: "elena", name: "Elena Brooks", community: "San Pablo", assigned: true, packet: true, assessment: "scheduled", daysAhead: 1 },
  { key: "samir", name: "Samir Patel", community: "Santa Clarita", assigned: true, packet: true, assessment: "started", daysAhead: 3 },
  { key: "iris", name: "Iris Morgan", community: "Turlock", assigned: true, packet: true, assessment: "started", daysAhead: 5 },
  { key: "lena", name: "Lena Park", community: "San Pablo", assigned: true, packet: true, assessment: "scheduled", daysAhead: 6 },
  { key: "carmen", name: "Carmen Diaz", community: "Santa Clarita", assigned: false, packet: false, assessment: "none" },
  { key: "micah", name: "Micah Evans", community: "Turlock", assigned: false, packet: true, assessment: "none" },
] as const;

type SeedReferral = {
  id: number;
  version: number;
  sectionVersions: { documents: number };
  tags?: string[];
};

type SeedAssessment = {
  assessment_id: string;
  version: number;
};

export async function POST(request: Request) {
  const auth = requirePersonaDemoUser(request);
  if (!auth.ok) return auth.response;
  const originFailure = requireSameOriginMutation(request);
  if (originFailure) return originFailure;
  if (!isPersonaDemo()) return Response.json({ error: "Not found." }, { status: 404 });

  try {
    await touchWorkspaceMember(personaUser("assessor"));
    const template = getPipelineDemoScenario("new-intake");
    if (!template) throw new Error("The practice case template is unavailable.");
    const origin = process.env.PIPELINE_PERSONA_DEMO_ORIGIN!;
    const client = (path: string, init?: RequestInit) => callDemoApi(origin, path, init);
    const seeded: Record<string, number> = {};

    for (const entry of cases) {
      const listing = await client(`/api/referrals?workspace=all&q=${encodeURIComponent(entry.name)}&limit=20`) as { referrals: SeedReferral[] };
      const existing = listing.referrals.find((referral) => referral.tags?.includes(journeyTag)
        && (referral.tags.includes(entry.key) || referral.tags.includes(`pipeline-assessor-journey-${entry.key}`)));
      if (existing) {
        seeded[entry.key] = existing.id;
        continue;
      }

      const input = {
        ...buildPipelineDemoReferral(template, entry.assigned ? "Jordan Lee" : "Unassigned"),
        name: entry.name,
        community: entry.community,
        county: entry.community === "San Pablo" ? "Contra Costa County" : entry.community === "Santa Clarita" ? "Los Angeles County" : "Stanislaus County",
        owner: entry.assigned ? "Jordan Lee" : "Unassigned",
        tags: [journeyTag, `pipeline-assessor-journey-${entry.key}`],
        note: "Synthetic assessor orientation case. No real client or placement data.",
      };
      const created = await client("/api/referrals", {
        method: "POST",
        body: JSON.stringify({
          referral: input,
          ...(entry.assigned ? { assignee_id: "practice-assessor" } : {}),
          client_mutation_id: mutationId(`${entry.key}:referral`),
        }),
      }) as { referral: SeedReferral };
      let referral = created.referral;
      seeded[entry.key] = referral.id;

      if (entry.packet) {
        const file = await uploadFaceSheet(origin, client, referral, entry.key, entry.name, entry.community);
        const refreshed = await client(`/api/referrals/${referral.id}`) as { referral: SeedReferral };
        referral = refreshed.referral;
        const reviewed = await client(`/api/referrals/${referral.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            if_match: referral.version,
            if_match_sections: { documents: referral.sectionVersions.documents },
            patch: {
              documentName: file.name,
              documentSizeBytes: file.size,
              documentHash: file.sha256,
              packetId: file.packetId,
              packetStatus: "reviewed",
              documentStatus: "Reviewed",
              packetReadiness: { ready: true, blockers: [] },
              packetCompleteness: { required_total: 1, required_ready: 1, missing_items: [] },
            },
          }),
        }) as { referral: SeedReferral };
        referral = reviewed.referral;
      }

      if (entry.assessment === "none") continue;
      const createdAssessment = await client(`/api/referrals/${referral.id}/assessments`, {
        method: "POST",
        body: JSON.stringify({
          client_mutation_id: mutationId(`${entry.key}:assessment`),
          data: {
            current_location: "Synthetic referral source",
            ...(entry.assessment === "started" ? { prior_placements: "Synthetic prior placement; length and discharge reason need verification." } : {}),
          },
        }),
      }) as { assessment: SeedAssessment };
      let assessment = createdAssessment.assessment;

      if (entry.assessment === "unscheduled") continue;
      const scheduled = await client(`/api/assessments/${encodeURIComponent(assessment.assessment_id)}/schedule`, {
        method: "POST",
        body: JSON.stringify({
          if_match: assessment.version,
          client_mutation_id: mutationId(`${entry.key}:schedule`),
          schedule: {
            start_at: appointmentTime(entry.daysAhead),
            duration_minutes: 60,
            method: "zoom",
            location: "Synthetic Zoom room - no live link",
            status: "scheduled",
          },
        }),
      }) as { assessment: SeedAssessment };
      assessment = scheduled.assessment;

      if (entry.assessment === "started") {
        await client(`/api/assessments/${encodeURIComponent(assessment.assessment_id)}/start`, {
          method: "POST",
          body: JSON.stringify({ if_match: assessment.version, client_mutation_id: mutationId(`${entry.key}:start`) }),
        });
      }
    }

    return Response.json({ primary_referral_id: seeded.taylor, seeded_count: Object.keys(seeded).length }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Practice Home could not be prepared." }, { status: 503 });
  }
}

async function callDemoApi(origin: string, path: string, init: RequestInit = {}) {
  const response = await fetch(new URL(path, origin), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: personaCookie("supervisor").split(";")[0],
      Origin: origin,
    },
    cache: "no-store",
  });
  const body = await response.json() as { error?: string };
  if (!response.ok) throw new Error(body.error || `Practice setup failed (${response.status}).`);
  return body;
}

async function uploadFaceSheet(
  origin: string,
  client: (path: string, init?: RequestInit) => Promise<unknown>,
  referral: SeedReferral,
  key: string,
  name: string,
  community: string,
) {
  const bytes = syntheticFaceSheet(name);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = `synthetic-${key}-face-sheet.pdf`;
  const fileId = `file_${mutationId(`${key}:face-sheet`)}`;
  const reservation = await client("/api/uploads/create-url", {
    method: "POST",
    body: JSON.stringify({
      referral_id: String(referral.id),
      submitting_facility: community,
      source_type: "manual",
      files: [{ file_id: fileId, filename, content_type: "application/pdf", size: bytes.length, sha256, category: "face_sheet" }],
    }),
  }) as { packet_id: string; uploads: Array<{ file_id: string; signed_url: string }> };
  const target = reservation.uploads.find((upload) => upload.file_id === fileId);
  if (!target || new URL(target.signed_url).hostname !== "mock-storage.local") {
    throw new Error("Practice setup refused an external document target.");
  }
  const upload = new FormData();
  upload.set("packet_id", reservation.packet_id);
  upload.set("file_id", fileId);
  upload.set("file", new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }), filename);
  const response = await fetch(new URL("/api/uploads/local", origin), {
    method: "POST",
    headers: { Cookie: personaCookie("supervisor").split(";")[0], Origin: origin },
    body: upload,
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json() as { error?: string };
    throw new Error(body.error || "The synthetic face sheet could not be uploaded.");
  }
  await client("/api/uploads/complete", {
    method: "POST",
    body: JSON.stringify({ packet_id: reservation.packet_id, uploaded_file_ids: [fileId] }),
  });
  return { name: filename, size: bytes.length, sha256, packetId: reservation.packet_id };
}

function syntheticFaceSheet(name: string) {
  const content = `BT /F1 12 Tf 50 700 Td (Synthetic face sheet for ${name}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function mutationId(key: string) {
  const bytes = Buffer.from(createHash("sha256").update(`${journeyTag}:${key}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function appointmentTime(daysAhead: number) {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  date.setUTCHours(18, 0, 0, 0);
  return date.toISOString();
}
