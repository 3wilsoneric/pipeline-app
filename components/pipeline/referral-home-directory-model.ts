import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import type { Referral, ReferralFile } from "@/lib/pipeline/referral-types";
import type { ReferralListOptions } from "@/lib/pipeline/referral-store";
import { isRecordedWorkspaceCommunity } from "@/lib/pipeline/workspace-presentation";

export type WorkspaceScope = NonNullable<ReferralListOptions["scope"]>;

export type ReferralFilter = {
  kind: "all" | "files";
  communities?: string[];
  owners?: string[];
  month?: string;
  county?: string;
  priority?: Referral["priority"];
};

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
  return filter.month ?? "";
}

export function referralFilterCommunities(filter: ReferralFilter) {
  return filter.communities ?? [];
}

export function referralScopeLabel(filter: ReferralFilter) {
  const communities = referralFilterCommunities(filter);
  const community = communities.length === 1 ? presentCommunity(communities[0]) : communities.length ? `${communities.length} communities` : "";
  if (filter.month) return [formatMonthKey(filter.month), community].filter(Boolean).join(" · ");
  if (community) return `All months · ${community}`;
  return "Browse by month and community";
}

export function referralFilterCount(filter: ReferralFilter) {
  return (filter.communities?.length ?? 0) + (filter.owners?.length ?? 0)
    + Number(Boolean(filter.month)) + Number(Boolean(filter.county)) + Number(Boolean(filter.priority));
}

export function getEmptyReferralState(filter: ReferralFilter, searchTerm: string) {
  if (searchTerm.trim()) {
    return {
      title: "No workspaces match this search",
      detail: "Try a different client, community, owner, or file name.",
    };
  }

  if (referralFilterCount(filter)) {
    return { title: "No workspaces match these filters", detail: "Change a community, owner, county, or month, or show all workspaces." };
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

export function buildReferralParams(filter: ReferralFilter, searchTerm: string, cursor?: string, scope: WorkspaceScope = "team") {
  const params = new URLSearchParams({ limit: String(workspacePageSize), sort: "updated_desc", scope });
  const query = searchTerm.trim();
  if (query) {
    params.set("q", query);
    params.set("workspace", "all");
  }
  if (cursor) params.set("cursor", cursor);
  for (const community of [...(filter.communities ?? [])].sort()) params.append("community", community);
  for (const owner of [...(filter.owners ?? [])].sort()) params.append("owner", owner);
  if (filter.county) params.set("county", filter.county);
  if (filter.month) params.set("month", filter.month);
  if (filter.priority) params.set("priority", filter.priority);
  if (filter.kind !== "files") params.set("workspace", "all");
  return params;
}

export function directoryLoadingLabel(filter: ReferralFilter) {
  return filter.kind === "files" ? "Loading files" : "Loading workspaces";
}

export function hasReferralPagination(page: number, nextCursor?: string) {
  return page > 0 || Boolean(nextCursor);
}
