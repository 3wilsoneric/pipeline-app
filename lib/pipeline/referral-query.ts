import { pipelineCommunities } from "@/lib/pipeline/community-config";
import type { ReferralListOptions, ReferralQueueView } from "@/lib/pipeline/referral-store";
import { isReferralSort } from "@/lib/pipeline/referral-sort";
import { isReferralSortCursor } from "@/lib/pipeline/referral-sort-cursor";
import { boardStages, type ReferralStage } from "@/lib/pipeline/referral-workflow";
import type { Priority } from "@/lib/pipeline/referral-types";

type QueryResult =
  | { ok: true; value: ReferralListOptions }
  | { ok: false; message: string };

const priorities: Priority[] = ["urgent", "high", "standard"];
const queues: ReferralQueueView[] = ["my_work", "unassigned", "packet_review", "assessment", "decision"];
const workspaceStatuses = ["active", "historical", "archived", "all"] as const;

type ReferralQueryValues = {
  query: string;
  cursor?: string;
  stage?: string;
  community?: string;
  county?: string;
  owner?: string;
  priority?: string;
  tag?: string;
  month?: string;
  active?: string;
  workspace: string;
  queue?: string;
  sort: string;
  limit?: number;
};

type QueryValidationRule = {
  invalid: boolean;
  message: string;
};

export function parseReferralListQuery(searchParams: URLSearchParams): QueryResult {
  const values = readReferralQueryValues(searchParams);
  const issue = validateReferralQueryValues(values);
  if (issue) return invalid(issue);

  return {
    ok: true,
    value: {
      query: values.query,
      limit: values.limit,
      cursor: values.cursor,
      stage: values.stage as ReferralStage | undefined,
      community: values.community,
      county: values.county,
      owner: values.owner,
      priority: values.priority as Priority | undefined,
      tag: values.tag,
      month: values.month,
      activeOnly: values.active === "true",
      workspaceStatus: values.workspace as ReferralListOptions["workspaceStatus"],
      queue: values.queue as ReferralQueueView | undefined,
      sort: values.sort as ReferralListOptions["sort"],
    },
  };
}

function readReferralQueryValues(searchParams: URLSearchParams): ReferralQueryValues {
  const rawLimit = trimmedParameter(searchParams, "limit");
  return {
    query: searchParams.get("q")?.trim() ?? "",
    cursor: trimmedParameter(searchParams, "cursor") || undefined,
    stage: trimmedParameter(searchParams, "stage") || undefined,
    community: trimmedParameter(searchParams, "community") || undefined,
    county: trimmedParameter(searchParams, "county") || undefined,
    owner: trimmedParameter(searchParams, "owner") || undefined,
    priority: trimmedParameter(searchParams, "priority") || undefined,
    tag: trimmedParameter(searchParams, "tag") || undefined,
    month: trimmedParameter(searchParams, "month") || undefined,
    active: searchParams.get("active")?.trim(),
    workspace: trimmedParameter(searchParams, "workspace") || "active",
    queue: trimmedParameter(searchParams, "queue") || undefined,
    sort: trimmedParameter(searchParams, "sort") || "updated_desc",
    limit: rawLimit ? Number(rawLimit) : undefined,
  };
}

function validateReferralQueryValues(values: ReferralQueryValues): string | undefined {
  const rules: QueryValidationRule[] = [
    { invalid: values.query.length > 200, message: "q must be 200 characters or fewer." },
    { invalid: !isReferralSort(values.sort), message: "sort is invalid." },
    {
      invalid: Boolean(values.cursor && isReferralSort(values.sort) && !isReferralSortCursor(values.cursor, values.sort)),
      message: "cursor is invalid.",
    },
    {
      invalid: values.limit !== undefined && (!Number.isInteger(values.limit) || values.limit < 1 || values.limit > 200),
      message: "limit must be a whole number between 1 and 200.",
    },
    { invalid: Boolean(values.stage && !boardStages.includes(values.stage as ReferralStage)), message: "stage is invalid." },
    {
      invalid: Boolean(values.community && !pipelineCommunities.includes(values.community as (typeof pipelineCommunities)[number])),
      message: "community is invalid.",
    },
    {
      invalid: Boolean(values.county && (values.county.length > 100 || !/^[a-zA-Z .'-]+$/.test(values.county))),
      message: "county is invalid.",
    },
    { invalid: Boolean(values.owner && values.owner.length > 200), message: "owner is invalid." },
    { invalid: Boolean(values.priority && !priorities.includes(values.priority as Priority)), message: "priority is invalid." },
    {
      invalid: Boolean(values.tag && (values.tag.length > 64 || !/^[a-zA-Z0-9 _.-]+$/.test(values.tag))),
      message: "tag is invalid.",
    },
    { invalid: Boolean(values.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(values.month)), message: "month must use YYYY-MM." },
    {
      invalid: values.active !== undefined && values.active !== "" && values.active !== "true" && values.active !== "false",
      message: "active must be true or false.",
    },
    { invalid: !workspaceStatuses.includes(values.workspace as (typeof workspaceStatuses)[number]), message: "workspace is invalid." },
    { invalid: Boolean(values.queue && !queues.includes(values.queue as ReferralQueueView)), message: "queue is invalid." },
  ];
  return rules.find((rule) => rule.invalid)?.message;
}

function trimmedParameter(searchParams: URLSearchParams, key: string): string {
  return searchParams.get(key)?.trim() ?? "";
}

function invalid(message: string): QueryResult {
  return { ok: false, message };
}
