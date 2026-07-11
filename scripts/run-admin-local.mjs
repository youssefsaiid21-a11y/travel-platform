#!/usr/bin/env node
// Runs a dedicated local `next dev` instance for the /admin dashboard,
// pointed at a real database (typically production, read via its
// DATABASE_URL) instead of local dev/seed data. The admin dashboard is
// deliberately NOT part of the deployed site (see src/proxy.ts's
// isAdminLocalMode gate, which 404s everything except /admin on this
// instance, and 404s /admin entirely when VERCEL=1) - this is the only way
// to reach it. No login is required locally; requireAdmin() in
// src/lib/adminAuth.ts short-circuits when ADMIN_LOCAL_MODE=1.

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.admin.local");

if (!existsSync(envPath)) {
  console.error(
    `Missing ${envPath}.\n\n` +
      "Create it with your database connection string, e.g.:\n" +
      "  DATABASE_URL=\"postgres://...\"\n\n" +
      "For production data, copy the value from the Vercel dashboard:\n" +
      "  Project -> Settings -> Environment Variables -> production -> DATABASE_URL\n" +
      "(marked 'Sensitive', so it must be copied by hand - the CLI can't pull it).\n" +
      "This file is gitignored (matches the .env* pattern) and never leaves your machine."
  );
  process.exit(1);
}

const envVars = {};
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  envVars[key] = value;
}

if (!envVars.DATABASE_URL) {
  console.error(`${envPath} is missing DATABASE_URL.`);
  process.exit(1);
}

const port = process.env.ADMIN_LOCAL_PORT ?? "3001";

console.log(`Starting local admin dashboard on http://localhost:${port}/admin ...`);

const child = spawn("npx", ["next", "dev", "-p", port], {
  stdio: "inherit",
  env: {
    ...process.env,
    ...envVars,
    ADMIN_LOCAL_MODE: "1",
  },
});

child.on("exit", (code) => process.exit(code ?? 0));
