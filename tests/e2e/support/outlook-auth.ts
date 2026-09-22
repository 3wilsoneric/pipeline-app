import { expect, type Page, type Route } from "@playwright/test";

export function microsoftMetadata() {
  const authority = "https://login.microsoftonline.com/common";
  return { issuer: "https://login.microsoftonline.com/{tenantid}/v2.0", authorization_endpoint: `${authority}/oauth2/v2.0/authorize`, token_endpoint: `${authority}/oauth2/v2.0/token`, end_session_endpoint: `${authority}/oauth2/v2.0/logout`, jwks_uri: `${authority}/discovery/v2.0/keys` };
}

export function microsoftCallback(route: Route, callback: URL) {
  if (route.request().frame().page().context().browser()?.browserType().name() === "chromium") {
    return route.fulfill({ status: 302, headers: { location: callback.href } });
  }
  // WebKit cannot fulfill an intercepted navigation with an HTTP redirect.
  // Complete the same synthetic OAuth callback as a browser navigation.
  return route.fulfill({ contentType: "text/html", body: `<script>location.replace(${JSON.stringify(callback.href).replaceAll("<", "\\u003c")})</script>` });
}

export async function mockOutlookSignInError(page: Page, error = "login_required") {
  await page.route("https://login.microsoftonline.com/**", route => {
    const request = new URL(route.request().url());
    if (request.pathname.includes(".well-known")) return route.fulfill({ json: microsoftMetadata() });
    if (!request.pathname.endsWith("/authorize")) return route.abort();
    const callback = new URL(request.searchParams.get("redirect_uri")!);
    expect(callback.origin).toBe(new URL(page.url()).origin);
    callback.hash = new URLSearchParams({ error, error_description: "Synthetic Microsoft response", state: request.searchParams.get("state")! }).toString();
    return microsoftCallback(route, callback);
  });
}
