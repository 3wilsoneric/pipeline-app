import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  Files,
  FolderOpen,
  LayoutGrid,
  Link2,
  List,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import PipelineArcadeLoader from "@/components/pipeline/PipelineArcadeLoader";
import ReferralDraftResumeList from "@/components/pipeline/ReferralDraftResumeList";
import ReferralWorklist from "@/components/pipeline/ReferralWorklist";
import ReferralWorkspaceGallery from "@/components/pipeline/ReferralWorkspaceGallery";
import WorkspaceActivityFeed from "@/components/pipeline/WorkspaceActivityFeed";
import type { ClientFileImportReviewItem } from "@/lib/pipeline/client-file-import-contracts";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import { pipelineCommunities } from "@/lib/pipeline/community-config";
import type { ReferralProgress } from "@/lib/pipeline/referral-progress";
import type { ReferralFacets } from "@/lib/pipeline/referral-store";
import type { Referral, ReferralFile } from "@/lib/pipeline/referral-types";
import {
  fileClientName,
  fileMetadata,
  formatDirectoryCount,
  formatMonthKey,
  getEmptyReferralState,
  hasReferralPagination,
  presentCommunity,
  referralFilterCommunity,
  referralFilterCount,
  referralFilterMonth,
  referralFilterWithCommunity,
  referralScopeLabel,
} from "@/components/pipeline/referral-home-directory-model";
import type {
  ReferralFilter,
  WorkspaceLayout,
  WorkspaceSection,
} from "@/components/pipeline/referral-home-directory-model";

const fileCategories: ReferralFile["category"][] = [
  "Referral packet",
  "Face sheet",
  "Assessment",
  "Medication list",
  "TB test",
  "Admission agreement",
  "Conservatorship",
  "LIC 602",
  "LIC 601/603",
  "Provider form",
  "Payer verification",
  "Responsible party",
  "Other",
];

