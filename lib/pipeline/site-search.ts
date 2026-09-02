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
    title: "Workspaces",
    detail: "Browse workspaces by client, owner, county, community, or month",
    keywords: "workspace workspaces referral referrals assignment assigned owner county community month workflow",
  },
  {
    id: "site-profiles",
    screen: "profiles",
    title: "Clients",
    detail: "Search current and prior client profiles",
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
    title: "Reports",
    detail: "Review workspace, document, assessment, and team data",
    keywords: "report reports workspace documents assessment calendar completed team workload owner performance export csv queue overdue stale blocked conflict conflicts supervisor",
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
