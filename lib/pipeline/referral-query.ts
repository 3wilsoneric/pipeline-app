import { pipelineCommunities } from "@/lib/pipeline/community-config";
import type { ReferralListOptions, ReferralQueueView } from "@/lib/pipeline/referral-store";
import { boardStages, type ReferralStage } from "@/lib/pipeline/referral-workflow";
import type { Priority } from "@/lib/pipeline/referral-types";
import { isKeysetCursor } from "@/lib/pipeline/keyset-cursor";

type QueryResult =
  | { ok: true; value: ReferralListOptions }
  | { ok: false; message: string };

const priorities: Priority[] = ["urgent", "high", "standard"];
const queues: ReferralQueueView[] = ["my_work", "unassigned", "packet_review", "assessment", "decision"];

export function parseReferralListQuery(searchParams: URLSearchParams): QueryResult {
  const query = searchParams.get("q")?.trim() ?? "";
  const cursor = searchParams.get("cursor")?.trim() || undefined;
  const stage = searchParams.get("stage")?.trim() || undefined;
  const community = searchParams.get("community")?.trim() || undefined;
  const owner = searchParams.get("owner")?.trim() || undefined;
  const priority = searchParams.get("priority")?.trim() || undefined;
  const tag = searchParams.get("tag")?.trim() || undefined;
  const month = searchParams.get("month")?.trim() || undefined;
  const active = searchParams.get("active")?.trim();
  const queue = searchParams.get("queue")?.trim() || undefined;
  const rawLimit = searchParams.get("limit")?.trim();
  const limit = rawLimit ? Number(rawLimit) : undefined;

  if (query.length > 200) return invalid("q must be 200 characters or fewer.");
  if (cursor && !isKeysetCursor(cursor)) return invalid("cursor is invalid.");
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
    return invalid("limit must be a whole number between 1 and 200.");
  }
  if (stage && !boardStages.includes(stage as ReferralStage)) return invalid("stage is invalid.");
  if (community && !pipelineCommunities.includes(community as (typeof pipelineCommunities)[number])) {
    return invalid("community is invalid.");
  }
  if (owner && owner.length > 200) return invalid("owner is invalid.");
  if (priority && !priorities.includes(priority as Priority)) return invalid("priority is invalid.");
  if (tag && (tag.length > 64 || !/^[a-zA-Z0-9 _.-]+$/.test(tag))) return invalid("tag is invalid.");
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return invalid("month must use YYYY-MM.");
  if (active !== undefined && active !== "" && active !== "true" && active !== "false") {
    return invalid("active must be true or false.");
  }
  if (queue && !queues.includes(queue as ReferralQueueView)) return invalid("queue is invalid.");

  return {
    ok: true,
    value: {
      query,
      limit,
      cursor,
      stage: stage as ReferralStage | undefined,
      community,
      owner,
      priority: priority as Priority | undefined,
      tag,
      month,
      activeOnly: active === "true",
      queue: queue as ReferralQueueView | undefined,
    },
  };
}

function invalid(message: string): QueryResult {
  return { ok: false, message };
}
