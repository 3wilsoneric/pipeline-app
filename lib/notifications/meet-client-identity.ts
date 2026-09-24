import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";
import { isSystemPlaceholderClientName, normalizeClientName, resolveClientCommunity } from "@/lib/pipeline/client-identity-presentation.mjs";

export function meetClientIdentityIssues(summary: Pick<MeetClientSummary, "name" | "community"> | null): string[] {
  if (!summary) return [];
  const issues: string[] = [];
  if (!normalizeClientName(summary.name) || isSystemPlaceholderClientName(summary.name)) {
    issues.push("Record the client's name in the chart before preparing Meet the Client.");
  }
  if (!resolveClientCommunity(summary.community)) {
    issues.push("Select the receiving community in the chart before preparing Meet the Client.");
  }
  return issues;
}
