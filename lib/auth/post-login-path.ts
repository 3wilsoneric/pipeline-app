const DEFAULT_POST_LOGIN_PATH = "/";

export function normalizePostLoginPath(value: unknown) {
  if (typeof value !== "string") return DEFAULT_POST_LOGIN_PATH;

  const path = value.trim();
  if (
    !path ||
    path.length > 2_048 ||
    !/^\/(?!\/)/.test(path) ||
    /[\\\u0000-\u001f\u007f]/.test(path) ||
    /^\/sign-in(?:[/?#]|$)/i.test(path)
  ) {
    return DEFAULT_POST_LOGIN_PATH;
  }

  return path;
}

const POST_LOGIN_PATH_KEY = "pipeline.post-login-path.v1";

export function savePostLoginPath(value: unknown) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(POST_LOGIN_PATH_KEY, normalizePostLoginPath(value));
}

export function readPostLoginPath() {
  if (typeof window === "undefined") return DEFAULT_POST_LOGIN_PATH;
  return normalizePostLoginPath(window.sessionStorage.getItem(POST_LOGIN_PATH_KEY));
}

export function clearPostLoginPath() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(POST_LOGIN_PATH_KEY);
}
