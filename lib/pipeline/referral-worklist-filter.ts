import type {
  ReferralWorklistBucket,
  ReferralWorklistItem,
} from "@/lib/pipeline/operations-types";
import { fuzzyTokenMatches, tokenizeSearchText } from "@/lib/pipeline/fuzzy-search";

export const referralWorklistBuckets: Array<{
  value: ReferralWorklistBucket;
  label: string;
  keywords: string;
}> = [
  { value: "all_actionable", label: "All action", keywords: "active open action work" },
  { value: "unassigned", label: "Unassigned", keywords: "owner no owner needs owner pending unknown" },
  { value: "packet_review", label: "Packet review", keywords: "packet pre admission extraction extracted intake review" },
  { value: "assessment_due", label: "Assessment due", keywords: "assessment eval evaluation clinical due" },
  { value: "missing_documents", label: "Missing documents", keywords: "missing document documents docs paperwork upload" },
  { value: "follow_up", label: "Follow-up", keywords: "accepted admitted post admission tb agreement forms move in" },
  { value: "blocked", label: "Blocked", keywords: "blocked blocker stuck overdue expired conflict failed" },
];

export function filterReferralWorklistItems(
  items: ReferralWorklistItem[],
  bucket: ReferralWorklistBucket,
  searchTerm: string,
) {
  return items.filter((item) => matchesReferralWorklistItem(item, bucket, searchTerm));
}

export function matchesReferralWorklistItem(
  item: ReferralWorklistItem,
  bucket: ReferralWorklistBucket,
  searchTerm: string,
) {
  if (bucket !== "all_actionable" && !item.categories.includes(bucket)) return false;

  const queryTokens = tokenizeSearchText(searchTerm);
  if (queryTokens.length === 0) return true;

  const categoryText = item.categories.map((category) => {
    const definition = referralWorklistBuckets.find((candidate) => candidate.value === category);
    return definition ? `${definition.label} ${definition.keywords}` : category;
  }).join(" ");
  const candidateTokens = tokenizeSearchText([
    item.client_name,
    item.community,
    item.owner,
    item.stage,
    item.next_action,
    item.blockers.join(" "),
    item.missing_data.join(" "),
    item.priority,
    item.urgency,
    categoryText,
  ].join(" "));

  return queryTokens.every((queryToken) => candidateTokens.some((candidate) => fuzzyTokenMatches(queryToken, candidate)));
}

export function referralWorklistCategoryLabel(
  bucket: Exclude<ReferralWorklistBucket, "all_actionable">,
) {
  return referralWorklistBuckets.find((item) => item.value === bucket)?.label ?? bucket;
}
