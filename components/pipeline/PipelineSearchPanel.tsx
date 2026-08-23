"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";

import type { ClinicalClientDirectoryItem } from "@/lib/clinical/clinical-contracts";
import type { Referral, ReferralFile } from "@/lib/pipeline/referral-types";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { PipelineSiteDestination, PipelineSiteScreen } from "@/lib/pipeline/site-search";
import { searchSiteDestinations } from "@/lib/pipeline/site-search";

type SuggestedSearchMode = "active" | "unassigned" | "packet_review" | "assessment" | "decision" | "files";

type PipelineSuggestedSearch = {
  id: string;
  category: string;
  prompt: string;
  mode: SuggestedSearchMode;
};

type SearchResult = {
  query: string;
  interpreted_query: string;
  referrals: Referral[];
  files: ReferralFile[];
  clients: ClinicalClientDirectoryItem[];
  destinations?: PipelineSiteDestination[];
  clinical_warning?: string | null;
  counts: {
    referrals: number;
    files: number;
    clients: number;
    destinations?: number;
    total: number;
  };
  sources?: {
    local: boolean;
    clinical: boolean;
    clinical_available: boolean;
  };
};

const suggestedSearches: PipelineSuggestedSearch[] = [
  {
    id: "active-referrals",
    category: "REFERRALS",
    prompt: "Show all active referrals.",
    mode: "active",
  },
  {
    id: "unassigned-referrals",
    category: "OWNERSHIP",
    prompt: "Which active referrals are unassigned?",
    mode: "unassigned",
  },
  {
    id: "packet-review",
    category: "PACKETS",
    prompt: "Which packets need document review?",
    mode: "packet_review",
  },
  {
    id: "assessment-work",
    category: "ASSESSMENTS",
    prompt: "Which referrals are in assessment?",
    mode: "assessment",
  },
  {
    id: "admission-decisions",
    category: "DECISIONS",
    prompt: "Which referrals are waiting for an admission decision?",
    mode: "decision",
  },
  {
    id: "uploaded-files",
    category: "FILES",
    prompt: "Show uploaded referral and assessment files.",
    mode: "files",
  },
];

