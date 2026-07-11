#!/usr/bin/env node
// Seeds one fixed test account for the Product Agent to use when walking
// account-gated flows (account/profile, tracked searches) against local dev
// pointed at the Neon `dev` branch. This is the diagnostic-only Product
// Agent's ONE sanctioned DB write - run it as part of the
// environment-precondition step, before the walkthrough starts, never
// during it.
//
// Usage (against the `dev` branch already wired into .env.local):
//   PRODUCT_AGENT_TEST_PASSWORD=... node scripts/seed-product-agent-account.mjs
//
// DATABASE_URL is read from the environment if already set; otherwise it is
// loaded from .env.local. dotenv does NOT override an already-set value, so
// passing `DATABASE_URL=... node scripts/seed-product-agent-account.mjs` on
// the command line still wins - the negative test (pointing at the prod
// host to confirm the guard refuses) relies on exactly that.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Fill DATABASE_URL (and anything else) from .env.local only when it isn't
// already set in the environment - dotenv is non-overriding by default.
dotenv.config({ path: path.join(repoRoot, ".env.local") });

// The ONE known-bad value. A Neon branch host is shape-identical to the
// production host, so a pattern can't distinguish them - only an exact
// match on this specific known-production host can. Hard stop, not a
// warning, if the connected DB is production.
const PROD_DB_HOST =
  "ep-curly-king-asy41yg2-pooler.c-4.eu-central-1.aws.neon.tech";

const TEST_EMAIL = "product-agent-test@orbi.local";
const TEST_NAME = "Product Agent Test";
// Cost factor 12 - matches the real hashing in src/app/api/auth/register/route.ts,
// so authorizeCredentials.ts's bcrypt.compare verifies against it identically.
const BCRYPT_COST = 12;

function fail(message) {
  console.error(`\n[seed-product-agent-account] REFUSED: ${message}\n`);
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  fail(
    "DATABASE_URL is not set (neither in the environment nor .env.local). " +
      "Point it at the Neon `dev` branch and retry."
  );
}

let host;
try {
  host = new URL(dbUrl).hostname;
} catch {
  fail("DATABASE_URL is not a parseable URL - cannot verify the DB host.");
}

if (host === PROD_DB_HOST) {
  fail(
    `connected DB host is the known PRODUCTION host (${PROD_DB_HOST}). ` +
      "This script only ever runs against the `dev` branch or local dev. " +
      "Nothing was written."
  );
}

const password = process.env.PRODUCT_AGENT_TEST_PASSWORD;
if (!password) {
  fail(
    "PRODUCT_AGENT_TEST_PASSWORD is not set. It is never hardcoded or " +
      "committed - set it in the environment (or .env.local) and retry."
  );
}

const db = new PrismaClient();

try {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  // Idempotent existence: one fixed account, upserted every run.
  const user = await db.user.upsert({
    where: { email: TEST_EMAIL },
    update: { passwordHash, name: TEST_NAME },
    create: { email: TEST_EMAIL, passwordHash, name: TEST_NAME },
  });

  // Idempotent STATE, not just idempotent existence: reset this one account
  // back to a known baseline every run so state doesn't accumulate across
  // dozens of runs and start producing self-inflicted "this page is
  // cluttered" findings. Scoped by an exact userId match to this account -
  // never a broad or unscoped delete.
  const deletedTracked = await db.trackedSearch.deleteMany({
    where: { userId: user.id },
  });
  const deletedBookings = await db.booking.deleteMany({
    where: { userId: user.id },
  });

  console.log("[seed-product-agent-account] OK");
  console.log(`  DB host:          ${host}`);
  console.log(`  account:          ${TEST_EMAIL}`);
  console.log(`  userId:           ${user.id}`);
  console.log(`  TrackedSearch reset: ${deletedTracked.count} row(s) deleted`);
  console.log(`  Booking reset:       ${deletedBookings.count} row(s) deleted`);
} finally {
  await db.$disconnect();
}
