# Lint directory and project matching

Version 2 is a development-only adapter for three reviewed callers:

- Next 16.4.3 root discovery: `fast-glob.globSync`, directories only.
- TypeScript ESLint 8.57.1 project discovery: `tinyglobby.globSync` and `isDynamicPattern`.
- TypeScript import resolver 3.10.1: the same two functions for projects and source files.

These callers now use maintained `glob` 14.0.6 instead of the picomatch dependency
affected by [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
There is no published picomatch fix as of November 17, 2026. This removes the
affected dependency; it does not rename it, patch it after installation, suppress
an advisory, or change audit thresholds. ESLint configuration and rule severities
stay unchanged. Application dependencies and runtime behavior are unchanged.

Node's native glob lacks the dot-file option these TypeScript callers require.
The adapter delegates parsing, traversal and matching to node-glob, maps only the
reviewed options, and rejects unknown options. Its ceiling is these lint callers,
not general fast-glob/tinyglobby compatibility. Regression tests guard the actual
call sites, hidden files, exclusions, project aliases, directory expansion, real
lint violations, archive integrity and absence of the vulnerable dependency.
Revisit the adapter whenever one of these three callers changes, or retire it
when upstream supplies dependency trees without the advisory.

The archive is integrity-pinned by npm and copied into the Docker dependency
stage. Regenerate with `npm pack --ignore-scripts` here, update the root lockfile,
and run `node --test scripts/next-eslint-glob.test.mjs`. The retired version 1
archive remains intact as historical evidence.