export default function PipelineSearchPanel({
  onOpenPacket,
  onOpenProfile,
  onOpenDestination,
  autoFocus = false,
  resting = false,
  className = "",
}: {
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenProfile: (canonicalClientId: string) => void;
  onOpenDestination: (screen: PipelineSiteScreen) => void;
  autoFocus?: boolean;
  resting?: boolean;
  className?: string;
}) {
  const [searchText, setSearchText] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState<string>();
  const [result, setResult] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");
  const [isFocused, setIsFocused] = useState(autoFocus);
  const [searchNonce, setSearchNonce] = useState(0);
  const submitRequestedRef = useRef(false);

  const visibleSuggestions = suggestedSearches;
  const normalizedQuery = searchText.trim();
  const showSuggestions = !normalizedQuery && (!resting || isFocused) && !result && !error;

  useEffect(() => {
    if (selectedSuggestion) return;
    const query = searchText.trim();
    if (query.length < 2) {
      setResult(null);
      setError("");
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const immediateDestinations = searchSiteDestinations(query);
    if (immediateDestinations.length > 0) {
      setResult(emptySearchResult(query, immediateDestinations));
    }
    // Coalesce ordinary typing while preserving an immediate Enter submission.
    // Local discovery starts first; governed clinical search waits long enough
    // to avoid sending upstream work for every intermediate keystroke.
    const immediateSubmit = submitRequestedRef.current;
    submitRequestedRef.current = false;
    setIsSearching(true);
    setError("");
    let completed = 0;
    let failed = 0;
    const finish = () => {
      completed += 1;
      if (completed < 2 || controller.signal.aborted) return;
      setIsSearching(false);
      if (failed === 2) {
        setResult(null);
        setError("Search is unavailable right now.");
      }
    };
    const runPhase = (scope: "local" | "clinical") => {
      fetchPipelineJson<SearchResult>(`/api/search?scope=${scope}&q=${encodeURIComponent(query)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((payload) => {
          if (!("counts" in payload)) throw new Error("Search is unavailable right now.");
          setResult((current) => mergeSearchResults(current, payload, query));
        })
        .catch(() => {
          if (!controller.signal.aborted) failed += 1;
        })
        .finally(finish);
    };
    const localTimeout = window.setTimeout(() => runPhase("local"), immediateSubmit ? 0 : 50);
    const clinicalTimeout = window.setTimeout(() => runPhase("clinical"), immediateSubmit ? 0 : 180);

    return () => {
      window.clearTimeout(localTimeout);
      window.clearTimeout(clinicalTimeout);
      controller.abort();
    };
  }, [searchText, searchNonce, selectedSuggestion]);

  const runSuggestedSearch = async (suggestion: PipelineSuggestedSearch) => {
    if (isSearching) return;

    setSelectedSuggestion(suggestion.id);
    setIsSearching(true);
    setError("");

    try {
      const payload = await fetchPipelineJson<SearchResult>(
        `/api/search?mode=${suggestion.mode}&q=${encodeURIComponent(suggestion.prompt)}`,
        { cache: "no-store" },
      );
      if (!("counts" in payload)) {
        throw new Error("That search is unavailable right now.");
      }
      setResult(payload);
    } catch (searchError) {
      setResult(null);
      setError(searchError instanceof Error ? searchError.message : "That search is unavailable right now.");
    } finally {
      setIsSearching(false);
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchText.trim();
    if (query.length < 2) return;

    setSelectedSuggestion(undefined);
    submitRequestedRef.current = true;
    setSearchNonce((current) => current + 1);
  };

  return (
    <section aria-label="Search and ask" className={className}>
      <form onSubmit={submitSearch} className={`relative flex items-center bg-transparent ${resting ? "border-b border-[#b3b3b3]" : ""}`}>
        <Search size={resting ? 22 : 20} className="shrink-0 text-[#c4832c]" />
        <input
          autoFocus={autoFocus}
          aria-label="Search or ask"
          value={searchText}
          onChange={(event) => {
            setSearchText(event.target.value);
            setSelectedSuggestion(undefined);
            setResult(null);
            setError("");
          }}
          onFocus={() => setIsFocused(true)}
          placeholder="Search or ask about a client, referral, or file..."
          className={`${resting ? "h-16 text-[17px]" : "h-12 text-[15px]"} min-w-0 flex-1 bg-transparent px-3 text-[#111111] outline-none placeholder:text-[#8a8a8a]`}
        />
        <button
          type="submit"
          aria-label="Run search"
          title="Run search"
          disabled={searchText.trim().length < 2 || isSearching}
          className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0f8b73] text-white hover:bg-[#0c705f] disabled:cursor-not-allowed disabled:bg-[#d9d9d9]"
        >
          <ArrowRight size={15} />
        </button>
      </form>

      {showSuggestions ? (
        <>
          <div className="flex items-center justify-between px-1 py-3 text-[11px] text-[#737373] md:px-2">
            <span>{visibleSuggestions.length} suggested search{visibleSuggestions.length === 1 ? "" : "es"}</span>
            <span>Press Enter to search all records</span>
          </div>

          <div className="mt-1 divide-y divide-[#d9d9d9] border-y border-[#d9d9d9]">
            {visibleSuggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                onClick={() => runSuggestedSearch(suggestion)}
                aria-label={suggestion.prompt}
                className={`group flex min-h-[58px] w-full items-center gap-3 px-3 py-3 text-left hover:bg-[#f7faf9] sm:gap-4 sm:px-5 md:px-6 ${
                  selectedSuggestion === suggestion.id ? "border-l-[3px] border-[#0f8b73] pl-[17px]" : "border-l-[3px] border-transparent"
                }`}
              >
                <span className="w-[82px] shrink-0 text-[9px] font-black uppercase tracking-[0.1em] text-[#737373] group-hover:text-[#0f8b73] sm:w-[112px] sm:text-[10px] sm:tracking-[0.14em]">
                  {suggestion.category}
                </span>
                <span className="min-w-0 flex-1 text-[14px] font-semibold text-[#111111] md:text-[15px]">
                  {suggestion.prompt}
                </span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#d9d9d9] text-[#111111] group-hover:border-[#0f8b73] group-hover:text-[#0f8b73]">
                  <ArrowRight size={15} />
                </span>
              </button>
            ))}
          </div>

        </>
      ) : null}
      {isSearching && !result ? (
        <div className="px-1 py-4 text-[13px] text-[#737373]" role="status" aria-live="polite">
          Searching...
        </div>
      ) : null}
      {error ? (
        <div className="border-l-2 border-[#a63d2f] bg-[#fff7f5] px-4 py-3 text-[13px] font-semibold text-[#59332d]" role="alert">
          {error}
        </div>
      ) : null}
      {result ? (
        <SearchResponse
          result={result}
          isSearching={isSearching}
          onOpenPacket={onOpenPacket}
          onOpenProfile={onOpenProfile}
          onOpenDestination={onOpenDestination}
        />
      ) : null}
    </section>
  );
}

function SearchResponse({
  result,
  isSearching,
  onOpenPacket,
  onOpenProfile,
  onOpenDestination,
}: {
  result: SearchResult;
  isSearching: boolean;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenProfile: (canonicalClientId: string) => void;
  onOpenDestination: (screen: PipelineSiteScreen) => void;
}) {
  if (result.counts.total === 0) {
    return (
      <div className="border-t border-[#d9d9d9] px-5 py-6 text-[13px] text-[#737373] md:px-6">
        {isSearching ? "Checking client records..." : "No records match that search."}
      </div>
    );
  }

  return (
    <div className="border-t-2 border-[#111111]">
      <div className="flex items-center justify-between gap-3 px-5 py-4 md:px-6">
        <span className="text-[11px] font-black uppercase tracking-[0.12em] text-[#0f8b73]">Results</span>
        <span className="text-[12px] text-[#737373]">
          {result.counts.total} result{result.counts.total === 1 ? "" : "s"}{isSearching ? " · checking clients" : ""}
        </span>
      </div>
      <div className="divide-y divide-[#d9d9d9]">
        {(result.destinations ?? []).map((destination) => (
          <SearchResultRow
            key={destination.id}
            title={destination.title}
            detail={destination.detail}
            kind="Page"
            ariaLabel={`Open ${destination.title} from search`}
            onClick={() => onOpenDestination(destination.screen)}
          />
        ))}
        {result.referrals.map((referral) => (
          <SearchResultRow
            key={`referral-${referral.id}`}
            title={referral.name}
            detail={referral.community}
            kind="Referral"
            ariaLabel={`Open referral for ${referral.name}`}
            onClick={() => onOpenPacket(referral)}
          />
        ))}
        {result.files.map((file) => (
          <SearchResultRow
            key={`file-${file.id}`}
            title={file.name}
            detail={`${file.referralName} · ${file.category}`}
            kind="File"
            ariaLabel={`Open file ${file.name}`}
            href={file.downloadUrl ?? file.previewUrl}
            onClick={file.downloadUrl || file.previewUrl ? undefined : () => {
              if (file.canonicalClientId) onOpenProfile(file.canonicalClientId);
              else if (file.referralId && file.community) {
                onOpenPacket({ id: file.referralId, name: file.referralName, community: file.community });
              } else if (file.clientId) onOpenProfile(`pipeline:${file.clientId}`);
            }}
          />
        ))}
        {result.clients.map((client) => (
          <SearchResultRow
            key={`client-${client.canonical_client_id}`}
            title={client.display_name}
            detail={client.current_resident
              ? `${client.current_community || "Current resident"}${client.unit ? ` · Unit ${client.unit}` : ""}`
              : `${client.community_names.join(" · ") || "Community not reported"} · Prior resident`}
            kind="Profile"
            ariaLabel={`Open profile for ${client.display_name}`}
            onClick={() => onOpenProfile(client.canonical_client_id)}
          />
        ))}
      </div>
      {result.clinical_warning ? (
        <div className="border-t border-[#d9d9d9] px-5 py-3 text-[11px] text-[#737373] md:px-6">
          {result.clinical_warning}
        </div>
      ) : null}
    </div>
  );
}

function emptySearchResult(query: string, destinations: PipelineSiteDestination[] = []): SearchResult {
  return {
    query,
    interpreted_query: query,
    referrals: [],
    files: [],
    clients: [],
    destinations,
    clinical_warning: null,
    counts: {
      referrals: 0,
      files: 0,
      clients: 0,
      destinations: destinations.length,
      total: destinations.length,
    },
  };
}

function mergeSearchResults(current: SearchResult | null, incoming: SearchResult, query: string): SearchResult {
  const base = current?.query === query ? current : emptySearchResult(query);
  const referrals = uniqueBy([...base.referrals, ...incoming.referrals], (item) => String(item.id));
  const files = uniqueBy([...base.files, ...incoming.files], (item) => item.id);
  const clients = uniqueBy([...base.clients, ...incoming.clients], (item) => item.canonical_client_id);
  const destinations = uniqueBy(
    [...(base.destinations ?? []), ...(incoming.destinations ?? [])],
    (item) => item.id,
  );
  const sources = {
    local: Boolean(base.sources?.local || incoming.sources?.local),
    clinical: Boolean(base.sources?.clinical || incoming.sources?.clinical),
    clinical_available: Boolean(base.sources?.clinical_available || incoming.sources?.clinical_available),
  };
  const localCounts = incoming.sources?.local ? incoming.counts : base.sources?.local ? base.counts : null;
  const clinicalCounts = incoming.sources?.clinical ? incoming.counts : base.sources?.clinical ? base.counts : null;
  const referralsCount = localCounts?.referrals ?? referrals.length;
  const filesCount = localCounts?.files ?? files.length;
  const clientsCount = (localCounts?.clients ?? 0) + (clinicalCounts?.clients ?? 0);
  return {
    ...base,
    ...incoming,
    referrals,
    files,
    clients,
    destinations,
    clinical_warning: incoming.clinical_warning ?? base.clinical_warning,
    sources,
    counts: {
      referrals: referralsCount,
      files: filesCount,
      clients: clientsCount,
      destinations: destinations.length,
      total: referralsCount + filesCount + clientsCount + destinations.length,
    },
  };
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function SearchResultRow({
  title,
  detail,
  kind,
  ariaLabel,
  onClick,
  href,
}: {
  title: string;
  detail: string;
  kind: string;
  ariaLabel: string;
  onClick?: () => void;
  href?: string;
}) {
  const className = "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-5 border-l-[3px] border-l-transparent px-5 py-4 text-left hover:border-l-[#0f8b73] hover:bg-[#f7faf9] focus-visible:border-l-[#0f8b73] focus-visible:bg-[#f7faf9] focus-visible:outline-none md:px-6";
  const content = (
    <>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-black text-[#111111]">{title}</span>
        <span className="mt-1 block truncate text-[11px] text-[#737373]">{detail}</span>
      </span>
      <span className="self-center text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">{kind}</span>
    </>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" aria-label={ariaLabel} className={className}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} className={className}>
      {content}
    </button>
  );
}