type ReferralHomeDirectoryProps = {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  onOpenPacket: (referral?: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenProfile: (canonicalClientId: string) => void;
  onResumeDraft: (draftKey: `new-${string}`) => void;
  canViewTeam: boolean;
  workspaceSection: WorkspaceSection;
  onWorkspaceSectionChange: (section: WorkspaceSection) => void;
  workspaceLayout: WorkspaceLayout;
  onWorkspaceLayoutChange: (layout: WorkspaceLayout) => void;
  filter: ReferralFilter;
  onFilterChange: (filter: ReferralFilter) => void;
  onShowFiles: () => void;
  facets: ReferralFacets;
  recordedCommunityFacets: ReferralFacets["communities"];
  ownerOptions: string[];
  fileOwnerOptions: string[];
  fileMonthOptions: string[];
  allPacketTotal: number;
  allFileTotal: number;
  reviewIdentity: boolean;
  onReviewIdentityChange: (value: boolean) => void;
  fileCategory: string;
  onFileCategoryChange: (value: string) => void;
  fileCommunity: string;
  onFileCommunityChange: (value: string) => void;
  fileOwner: string;
  onFileOwnerChange: (value: string) => void;
  fileMonth: string;
  onFileMonthChange: (value: string) => void;
  fileSource: string;
  onFileSourceChange: (value: string) => void;
  onClearFileFilters: () => void;
  visibleReferrals: Referral[];
  progressByReferral: Record<number, ReferralProgress>;
  visibleFiles: ReferralFile[];
  visibleImportItems: ClientFileImportReviewItem[];
  isImportLoading: boolean;
  isFileLoading: boolean;
  workspaceLoading: boolean;
  resultCountLabel: string;
  loadingLabel: string;
  loadError: string;
  onRetry: () => void;
  referralPage: number;
  referralNextCursor?: string;
  isLoading: boolean;
  onReferralPrevious: () => void;
  onReferralNext: () => void;
  fileTotal: number;
  filePage: number;
  fileNextCursor?: string;
  onFilePrevious: () => void;
  onFileNext: () => void;
  browseOpen: boolean;
  onBrowseOpenChange: (open: boolean) => void;
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;
  expandedMonth: string;
  onExpandedMonthChange: (month: string) => void;
  sidebarCommunities: Array<{ name: string; count: number }>;
  onReviewItem: (item: ClientFileImportReviewItem) => void;
  onPreviewFile: (file: ReferralFile) => void;
  previewDialog: ReactNode;
  reviewDialog: ReactNode;
};

export function ReferralHomeDirectory(props: ReferralHomeDirectoryProps) {
  return (
    <main data-guide-target="workspace-directory" aria-label="Referral workspaces" className="h-full overflow-y-auto bg-white text-[#111111]">
      <div className="w-full px-4 pb-8 pt-0 sm:px-5 md:px-6 lg:px-8 xl:px-10">
        <h1 className="sr-only">Referral workspaces</h1>
        <ReferralDraftResumeList onResume={props.onResumeDraft} className="mb-3 mt-3" />
        <DirectoryHeader {...props} />
        {props.workspaceSection === "activity" ? (
          <WorkspaceActivityFeed canViewTeam={props.canViewTeam} onOpenPacket={props.onOpenPacket} />
        ) : <WorkspaceDirectoryBody {...props} />}
      </div>
      {props.previewDialog}
      {props.reviewDialog}
      {props.browseOpen ? (
        <WorkspaceBrowseDialog
          months={props.facets.months}
          communities={props.sidebarCommunities}
          filter={props.filter}
          expandedMonth={props.expandedMonth}
          onExpandedMonthChange={props.onExpandedMonthChange}
          onClose={() => props.onBrowseOpenChange(false)}
          onFilterChange={(nextFilter, dismiss) => {
            props.onFilterChange(nextFilter);
            if (dismiss) props.onBrowseOpenChange(false);
          }}
        />
      ) : null}
    </main>
  );
}

function DirectoryHeader(props: ReferralHomeDirectoryProps) {
  return (
    <div className="mb-3 flex min-h-12 flex-wrap items-end justify-between gap-3 border-b border-[#cfd7d3]">
      <div role="tablist" aria-label="Workspace directory sections" className="flex self-stretch">
        <button
          type="button"
          role="tab"
          aria-selected={props.workspaceSection === "workspaces"}
          onClick={() => props.onWorkspaceSectionChange("workspaces")}
          className={`border-b-[3px] px-3 text-[11px] font-black uppercase tracking-[0.08em] ${props.workspaceSection === "workspaces" ? "border-[#0f8b73] text-[#0c705f]" : "border-transparent text-[#68716c] hover:text-[#202723]"}`}
        >
          Workspaces <span className="ml-1 text-[9px] tabular-nums text-[#68716c]">{formatDirectoryCount(props.allPacketTotal)}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={props.workspaceSection === "activity"}
          onClick={() => props.onWorkspaceSectionChange("activity")}
          className={`border-b-[3px] px-3 text-[11px] font-black uppercase tracking-[0.08em] ${props.workspaceSection === "activity" ? "border-[#0f8b73] text-[#0c705f]" : "border-transparent text-[#68716c] hover:text-[#202723]"}`}
        >
          Activity
        </button>
      </div>
      {props.workspaceSection === "workspaces" ? <LayoutSelector {...props} /> : null}
    </div>
  );
}

function LayoutSelector(props: ReferralHomeDirectoryProps) {
  const filesActive = props.filter.kind === "files";
  return (
    <div role="group" aria-label="Workspace layout" aria-hidden={filesActive} className={`mb-2 flex border border-[#cfd7d3] bg-white p-0.5 ${filesActive ? "invisible" : ""}`}>
      <button type="button" disabled={filesActive} aria-label="Show workspaces as a list" aria-pressed={props.workspaceLayout === "list"} onClick={() => props.onWorkspaceLayoutChange("list")} className={`flex h-8 items-center gap-1.5 px-2.5 text-[9px] font-black uppercase tracking-[0.06em] ${props.workspaceLayout === "list" ? "bg-[#eaf5f1] text-[#0c705f]" : "text-[#68716c] hover:bg-[#f5f7f6]"}`}><List size={13} />List</button>
      <button type="button" disabled={filesActive} aria-label="Show workspaces as a gallery" aria-pressed={props.workspaceLayout === "gallery"} onClick={() => props.onWorkspaceLayoutChange("gallery")} className={`flex h-8 items-center gap-1.5 px-2.5 text-[9px] font-black uppercase tracking-[0.06em] ${props.workspaceLayout === "gallery" ? "bg-[#eaf5f1] text-[#0c705f]" : "text-[#68716c] hover:bg-[#f5f7f6]"}`}><LayoutGrid size={13} />Gallery</button>
    </div>
  );
}

function WorkspaceDirectoryBody(props: ReferralHomeDirectoryProps) {
  return (
    <>
      <div className="min-w-0">
        <WorkspaceSearch {...props} />
        <div className="min-h-14 sm:min-h-[104px] lg:min-h-14">
          {props.filter.kind === "files" ? <FileFilterToolbar {...props} /> : <ReferralFilterToolbar {...props} />}
        </div>
        {props.loadError && props.filter.kind !== "files" ? (
          <div className="mb-3 flex items-center justify-between gap-3 border-l-2 border-[#a63d2f] bg-[#fff7f5] px-4 py-3 text-[12px] font-semibold text-[#59332d]" role="alert">
            <span>{props.loadError}</span>
            <button type="button" onClick={props.onRetry} className="flex h-8 items-center gap-2 px-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#a63d2f]">
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        ) : null}
      </div>
      <div data-testid="workspace-content-grid" className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)] xl:gap-5">
        <WorkspaceDirectoryNavigation {...props} />
        <section className="min-w-0 bg-white"><DirectoryResults {...props} /></section>
      </div>
    </>
  );
}

