const BASE_PATH_PATTERN = /^\/[a-z0-9][a-z0-9/_-]*$/i;

export function normalizePipelineBasePath(value) {
  const candidate = String(value ?? "").trim().replace(/\/+$/, "");
  if (!candidate || candidate === "/") return "";
  if (!BASE_PATH_PATTERN.test(candidate) || candidate.includes("//") || candidate.includes("..")) {
    throw new Error("Pipeline base path must be a root-relative path without query parameters or traversal.");
  }
  return candidate;
}

export function withPipelineBasePath(path, basePath) {
  const normalizedBasePath = normalizePipelineBasePath(basePath);
  const candidate = String(path ?? "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return candidate;
  if (!normalizedBasePath || candidate === normalizedBasePath || candidate.startsWith(`${normalizedBasePath}/`)) {
    return candidate;
  }
  if (candidate === "/") return normalizedBasePath;
  if (candidate.startsWith("/?") || candidate.startsWith("/#")) {
    return `${normalizedBasePath}${candidate.slice(1)}`;
  }
  return `${normalizedBasePath}${candidate}`;
}

export function withoutPipelineBasePath(path, basePath) {
  const normalizedBasePath = normalizePipelineBasePath(basePath);
  const candidate = String(path ?? "");
  if (!normalizedBasePath) return candidate;
  if (candidate === normalizedBasePath) return "/";
  return candidate.startsWith(`${normalizedBasePath}/`)
    ? candidate.slice(normalizedBasePath.length)
    : candidate;
}
