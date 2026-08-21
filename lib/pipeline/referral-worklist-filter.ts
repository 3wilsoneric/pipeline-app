import type {
  ReferralWorklistBucket,
  ReferralWorklistItem,
} from "@/lib/pipeline/operations-types";

export const referralWorklistBuckets: Array<{
  value: ReferralWorklistBucket;
  label: string;
  keywords: string;
}> = [
  { value: "all_actionable", label: "All action", keywords: "active open action work" },
  { value: "unassigned", label: "Unassigned", keywords: "owner no owner needs owner pending unknown" },
  { value: "packet_review", label: "Packet review", keywords: "packet pre admission extraction extracted intake review" },
  { value: "assessment_due", label: "Assessment due", keywords: "assessment eval evaluation clinical due" },
  { value: "decision_needed", label: "Decision needed", keywords: "decision admission yes no outcome" },
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

  const queryTokens = tokenize(searchTerm);
  if (queryTokens.length === 0) return true;

  const categoryText = item.categories.map((category) => {
    const definition = referralWorklistBuckets.find((candidate) => candidate.value === category);
    return definition ? `${definition.label} ${definition.keywords}` : category;
  }).join(" ");
  const candidateTokens = tokenize([
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

  return queryTokens.every((queryToken) => candidateTokens.some((candidate) => tokenMatches(queryToken, candidate)));
}

export function referralWorklistCategoryLabel(
  bucket: Exclude<ReferralWorklistBucket, "all_actionable">,
) {
  return referralWorklistBuckets.find((item) => item.value === bucket)?.label ?? bucket;
}

function tokenMatches(query: string, candidate: string) {
  if (candidate.includes(query) || query.includes(candidate)) return true;
  return query.length >= 4 && candidate.length >= 4 && editDistanceAtMostOne(query, candidate);
}

function editDistanceAtMostOne(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left === right) return true;

  let leftIndex = 0;
  let rightIndex = 0;
  let differences = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    differences += 1;
    if (differences > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  return differences + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

function tokenize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}
