export type PipelineSiteScreen = "referrals" | "profiles" | "packet" | "operations";

export type PipelineSiteDestination = {
  id: string;
  screen: PipelineSiteScreen;
  title: string;
  detail: string;
};

type SearchableDestination = PipelineSiteDestination & {
  keywords: string;
};

const siteDestinations: SearchableDestination[] = [
  {
    id: "site-referrals",
    screen: "referrals",
    title: "Referral workspaces",
    detail: "Browse and filter active referral work",
    keywords: "referral referrals packet packets intake admissions browse community month worklist",
  },
  {
    id: "site-profiles",
    screen: "profiles",
    title: "Client profiles",
    detail: "Search the current admitted-client roster",
    keywords: "client clients profile profiles resident residents admitted census roster people",
  },
  {
    id: "site-new-packet",
    screen: "packet",
    title: "New referral",
    detail: "Create a workspace and upload its initial documents",
    keywords: "new create add referral packet upload document documents face sheet intake",
  },
  {
    id: "site-operations",
    screen: "operations",
    title: "Operations",
    detail: "Review ownership, queues, blockers, and overdue work",
    keywords: "operations queue queues assigned assignment assignments work blocker blockers overdue supervisor assessor assessors performance",
  },
];

export function searchSiteDestinations(value: string): PipelineSiteDestination[] {
  const queryTokens = tokenize(value);
  if (queryTokens.length === 0) return [];

  return siteDestinations
    .map((destination) => ({
      destination,
      score: scoreDestination(destination, queryTokens),
    }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.destination.title.localeCompare(right.destination.title))
    .map(({ destination }) => ({
      id: destination.id,
      screen: destination.screen,
      title: destination.title,
      detail: destination.detail,
    }));
}

function scoreDestination(destination: SearchableDestination, queryTokens: string[]) {
  const title = normalize(destination.title);
  const words = tokenize(`${destination.title} ${destination.detail} ${destination.keywords}`);
  let score = 0;

  for (const queryToken of queryTokens) {
    const matchingWord = words.find((word) => tokenMatches(queryToken, word));
    if (!matchingWord) return 0;
    if (title === queryToken) score += 8;
    else if (title.startsWith(queryToken)) score += 6;
    else if (matchingWord === queryToken) score += 4;
    else score += 2;
  }

  return score;
}

function tokenMatches(queryToken: string, candidate: string) {
  if (candidate.includes(queryToken) || queryToken.includes(candidate)) return true;
  return queryToken.length >= 4 && candidate.length >= 4 && editDistanceAtMostOne(queryToken, candidate);
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
  return normalize(value).split(" ").filter(Boolean);
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
