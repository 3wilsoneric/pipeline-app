export type OperatorTrainingVideoDefinition = {
  moduleId: string;
  activityId: string;
  title: string;
  shareUrl: string;
  durationLabel?: string;
  summary?: string;
};

export type OperatorTrainingVideo = OperatorTrainingVideoDefinition & {
  embedUrl: string;
  watchUrl: string;
};

// Add reviewed Loom recordings here. A lesson stays unchanged when no video is
// configured, so recordings can be introduced one workflow at a time.
export const operatorTrainingVideoDefinitions: readonly OperatorTrainingVideoDefinition[] = [
  // trainingVideo("create-referral", "guided-practice", "Create a referral", "https://www.loom.com/share/LOOM_VIDEO_ID", "6 min"),
];

export function getOperatorTrainingVideo(moduleId: string, activityId: string): OperatorTrainingVideo | null {
  const definition = operatorTrainingVideoDefinitions.find(
    (candidate) => candidate.moduleId === moduleId && candidate.activityId === activityId,
  );
  return definition ? resolveOperatorTrainingVideo(definition) : null;
}

export function resolveOperatorTrainingVideo(definition: OperatorTrainingVideoDefinition): OperatorTrainingVideo | null {
  const location = parseLoomVideoUrl(definition.shareUrl);
  if (!location || !definition.moduleId.trim() || !definition.activityId.trim() || !definition.title.trim()) return null;
  const sid = location.sid ? `?sid=${encodeURIComponent(location.sid)}` : "";
  return {
    ...definition,
    embedUrl: `https://www.loom.com/embed/${location.id}${sid}`,
    watchUrl: `https://www.loom.com/share/${location.id}${sid}`,
  };
}

export function parseLoomVideoUrl(value: string): { id: string; sid: string | null } | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || (hostname !== "loom.com" && hostname !== "www.loom.com")) return null;
    const match = url.pathname.match(/^\/(?:share|embed)\/([A-Za-z0-9_-]{10,128})\/?$/);
    if (!match) return null;
    const sid = url.searchParams.get("sid");
    return { id: match[1], sid: sid && /^[A-Za-z0-9-]{10,128}$/.test(sid) ? sid : null };
  } catch {
    return null;
  }
}

function trainingVideo(
  moduleId: string,
  activityId: string,
  title: string,
  shareUrl: string,
  durationLabel?: string,
  summary?: string,
): OperatorTrainingVideoDefinition {
  return { moduleId, activityId, title, shareUrl, durationLabel, summary };
}

// Keep the helper exercised by TypeScript even while the initial catalog is empty.
void trainingVideo;
