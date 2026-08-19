#!/usr/bin/env node

process.argv.push("--plan");
await import("./apply-database-migrations.mjs");
