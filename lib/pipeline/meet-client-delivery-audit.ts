import "server-only";

import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";

type DeliveryAudit = {
  mutationId: string;
  deliveryId: string;
  referralId: number;
  assessmentId: string;
  decisionId: string;
  status: "reserved" | "sent" | "failed";
  actorId: string;
  actorName: string;
  recipientCount: number;
  recipientDomains: string[];
  attachmentCount: number;
  attachmentBytes: number;
  provider: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
};

const auditPath = ".data/meet-client-delivery-audit.json";
let localQueue = Promise.resolve();

export async function reserveMeetClientDelivery(input: DeliveryAudit) {
  if (getPipelineDatabaseReadiness().ready) {
    const sql = getPipelineSql();
    const rows = await sql<{ mutation_id: string }[]>`
      insert into pipeline.idempotency_keys (scope, mutation_id, entity_type, entity_id)
      values ('meet_client_summary_email', ${input.mutationId}, 'referral', ${String(input.referralId)})
      on conflict (scope, mutation_id) do nothing
      returning mutation_id
    `;
    return rows.length === 1;
  }
  return queueLocal(async () => {
    const records = await readLocal();
    if (records.some((record) => record.mutationId === input.mutationId)) return false;
    await writeLocal([...records, input]);
    return true;
  });
}

export async function completeMeetClientDelivery(
  input: DeliveryAudit,
  status: "sent" | "failed",
  errorCode = "",
) {
  const completed = { ...input, status, errorCode: errorCode || undefined, updatedAt: new Date().toISOString() };
  if (getPipelineDatabaseReadiness().ready) {
    const sql = getPipelineSql();
    await sql`
      insert into pipeline.audit_events (
        entity_type, entity_id, action, actor_id, actor_name, changed_fields, metadata
      ) values (
        'referral', ${String(input.referralId)},
        ${status === "sent" ? "meet_client_summary_sent" : "meet_client_summary_failed"},
        ${input.actorId}, ${input.actorName}, ${[] as string[]},
        ${sql.json({
          mutation_id: input.mutationId,
          delivery_id: input.deliveryId,
          assessment_id: input.assessmentId,
          decision_id: input.decisionId,
          recipient_count: input.recipientCount,
          recipient_domains: input.recipientDomains,
          attachment_count: input.attachmentCount,
          attachment_bytes: input.attachmentBytes,
          provider: input.provider,
          ...(errorCode ? { error_code: errorCode } : {}),
        })}
      )
    `;
    return;
  }
  await queueLocal(async () => {
    const records = await readLocal();
    const next = records.map((record) => record.mutationId === input.mutationId ? completed : record);
    await writeLocal(next);
  });
}

function queueLocal<T>(operation: () => Promise<T>) {
  const next = localQueue.then(operation, operation);
  localQueue = next.then(() => undefined, () => undefined);
  return next;
}

async function readLocal(): Promise<DeliveryAudit[]> {
  try {
    const parsed = JSON.parse(await readFile(auditPath, "utf8"));
    return Array.isArray(parsed) ? parsed.slice(-5_000) : [];
  } catch {
    return [];
  }
}

async function writeLocal(records: DeliveryAudit[]) {
  const destination = path.resolve(auditPath);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(records.slice(-5_000), null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
  await chmod(destination, 0o600);
}
