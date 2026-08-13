export const pipelineCommunities = [
  "Unassigned",
  "San Pablo",
  "Santa Clarita",
  "Turlock",
  "Victoria's House",
  "JC Wallace",
] as const;

export type PipelineCommunity = (typeof pipelineCommunities)[number];

export function pipelineCommunityFromClinicalName(value: string): PipelineCommunity | null {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("san pablo")) return "San Pablo";
  if (normalized.includes("turlock")) return "Turlock";
  if (normalized.includes("wallace")) return "JC Wallace";
  if (normalized.includes("santa clarita")) return "Santa Clarita";
  if (normalized.includes("victoria")) return "Victoria's House";
  return null;
}

export const pipelineCommunityTone: Record<PipelineCommunity, string> = {
  Unassigned: "bg-[#8a8f8c]",
  "San Pablo": "bg-[#2f9369]",
  "Santa Clarita": "bg-[#8bf09a]",
  Turlock: "bg-[#ff8ac0]",
  "Victoria's House": "bg-[#6f8f9f]",
  "JC Wallace": "bg-[#f2d84b]",
};

export const pipelineCommunitySidebarTone: Record<PipelineCommunity, string> = {
  Unassigned: "bg-[#8a8f8c]",
  "San Pablo": "bg-[#43a775]",
  "Santa Clarita": "bg-[#8be58f]",
  Turlock: "bg-[#f27db5]",
  "Victoria's House": "bg-[#8f89ff]",
  "JC Wallace": "bg-[#ffe36d]",
};

export const pipelineSidebarCommunities = pipelineCommunities.map((name) => ({
  name,
  color: pipelineCommunitySidebarTone[name],
}));
