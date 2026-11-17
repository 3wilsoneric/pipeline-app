# Override retired

The README and archive here document the temporary Next 16.3.8 ESLint override.
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
was withdrawn on October 23, 2026. The override was removed while upgrading
to patched Next 16.4.3. Current installs use the plugin's upstream `fast-glob`.
The regression test retains the archive-integrity check and verifies the
upstream caller, root discovery, and actual ESLint rule violations.

Version 1 remains retired. Version 2, introduced November 17, 2026, uses a
different maintained matcher for the three lint callers described in README.md
to remove the unpatched picomatch dependency. The original archive is retained.