function WorkspaceSearch(props: ReferralHomeDirectoryProps) {
  const filesActive = props.filter.kind === "files";
  return (
    <div data-guide-target="workspace-search" className="flex h-11 min-w-0 items-center gap-3 border-b border-[#bdbdbd] px-2 focus-within:border-[#0f8b73] xl:h-10">
      <Search size={16} className="shrink-0 text-[#0f8b73]" />
      <label htmlFor="workspace-directory-search" className="sr-only">{filesActive ? "Search all uploaded files" : "Search all workspaces"}</label>
      <input id="workspace-directory-search" type="search" aria-label={filesActive ? "Search all uploaded files" : "Search all workspaces"} value={props.searchTerm} onChange={(event) => props.onSearchTermChange(event.target.value)} placeholder={filesActive ? "Search files by name, client, community, owner, or type" : "Search all workspaces by client, community, county, owner, or source"} className="min-w-0 flex-1 bg-transparent text-[13px] text-[#111111] outline-none placeholder:text-[#8a8a8a]" />
      {props.searchTerm ? (
        <button type="button" aria-label="Clear workspace search" onClick={() => props.onSearchTermChange("")} className="flex h-8 w-8 shrink-0 items-center justify-center text-[#737373] hover:text-[#111111] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]"><X size={15} /></button>
      ) : null}
      <span className="hidden shrink-0 text-[9px] font-bold text-[#737373] md:inline">
        {props.resultCountLabel === "Loading..." ? <PipelineArcadeLoader label={props.loadingLabel} compact decorative={props.visibleReferrals.length === 0} /> : props.resultCountLabel}
      </span>
    </div>
  );
}

