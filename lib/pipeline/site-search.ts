import { fuzzyTokenMatches, normalizeSearchText, tokenizeSearchText } from "@/lib/pipeline/fuzzy-search";

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
  const queryTokens = tokenizeSearchText(value);
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
  const title = normalizeSearchText(destination.title);
  const words = tokenizeSearchText(`${destination.title} ${destination.detail} ${destination.keywords}`);
  let score = 0;

  for (const queryToken of queryTokens) {
    const matchingWord = words.find((word) => fuzzyTokenMatches(queryToken, word));
    if (!matchingWord) return 0;
    if (title === queryToken) score += 8;
    else if (title.startsWith(queryToken)) score += 6;
    else if (matchingWord === queryToken) score += 4;
    else score += 2;
  }

  return score;
}
