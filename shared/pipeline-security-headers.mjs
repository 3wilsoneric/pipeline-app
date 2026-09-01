export const PIPELINE_LOOM_FRAME_ORIGIN = "https://www.loom.com";

export const PIPELINE_PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  `fullscreen=(self "${PIPELINE_LOOM_FRAME_ORIGIN}")`,
  `picture-in-picture=(self "${PIPELINE_LOOM_FRAME_ORIGIN}")`,
].join(", ");

export function pipelineContentSecurityPolicy({ scriptSources, connectSources }) {
  return `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://login.microsoftonline.com; script-src ${scriptSources}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ${connectSources}; frame-src 'self' https://login.microsoftonline.com ${PIPELINE_LOOM_FRAME_ORIGIN};`;
}