function ReferralFilterToolbar(props: ReferralHomeDirectoryProps) {
  const activeFilterCount = referralFilterCount(props.filter);
  return (
    <div>
      <button type="button" aria-expanded={props.filtersOpen} aria-controls="referral-filter-controls" onClick={() => props.onFiltersOpenChange(!props.filtersOpen)} className="flex h-11 w-full items-center gap-2 px-2 text-left text-[12px] font-black text-[#303638] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] sm:hidden">
        <SlidersHorizontal size={15} className="text-[#0c705f]" aria-hidden="true" />
        <span className="flex-1">Filters</span>
        {activeFilterCount > 0 ? <span className="flex h-5 min-w-5 items-center justify-center bg-[#0f8b73] px-1 text-[9px] text-white">{activeFilterCount}</span> : null}
        <ChevronDown size={15} className={`text-[#737373] transition-transform ${props.filtersOpen ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {props.filtersOpen ? <div id="referral-filter-controls" className="grid grid-cols-1 gap-2 px-2 pb-3 sm:hidden"><ReferralFilterControls {...props} /></div> : null}
      <div className="hidden gap-2 px-2 py-2 sm:grid sm:grid-cols-2 lg:grid-cols-4"><ReferralFilterControls {...props} /></div>
    </div>
  );
}

function ReferralFilterControls(props: ReferralHomeDirectoryProps) {
  return (
    <>
      <select aria-label="Filter workspaces by community" value={referralFilterCommunity(props.filter)} onChange={(event) => props.onFilterChange(referralFilterWithCommunity(props.filter, event.target.value))} className="h-10 min-w-0 border border-[#d9d9d9] bg-white px-2 text-[12px] font-black text-[#303638] outline-none focus:border-[#0f8b73]">
        <option value="">All communities</option>
        {props.recordedCommunityFacets.map((community) => <option key={community.value} value={community.value}>{presentCommunity(community.value)}</option>)}
      </select>
      <select aria-label="Filter workspaces by county" value={props.filter.kind === "county" ? props.filter.value : ""} onChange={(event) => props.onFilterChange(event.target.value ? { kind: "county", value: event.target.value } : { kind: "all" })} className="h-10 min-w-0 border border-[#9fcfc2] bg-[#f7fbf9] px-2 text-[12px] font-black text-[#0c705f] outline-none focus:border-[#0f8b73]">
        <option value="">All counties</option>
        {props.facets.counties.map((county) => <option key={county.value} value={county.value}>{county.value} ({formatDirectoryCount(county.count)})</option>)}
      </select>
      <select aria-label="Filter by owner" value={props.filter.kind === "owner" ? props.filter.value : ""} onChange={(event) => props.onFilterChange(event.target.value ? { kind: "owner", value: event.target.value } : { kind: "all" })} className="h-10 min-w-0 border border-[#d9d9d9] bg-white px-2 text-[12px] font-black text-[#303638] outline-none focus:border-[#0f8b73]">
        <option value="">All owners</option>
        {props.ownerOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
      </select>
      <select aria-label="Filter by priority" value={props.filter.kind === "priority" ? props.filter.value : ""} onChange={(event) => props.onFilterChange(event.target.value ? { kind: "priority", value: event.target.value as Referral["priority"] } : { kind: "all" })} className="h-10 min-w-0 border border-[#d9d9d9] bg-white px-2 text-[12px] font-black text-[#303638] outline-none focus:border-[#0f8b73]">
        <option value="">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="standard">Standard</option>
      </select>
    </>
  );
}

function FileFilterToolbar(props: ReferralHomeDirectoryProps) {
  const hasFilters = Boolean(props.fileCategory || props.fileCommunity || props.fileOwner || props.fileMonth || props.fileSource);
  return (
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto px-2 py-2.5">
      <span className="mr-1 shrink-0 text-[10px] font-black uppercase tracking-[0.14em] text-[#0c705f]">Files</span>
      <button type="button" onClick={() => props.onReviewIdentityChange(false)} className={`h-9 shrink-0 border px-3 text-[11px] font-black ${!props.reviewIdentity ? "border-[#0f8b73] bg-[#effaf5] text-[#0c705f]" : "border-[#d9d9d9] text-[#595959]"}`}>Linked files</button>
      <button type="button" onClick={() => props.onReviewIdentityChange(true)} className={`h-9 shrink-0 border px-3 text-[11px] font-black ${props.reviewIdentity ? "border-[#b07b21] bg-[#fffaf0] text-[#8a5a10]" : "border-[#d9d9d9] text-[#595959]"}`}>Needs identity</button>
      {!props.reviewIdentity ? <FileFilterSelects {...props} /> : null}
      {!props.reviewIdentity && hasFilters ? <button type="button" onClick={props.onClearFileFilters} className="h-9 shrink-0 px-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#737373] hover:text-[#a63d2f]">Clear</button> : null}
    </div>
  );
}

function FileFilterSelects(props: ReferralHomeDirectoryProps) {
  return (
    <>
      <select aria-label="Filter files by category" value={props.fileCategory} onChange={(event) => props.onFileCategoryChange(event.target.value)} className="h-9 shrink-0 border border-[#d9d9d9] bg-white px-2 text-[11px] font-black outline-none focus:border-[#0f8b73]"><option value="">All categories</option>{fileCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select>
      <select aria-label="Filter files by community" value={props.fileCommunity} onChange={(event) => props.onFileCommunityChange(event.target.value)} className="h-9 shrink-0 border border-[#d9d9d9] bg-white px-2 text-[11px] font-black outline-none focus:border-[#0f8b73]"><option value="">All communities</option>{pipelineCommunities.map((community) => <option key={community} value={community}>{community}</option>)}</select>
      <select aria-label="Filter files by owner" value={props.fileOwner} onChange={(event) => props.onFileOwnerChange(event.target.value)} className="h-9 max-w-[160px] shrink-0 border border-[#d9d9d9] bg-white px-2 text-[11px] font-black outline-none focus:border-[#0f8b73]"><option value="">All owners</option>{props.fileOwnerOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}</select>
      <select aria-label="Filter files by upload month" value={props.fileMonth} onChange={(event) => props.onFileMonthChange(event.target.value)} className="h-9 max-w-[170px] shrink-0 border border-[#d9d9d9] bg-white px-2 text-[11px] font-black outline-none focus:border-[#0f8b73]"><option value="">All months</option>{props.fileMonthOptions.map((month) => <option key={month} value={month}>{formatMonthKey(month)}</option>)}</select>
      <select aria-label="Filter files by source" value={props.fileSource} onChange={(event) => props.onFileSourceChange(event.target.value)} className="h-9 shrink-0 border border-[#d9d9d9] bg-white px-2 text-[11px] font-black outline-none focus:border-[#0f8b73]"><option value="">All sources</option><option value="pipeline">Pipeline</option><option value="allo">Allo import</option><option value="alamo_platform">Alamo Platform</option><option value="import">Other import</option></select>
    </>
  );
}

function WorkspaceDirectoryNavigation(props: ReferralHomeDirectoryProps) {
  return (
    <aside aria-label="Workspace navigation" className="min-w-0 bg-white pt-0 xl:sticky xl:top-0 xl:self-start">
      <nav aria-label="Workspace views" className="grid grid-cols-2 gap-2 pb-2 xl:block xl:space-y-1 xl:pb-0">
        <WorkspaceNavItem icon={FolderOpen} label="All workspaces" compactLabel="All" count={props.allPacketTotal} active={props.filter.kind === "all" || ["community", "monthCommunity", "county", "month", "owner", "priority"].includes(props.filter.kind)} onClick={() => props.onFilterChange({ kind: "all" })} />
        <WorkspaceNavItem icon={Files} label="All files" compactLabel="Files" count={props.allFileTotal} active={props.filter.kind === "files"} onClick={props.onShowFiles} />
      </nav>
      <button type="button" aria-label="Browse workspaces by month and community" onClick={() => props.onBrowseOpenChange(true)} className="mt-1 flex h-11 w-full items-center gap-3 border border-[#d9dfdc] bg-[#f8faf9] px-3 text-left text-[#303638] outline-none hover:border-[#9fcfc2] hover:bg-[#f2f8f6] focus-visible:ring-2 focus-visible:ring-[#0f8b73] xl:hidden">
        <CalendarDays size={16} className="shrink-0 text-[#0c705f]" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-[12px] font-black">{referralScopeLabel(props.filter)}</span><ChevronRight size={15} className="shrink-0 text-[#737373]" aria-hidden="true" />
      </button>
      <div className="mt-5 hidden xl:block"><WorkspaceArchiveNavigation months={props.facets.months} communities={props.sidebarCommunities} filter={props.filter} expandedMonth={props.expandedMonth} onExpandedMonthChange={props.onExpandedMonthChange} onFilterChange={props.onFilterChange} /></div>
    </aside>
  );
}

function DirectoryResults(props: ReferralHomeDirectoryProps) {
  if (props.filter.kind === "files") return <FileDirectoryResults {...props} />;
  if (props.visibleReferrals.length > 0) return <ReferralDirectoryResults {...props} />;
  const emptyReferralState = getEmptyReferralState(props.filter, props.searchTerm);
  return (
    <div className="px-5 py-16 text-center">
      <div className="text-[15px] font-black text-[#111111]">{props.workspaceLoading ? <PipelineArcadeLoader label="Loading workspaces" /> : emptyReferralState.title}</div>
      {!props.workspaceLoading ? <p className="mx-auto mt-2 max-w-[420px] text-[12px] leading-5 text-[#737373]">{emptyReferralState.detail}</p> : null}
      {!props.workspaceLoading && props.filter.kind !== "all" ? <button type="button" onClick={() => props.onFilterChange({ kind: "all" })} className="mt-4 h-9 border border-[#0f8b73] px-3 text-[11px] font-black text-[#0f8b73] hover:bg-[#effaf5]">Show all workspaces</button> : null}
    </div>
  );
}

function ReferralDirectoryResults(props: ReferralHomeDirectoryProps) {
  return (
    <>
      {props.workspaceLayout === "gallery" ? <ReferralWorkspaceGallery referrals={props.visibleReferrals} onOpenPacket={props.onOpenPacket} progressByReferral={props.progressByReferral} /> : <ReferralWorklist referrals={props.visibleReferrals} onOpenPacket={props.onOpenPacket} progressByReferral={props.progressByReferral} />}
      {hasReferralPagination(props.referralPage, props.referralNextCursor) ? (
        <div className="flex items-center justify-between border-t border-[#d9d9d9] px-5 py-3">
          <button type="button" disabled={props.referralPage === 0 || props.isLoading} onClick={props.onReferralPrevious} className="h-8 px-2 text-[11px] font-black text-[#0f8b73] disabled:text-[#b3b3b3]">Previous</button>
          <span className="text-[11px] text-[#737373]">Page {props.referralPage + 1}</span>
          <button type="button" disabled={!props.referralNextCursor || props.isLoading} onClick={props.onReferralNext} className="h-8 px-2 text-[11px] font-black text-[#0f8b73] disabled:text-[#b3b3b3]">Next</button>
        </div>
      ) : null}
    </>
  );
}

function FileDirectoryResults(props: ReferralHomeDirectoryProps) {
  if (props.reviewIdentity) return <IdentityReviewResults {...props} />;
  if (props.visibleFiles.length > 0) return <LinkedFileResults {...props} />;
  return <div className="px-5 py-16 text-center"><div className="text-[15px] font-black text-[#111111]">{props.isFileLoading ? "Loading files" : props.searchTerm.trim() ? "No files match this search" : "No uploaded files yet"}</div></div>;
}

function IdentityReviewResults(props: ReferralHomeDirectoryProps) {
  if (props.visibleImportItems.length === 0) {
    return (
      <div className="px-5 py-16 text-center">
        <div className="text-[15px] font-black text-[#111111]">{props.isImportLoading ? "Loading identity review" : "No files need identity review"}</div>
        {!props.isImportLoading ? <p className="mx-auto mt-2 max-w-[440px] text-[12px] leading-5 text-[#737373]">Staged imports appear here until a person confirms the correct client workspace.</p> : null}
      </div>
    );
  }
  return (
    <div className="divide-y divide-[#d9d9d9]">
      {props.visibleImportItems.map((item) => (
        <div key={item.import_item_id} className="flex items-center gap-4 px-5 py-4 hover:bg-[#fffaf0]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#e2ca9f] bg-[#fffaf0] text-[#8a5a10]"><Link2 size={16} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-black text-[#111111]">{item.source_file_name}</span><span className="mt-1 block truncate text-[11px] text-[#737373]">{formatClientIdentityTitle({ name: item.source_client_name, community: item.source_community })}{item.source_community ? ` · ${item.source_community}` : ""} · {item.source_system}</span></span>
          <button type="button" onClick={() => props.onReviewItem(item)} className="h-9 border border-[#b07b21] px-3 text-[10px] font-black text-[#8a5a10] hover:bg-white">Review identity</button>
        </div>
      ))}
    </div>
  );
}

function LinkedFileResults(props: ReferralHomeDirectoryProps) {
  return (
    <>
      <div className="divide-y divide-[#d9d9d9]">{props.visibleFiles.map((file) => <LinkedFileRow key={file.id} file={file} onOpenPacket={props.onOpenPacket} onOpenProfile={props.onOpenProfile} onPreviewFile={props.onPreviewFile} />)}</div>
      {props.fileTotal > 100 ? (
        <div className="flex items-center justify-between border-t border-[#d9d9d9] px-5 py-3">
          <button type="button" disabled={props.filePage === 0} onClick={props.onFilePrevious} className="h-8 px-2 text-[11px] font-black text-[#0f8b73] disabled:text-[#b3b3b3]">Previous</button>
          <span className="text-[11px] font-normal text-[#737373]">Page {props.filePage + 1}</span>
          <button type="button" disabled={!props.fileNextCursor} onClick={props.onFileNext} className="h-8 px-2 text-[11px] font-black text-[#0f8b73] disabled:text-[#b3b3b3]">Next</button>
        </div>
      ) : null}
    </>
  );
}

function LinkedFileRow({ file, onOpenPacket, onOpenProfile, onPreviewFile }: {
  file: ReferralFile;
  onOpenPacket: ReferralHomeDirectoryProps["onOpenPacket"];
  onOpenProfile: ReferralHomeDirectoryProps["onOpenProfile"];
  onPreviewFile: ReferralHomeDirectoryProps["onPreviewFile"];
}) {
  const referralFile = file.id.startsWith("referral-");
  const openWorkspace = () => {
    if (file.canonicalClientId) onOpenProfile(file.canonicalClientId);
    else if (file.referralId && file.community) onOpenPacket({ id: file.referralId, name: fileClientName(file), community: file.community });
    else if (file.clientId) onOpenProfile(`pipeline:${file.clientId}`);
  };
  return (
    <div className="flex w-full items-center gap-2 px-5 py-1 hover:bg-[#f7faf9]">
      <button type="button" onClick={() => referralFile ? openWorkspace() : onPreviewFile(file)} className="flex min-w-0 flex-1 items-center gap-4 py-3 text-left">
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden border border-[#b8dacf] bg-[#effaf5] text-[#0c705f]">
          <FileText size={16} />
          {file.thumbnailUrl ? <Image src={file.thumbnailUrl} alt="" width={36} height={36} unoptimized className="absolute inset-0 h-full w-full object-cover" onError={(event) => event.currentTarget.classList.add("hidden")} /> : null}
        </span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-black text-[#111111]">{file.name}</span><span className="mt-1 block truncate text-[11px] font-normal text-[#737373]">{fileMetadata(file)}</span></span>
        <span className="hidden text-[11px] font-black text-[#737373] sm:block">{file.category}</span>
        {referralFile ? <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#d9d9d9] text-[#111111]"><ArrowRight size={15} /></span> : <Eye size={16} className="shrink-0 text-[#0f8b73]" />}
      </button>
      {!referralFile ? <button type="button" onClick={openWorkspace} aria-label={`Open ${fileClientName(file)} workspace`} title="Open client workspace" className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#d9d9d9] text-[#111111] hover:border-[#0f8b73] hover:text-[#0f8b73]"><ArrowRight size={16} /></button> : null}
    </div>
  );
}

function WorkspaceArchiveNavigation({ months, communities, filter, expandedMonth, onExpandedMonthChange, onFilterChange }: {
  months: ReferralFacets["months"];
  communities: Array<{ name: string; count: number }>;
  filter: ReferralFilter;
  expandedMonth: string;
  onExpandedMonthChange: (month: string) => void;
  onFilterChange: (filter: ReferralFilter, dismiss?: boolean) => void;
}) {
  const selectedMonth = referralFilterMonth(filter);
  const selectedCommunity = referralFilterCommunity(filter);
  return (
    <nav aria-label="Browse workspaces by date and community">
      <div>{months.length === 0 ? <div className="px-3 py-4 text-[11px] leading-5 text-[#737373]">Dated workspaces will appear here.</div> : months.map((month) => <WorkspaceArchiveMonth key={month.value} month={month} communities={communities} selectedMonth={selectedMonth} selectedCommunity={selectedCommunity} expanded={expandedMonth === month.value} onExpandedMonthChange={onExpandedMonthChange} onFilterChange={onFilterChange} />)}</div>
    </nav>
  );
}

function WorkspaceArchiveMonth({ month, communities, selectedMonth, selectedCommunity, expanded, onExpandedMonthChange, onFilterChange }: {
  month: ReferralFacets["months"][number];
  communities: Array<{ name: string; count: number }>;
  selectedMonth: string;
  selectedCommunity: string;
  expanded: boolean;
  onExpandedMonthChange: (month: string) => void;
  onFilterChange: (filter: ReferralFilter, dismiss?: boolean) => void;
}) {
  const monthSelected = selectedMonth === month.value;
  return (
    <div className="mb-1">
      <button type="button" aria-expanded={expanded} onClick={() => { onExpandedMonthChange(expanded ? "" : month.value); onFilterChange({ kind: "month", value: month.value }); }} className={`flex h-10 w-full items-center gap-2 border px-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] ${monthSelected ? "border-[#9fcfc2] bg-[#effaf5] text-[#0c705f]" : "border-transparent text-[#444a47] hover:border-[#e0e5e2] hover:bg-[#f8faf9]"}`}>
        {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}<span className="min-w-0 flex-1 truncate text-[11px] font-black">{formatMonthKey(month.value)}</span><span className="shrink-0 text-[9px] font-black tabular-nums text-[#595959]">{formatDirectoryCount(month.count)}</span>
      </button>
      {expanded ? <div className="ml-4 border-l border-[#dce3e0] pl-2 pt-1"><button type="button" aria-current={monthSelected && !selectedCommunity ? "page" : undefined} onClick={() => onFilterChange({ kind: "month", value: month.value }, true)} className={`flex min-h-9 w-full items-center px-2 text-left text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] ${monthSelected && !selectedCommunity ? "bg-[#effaf5] text-[#0c705f]" : "text-[#646b67] hover:bg-[#f8faf9] hover:text-[#202320]"}`}>All communities</button>{communities.map(({ name }) => <WorkspaceArchiveCommunity key={`${month.value}-${name}`} month={month.value} name={name} active={monthSelected && selectedCommunity === name} onFilterChange={onFilterChange} />)}</div> : null}
    </div>
  );
}

function WorkspaceArchiveCommunity({ month, name, active, onFilterChange }: { month: string; name: string; active: boolean; onFilterChange: (filter: ReferralFilter, dismiss?: boolean) => void }) {
  return <button type="button" aria-current={active ? "page" : undefined} onClick={() => onFilterChange({ kind: "monthCommunity", month, community: name }, true)} className={`flex min-h-9 w-full items-center px-2 text-left text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] ${active ? "bg-[#effaf5] text-[#0c705f]" : "text-[#646b67] hover:bg-[#f8faf9] hover:text-[#202320]"}`}><span className="truncate">{presentCommunity(name)}</span></button>;
}

function WorkspaceBrowseDialog({ months, communities, filter, expandedMonth, onExpandedMonthChange, onFilterChange, onClose }: {
  months: ReferralFacets["months"];
  communities: Array<{ name: string; count: number }>;
  filter: ReferralFilter;
  expandedMonth: string;
  onExpandedMonthChange: (month: string) => void;
  onFilterChange: (filter: ReferralFilter, dismiss?: boolean) => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/30" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label="Browse workspaces" className="flex h-[100dvh] w-full max-w-[390px] flex-col border-l border-[#cbd5d1] bg-white shadow-[-16px_0_40px_rgba(20,35,30,0.16)]">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#d9dfdc] px-5"><div><h2 className="text-[16px] font-black text-[#202320]">Browse workspaces</h2><div className="mt-0.5 text-[10px] text-[#737373]">Choose a month, then a community.</div></div><button ref={closeButtonRef} type="button" aria-label="Close referral browser" onClick={onClose} className="flex h-10 w-10 items-center justify-center border border-[#d9dfdc] text-[#595959] hover:border-[#0f8b73] hover:text-[#0f8b73] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]"><X size={17} aria-hidden="true" /></button></header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4"><WorkspaceArchiveNavigation months={months} communities={communities} filter={filter} expandedMonth={expandedMonth} onExpandedMonthChange={onExpandedMonthChange} onFilterChange={onFilterChange} /></div>
      </section>
    </div>,
    document.body,
  );
}

function WorkspaceNavItem({ icon: Icon, label, compactLabel, count, active, onClick }: { icon: LucideIcon; label: string; compactLabel?: string; count?: number; active: boolean; onClick: () => void }) {
  return <button type="button" aria-label={label} aria-current={active ? "page" : undefined} onClick={onClick} className={`flex h-11 min-w-0 items-center gap-2 border px-3 text-left text-[12px] font-black tracking-[0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] max-[479px]:gap-1.5 max-[479px]:px-2 max-[479px]:text-[11px] xl:h-9 xl:w-full ${active ? "border-[#9fcfc2] bg-[#effaf5] text-[#0c705f]" : "border-transparent text-[#595959] hover:border-[#e2e2e2] hover:bg-[#fafafa] hover:text-[#111111]"}`}><Icon size={16} className="shrink-0 max-[479px]:hidden" /><span className="truncate sm:hidden">{compactLabel ?? label}</span><span className="hidden truncate sm:inline">{label}</span>{typeof count === "number" ? <span className="ml-auto hidden shrink-0 text-[9px] font-black tabular-nums xl:inline">{formatDirectoryCount(count)}</span> : null}</button>;
}
