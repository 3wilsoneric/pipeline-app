const PIPELINE_WELCOME_SESSION_KEY = "pipeline.welcome-session.v2";
const PIPELINE_WELCOME_HISTORY_KEY = "pipeline.welcome-history.v1";

export function getPipelineWelcomeSessionKey(userId: string) {
  return `${PIPELINE_WELCOME_SESSION_KEY}:${encodeURIComponent(userId)}`;
}

export function getPipelineWelcomeHistoryKey(userId: string) {
  return `${PIPELINE_WELCOME_HISTORY_KEY}:${encodeURIComponent(userId)}`;
}
