import "server-only";

import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";

export type DeliveryAudit = {
  mutationId: string;
  deliveryId: string;
  referralId: number;
  assessmentId: string;
  assessmentVersion: number;
  decisionId: string;
  reviewId?: string;
  reviewVersion?: number;
  status: "reserved" | "sent" | "failed" | "unconfirmed" | "sent_needs_review";
  actorId: string;
  actorName: string;
  recipientCount: number;
  recipientDomains: string[];
  attachmentCount: number;
  attachmentBytes: number;
  provider: string;
  errorCode?: string;
  retryable?: boolean;
  createdAt: string;
  updatedAt: string;
};

const auditPath = process.env.PIPELINE_MEET_CLIENT_DELIVERY_AUDIT_PATH || ".data/meet-client-delivery-audit.json";
let localQueue = Promise.resolve();
const reservationId = (input: DeliveryAudit) => createHash("sha256").update(`${input.referralId}:${input.assessmentId}:${input.assessmentVersion}`).digest("hex");

export async function reserveMeetClientDelivery(input: DeliveryAudit) {
  if (getPipelineDatabaseReadiness().ready) {
    const sql = getPipelineSql();
    return sql.begin(async (tx) => {
      const active = await tx`insert into pipeline.idempotency_keys (scope, mutation_id, entity_type, entity_id)
        values ('meet_client_workspace_delivery', ${String(input.referralId)}, 'delivery', ${input.deliveryId})
        on conflict (scope, mutation_id) do nothing returning mutation_id`;
      if (!active.length) return false;
      const rows = await tx<{ mutation_id: string }[]>`
        insert into pipeline.idempotency_keys (scope, mutation_id, entity_type, entity_id)
        values ('meet_client_assessment_delivery', ${reservationId(input)}, 'referral', ${String(input.referralId)})
        on conflict (scope, mutation_id) do nothing
        returning mutation_id
      `;
      if (!rows.length) {
        await tx`delete from pipeline.idempotency_keys where scope = 'meet_client_workspace_delivery'
          and mutation_id = ${String(input.referralId)} and entity_id = ${input.deliveryId}`;
        return false;
      }
      await tx`insert into pipeline.audit_events (entity_type, entity_id, action, actor_id, actor_name, changed_fields, metadata)
        values ('referral', ${String(input.referralId)}, 'meet_client_summary_started', ${input.actorId}, ${input.actorName}, ${[] as string[]},
        ${tx.json({ delivery_id: input.deliveryId, mutation_id: input.mutationId, assessment_id: input.assessmentId, assessment_version: input.assessmentVersion, recipient_count: input.recipientCount, attachment_count: input.attachmentCount })})`;
      return true;
    });
  }
  return queueLocal(async () => {
    const records = await readLocal();
    if (records.some((record) => record.referralId === input.referralId && record.status !== "sent" && !deliveryMayBeRetried(record))) return false;
    const previous = records.findLast((record) => reservationId(record) === reservationId(input));
    if (previous && !deliveryMayBeRetried(previous)) return false;
    await writeLocal([...records, input]);
    return true;
  });
}

export async function completeMeetClientDelivery(
  input: DeliveryAudit,
  status: "sent" | "failed" | "unconfirmed" | "sent_needs_review",
  errorCode = "",
  retryable = false,
) {
  const completed = { ...input, status, errorCode: errorCode || undefined, retryable: status === "failed" && retryable, updatedAt: new Date().toISOString() };
  if (getPipelineDatabaseReadiness().ready) {
    const sql = getPipelineSql();
    await sql.begin(async (tx) => {
      // Also repairs an accepted send whose finalization commit failed. This is
      // independent of the provider call and never sends the packet a second time.
      if (status === "sent") {
        const finalized = await tx`
          update pipeline.assessments
          set meet_client_sent_at = ${completed.updatedAt}::timestamptz,
              meet_client_sent_version = ${input.assessmentVersion},
              version = version + 1, updated_at = now()
          where assessment_id = ${input.assessmentId} and meet_client_sent_at is null
          returning assessment_id
        `;
        if (finalized.length) await tx`
          update pipeline.store_revisions set revision = revision + 1, updated_at = now()
          where store_name = 'assessments'
        `;
      }
      await tx`
        insert into pipeline.audit_events (
          entity_type, entity_id, action, actor_id, actor_name, changed_fields, metadata
        ) values (
          'referral', ${String(input.referralId)},
          ${deliveryEvent(status)},
          ${input.actorId}, ${input.actorName}, ${[] as string[]},
          ${tx.json({
            mutation_id: input.mutationId,
            delivery_id: input.deliveryId,
            assessment_id: input.assessmentId,
            assessment_version: input.assessmentVersion,
            decision_id: input.decisionId,
            review_id: input.reviewId,
            review_version: input.reviewVersion,
            recipient_count: input.recipientCount,
            recipient_domains: input.recipientDomains,
            attachment_count: input.attachmentCount,
            attachment_bytes: input.attachmentBytes,
            provider: input.provider,
            ...(errorCode ? { error_code: errorCode } : {}),
          })}
        )
      `;
      // Only the owning attempt may release reservations. Replayed removal of
      // an older draft must not unlock a replacement that is being prepared.
      const [active] = await tx`select entity_id from pipeline.idempotency_keys
        where scope = 'meet_client_workspace_delivery' and mutation_id = ${String(input.referralId)} for update`;
      if (active?.entity_id === input.deliveryId && deliveryMayBeRetried(completed)) await tx`delete from pipeline.idempotency_keys
        where scope = 'meet_client_assessment_delivery' and mutation_id = ${reservationId(input)}`;
      if (status === "sent" || deliveryMayBeRetried(completed)) await tx`delete from pipeline.idempotency_keys
        where scope = 'meet_client_workspace_delivery' and mutation_id = ${String(input.referralId)} and entity_id = ${input.deliveryId}`;
    });
    return;
  }
  await queueLocal(async () => {
    const records = await readLocal();
    const next = records.map((record) => record.deliveryId === input.deliveryId ? completed : record);
    await writeLocal(next);
  });
}

function deliveryMayBeRetried(record: DeliveryAudit) {
  return (record.status === "failed" && record.retryable) || record.status === "sent_needs_review";
}
function deliveryEvent(status: Exclude<DeliveryAudit["status"], "reserved">) {
  return { sent: "meet_client_summary_sent", unconfirmed: "meet_client_summary_unconfirmed",
    failed: "meet_client_summary_failed", sent_needs_review: "meet_client_outlook_sent_reviewed" }[status];
}

function queueLocal<T>(operation: () => Promise<T>) {
  const next = localQueue.then(operation, operation);
  localQueue = next.then(() => undefined, () => undefined);
  return next;
}

async function readLocal(): Promise<DeliveryAudit[]> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ auditPath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("Delivery reservations could not be read.");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    // Corrupt/unreadable reservations must not silently allow duplicate sends.
    throw error;
  }
}

async function writeLocal(records: DeliveryAudit[]) {
  const destination = path.resolve(/* turbopackIgnore: true */ auditPath);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
  await chmod(destination, 0o600);
}
