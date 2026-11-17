// Only the reviewed Next root-discovery and TypeScript lint-project callers.
// Keep matching in maintained node-glob; do not implement a glob parser here.
const { globSync, hasMagic } = module.require("glob");
const { statSync } = module.require("node:fs");
const { resolve } = module.require("node:path");

const supported = new Set(["cwd", "absolute", "dot", "ignore", "expandDirectories", "onlyDirectories"]);
const directory = (path) => {
  try { return statSync(path).isDirectory(); }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
};

const negative = (pattern) => pattern.startsWith("!") && !pattern.startsWith("!(");
exports.isDynamicPattern = (pattern) => negative(pattern) || hasMagic(pattern, { magicalBraces: true });

exports.globSync = (patterns, options = {}) => {
  for (const key of Object.keys(options)) {
    if (!supported.has(key)) throw new Error(`Review the lint glob adapter before using option: ${key}`);
  }
  const cwd = options.cwd || process.cwd();
  const inputs = (Array.isArray(patterns) ? patterns : [patterns]).filter(Boolean);
  const ignored = typeof options.ignore === "string" ? [options.ignore] : options.ignore || [];
  const excludes = [...ignored, ...inputs.filter(negative).map((pattern) => pattern.slice(1))]
    .filter((pattern) => pattern && !negative(pattern));
  // tinyglobby expands literal include directories; Next root discovery does not.
  const includes = inputs.filter((pattern) => !negative(pattern)).map((pattern) => options.onlyDirectories !== true &&
    options.expandDirectories !== false && directory(resolve(cwd, pattern))
    ? `${pattern.replace(/\/$/, "")}/**/*` : pattern);
  // Both existing lint callers treat an excluded directory as an excluded tree.
  const ignore = excludes.flatMap((pattern) => [pattern, `${pattern.replace(/\/$/, "")}/**`]);
  const paths = globSync(includes, {
    cwd, absolute: options.absolute, dot: options.dot, ignore,
    nodir: options.onlyDirectories !== true,
    follow: true, nocase: false,
  });
  return options.onlyDirectories === true ? paths.filter((path) => directory(resolve(cwd, path))) : paths;
};
