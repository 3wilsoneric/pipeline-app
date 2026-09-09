import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import type { Referral, ReferralFile } from "@/lib/pipeline/referral-types";
import { isRecordedWorkspaceCommunity } from "@/lib/pipeline/workspace-presentation";

export type WorkspaceSection = "workspaces" | "activity";
export type WorkspaceLayout = "list" | "gallery";

export type ReferralFilter =
  | { kind: "all" }
  | { kind: "files" }
  | { kind: "community"; value: string }
  | { kind: "monthCommunity"; month: string; community: string }
  | { kind: "county"; value: string }
  | { kind: "month"; value: string }
  | { kind: "owner"; value: string }
  | { kind: "priority"; value: Referral["priority"] };

const workspacePageSize = 50;
const directoryCountFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function getMonthKey(value: string) {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function formatDirectoryCount(value: number) {
  return directoryCountFormatter.format(value);
}

export function presentCommunity(value?: string | null) {
  return isRecordedWorkspaceCommunity(value) ? value!.trim() : "";
}

export function fileMetadata(file: ReferralFile) {
  return [
    fileClientName(file),
    presentCommunity(file.community),
    file.owner || "Unassigned",
    formatMonthKey(getMonthKey(file.uploadedAt)),
  ].filter(Boolean).join(" · ");
}

export function fileClientName(file: Pick<ReferralFile, "referralName" | "community">) {
  return formatClientIdentityTitle({ name: file.referralName, community: file.community });
}

export function referralFilterMonth(filter: ReferralFilter) {
  if (filter.kind === "month") return filter.value;
  if (filter.kind === "monthCommunity") return filter.month;
  return "";
}

export function referralFilterCommunity(filter: ReferralFilter) {
  if (filter.kind === "community") return filter.value;
  if (filter.kind === "monthCommunity") return filter.community;
  return "";
}

export function referralFilterWithCommunity(filter: ReferralFilter, community: string): ReferralFilter {
  const month = referralFilterMonth(filter);
  if (!community) return month ? { kind: "month", value: month } : { kind: "all" };
  return month ? { kind: "monthCommunity", month, community } : { kind: "community", value: community };
}

export function referralScopeLabel(filter: ReferralFilter) {
  if (filter.kind === "monthCommunity") {
    return `${formatMonthKey(filter.month)} · ${presentCommunity(filter.community)}`;
  }
  if (filter.kind === "month") return formatMonthKey(filter.value);
  if (filter.kind === "community") return `All months · ${presentCommunity(filter.value)}`;
  return "Browse by month and community";
}

export function referralFilterCount(filter: ReferralFilter) {
  return filter.kind === "monthCommunity"
    ? 2
    : ["all", "files"].includes(filter.kind) ? 0 : 1;
}

export function getEmptyReferralState(filter: ReferralFilter, searchTerm: string) {
  if (searchTerm.trim()) {
    return {
      title: "No workspaces match this search",
      detail: "Try a different client, community, owner, or file name.",
    };
  }

  if (filter.kind === "monthCommunity") {
    return {
      title: `No workspaces for ${presentCommunity(filter.community)} in ${formatMonthKey(filter.month)}`,
      detail: "Choose another community, month, or show all workspaces.",
    };
  }
  if (filter.kind === "community") {
    return { title: `No workspaces for ${presentCommunity(filter.value)}`, detail: "Choose another community or show all workspaces." };
  }
  if (filter.kind === "county") {
    return { title: `No workspaces from ${filter.value}`, detail: "Choose another county or show all workspaces." };
  }
  if (filter.kind === "month") {
    return { title: `No workspaces from ${formatMonthKey(filter.value)}`, detail: "Choose another month or show all workspaces." };
  }
  if (filter.kind === "owner") {
    return { title: `No workspaces assigned to ${filter.value}`, detail: "Choose another owner or show all workspaces." };
  }
  if (filter.kind === "priority") {
    return { title: `No ${filter.value} priority workspaces`, detail: "Choose another priority or show all workspaces." };
  }
  return {
    title: "No workspaces yet",
    detail: "Create a referral workspace from an initial face sheet or referral packet to get started.",
  };
}

export function formatMonthKey(month: string) {
  if (month === "unknown") return "Unknown date";
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function recentMonthKeys(count: number) {
  const start = new Date();
  start.setUTCDate(1);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCMonth(date.getUTCMonth() - index);
    return date.toISOString().slice(0, 7);
  });
}

export function calendarMonthBounds(month: string) {
  const first = new Date(`${month}-01T00:00:00.000Z`);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  return { from: `${month}-01`, to: last.toISOString().slice(0, 10) };
}

export function buildReferralParams(filter: ReferralFilter, searchTerm: string, cursor?: string) {
  const params = new URLSearchParams({ limit: String(workspacePageSize), sort: "updated_desc" });
  const query = searchTerm.trim();
  if (query) {
    params.set("q", query);
    params.set("workspace", "all");
  }
  if (cursor) params.set("cursor", cursor);
  if (filter.kind === "community") params.set("community", filter.value);
  if (filter.kind === "monthCommunity") {
    params.set("month", filter.month);
    params.set("community", filter.community);
  }
  if (filter.kind === "county") params.set("county", filter.value);
  if (filter.kind === "month") params.set("month", filter.value);
  if (filter.kind === "owner") params.set("owner", filter.value);
  if (filter.kind === "priority") params.set("priority", filter.value);
  if (filter.kind !== "files") params.set("workspace", "all");
  return params;
}

export function directoryLoadingLabel(filter: ReferralFilter) {
  return filter.kind === "files" ? "Loading files" : "Loading workspaces";
}

export function hasReferralPagination(page: number, nextCursor?: string) {
  return page > 0 || Boolean(nextCursor);
}
