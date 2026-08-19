import "server-only";

import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getExtractionBackendMode } from "@/lib/extraction/backend-config";

const globalForPacketReferrals = globalThis as typeof globalThis & {
  __pipelineMockPacketReferrals?: Map<string, number>;
};

const mockPacketReferrals = globalForPacketReferrals.__pipelineMockPacketReferrals
  ?? (globalForPacketReferrals.__pipelineMockPacketReferrals = new Map<string, number>());

export function registerMockPacketReferral(packetId: string, referralId: string) {
  const parsed = Number(referralId);
  if (Number.isSafeInteger(parsed) && parsed > 0) mockPacketReferrals.set(packetId, parsed);
}

export function unregisterMockPacketReferral(packetId: string) {
  mockPacketReferrals.delete(packetId);
}

export async function readPacketReferralId(packetId: string) {
  if (getExtractionBackendMode() === "mock") {
    return mockPacketReferrals.get(packetId) ?? null;
  }
  if (!isUuid(packetId)) return null;
  const sql = getPipelineSql();
  const rows = await sql<{ referral_id: number | string }[]>`
    select referral_id from pipeline.packet_uploads
    where packet_id = ${packetId}::uuid
    limit 1
  `;
  return rows[0] ? Number(rows[0].referral_id) : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
