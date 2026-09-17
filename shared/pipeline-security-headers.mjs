export const PIPELINE_LOOM_FRAME_ORIGIN = "https://www.loom.com";

export const PIPELINE_PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  `fullscreen=(self "${PIPELINE_LOOM_FRAME_ORIGIN}")`,
  `picture-in-picture=(self "${PIPELINE_LOOM_FRAME_ORIGIN}")`,
].join(", ");

export function pipelineContentSecurityPolicy({ scriptSources, connectSources, storageAccount = "", development = false } = {}) {
  scriptSources ??= development ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";
  connectSources ??= "'self' https://login.microsoftonline.com https://*.msauth.net https://*.msftauth.net"
    + (development ? " ws://localhost:* ws://127.0.0.1:*" : "");
  // Account names, not arbitrary origins: never broaden this to all Azure storage.
  if (/^[a-z0-9]{3,24}$/.test(storageAccount)) connectSources += ` https://${storageAccount}.blob.core.windows.net`;
  return `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://login.microsoftonline.com; script-src ${scriptSources}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ${connectSources}; frame-src 'self' https://login.microsoftonline.com ${PIPELINE_LOOM_FRAME_ORIGIN};`;
}
