#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const reportPath = path.join(process.cwd(), "outputs", "database-assurance", "latest.md");
if (!existsSync(reportPath)) {
  console.error("No database assurance report exists. Run `npm run database:assurance` first.");
  process.exit(1);
}

process.stdout.write(readFileSync(reportPath, "utf8"));
