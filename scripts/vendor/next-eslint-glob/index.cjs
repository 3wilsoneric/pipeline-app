// Next 16.3.8 uses only globSync(pattern, { onlyDirectories: true }).
// Keep fast-glob's non-recursive literal-directory behavior; tinyglobby otherwise
// expands literal roots into every descendant. No other fast-glob API is exposed.
const { globSync } = module.require("tinyglobby");
const { isAbsolute } = module.require("node:path");

exports.globSync = (pattern, options) => globSync(pattern, {
  cwd: process.cwd(),
  absolute: isAbsolute(pattern),
  ...options,
  expandDirectories: false,
}).map((directory) => directory.replace(/\/$/, "") || "/");
