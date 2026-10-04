# Next ESLint directory matching

Temporary, development-only replacement for Next 16.3.8's sole `fast-glob`
call, preserving all Next/React/TypeScript rules and the existing ESLint config.
It uses the already-installed tinyglobby, with directory expansion disabled to
preserve literal root matching. This removes the unpatched `braces` dependency
([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)); it does
not suppress the advisory or change the audit threshold.

The ceiling is Next's current `globSync` directory-discovery call, not general
fast-glob compatibility. Revisit/remove the override when upgrading Next's ESLint
plugin or when upstream removes/fixes this dependency. The regression test guards
the call surface, directory discovery, archive contents, and actual lint errors.

The tiny archive is committed so npm locks its integrity, Docker can install it
before copying application source, and installs need no patch/postinstall hook.
After editing the source, regenerate it with `npm pack --ignore-scripts` in this
directory, then update the root lockfile and run the regression test.
