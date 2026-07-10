#!/usr/bin/env node
// Confirms the live deployment actually matches the latest commit on main -
// this repo deploys via an explicit `vercel deploy --prod`, not
// automatically on push, so a real gap exists: work can be committed,
// pushed, tested, and reviewed, while production quietly keeps serving an
// old build for hours (this happened for real on 2026-07-10 - several
// features sat deployed-in-git-only for most of a session before anyone
// noticed). Mirrors scripts/smoke-test-chat.mjs's conventions: plain node
// script, env var URL override, process.exit(1) on failure so the
// scheduled GitHub Actions run fails loudly - no custom email alerting,
// same as that script; GitHub's own failed-scheduled-workflow notification
// is the alert.

const APP_URL = process.env.SMOKE_TEST_URL ?? "https://travel-platform-ashy.vercel.app";
const EXPECTED_COMMIT = process.env.GITHUB_SHA;

if (!EXPECTED_COMMIT) {
  console.error("GITHUB_SHA is not set - this script expects to run inside GitHub Actions.");
  process.exit(1);
}

try {
  const res = await fetch(`${APP_URL}/api/version`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    console.error(`/api/version returned HTTP ${res.status}`);
    process.exit(1);
  }

  const { commit: deployedCommit } = await res.json();

  if (!deployedCommit) {
    console.error(
      "/api/version returned no commit SHA - VERCEL_GIT_COMMIT_SHA may not be set for this deployment " +
        "(check Vercel project settings: 'Automatically expose System Environment Variables' must be enabled)."
    );
    process.exit(1);
  }

  if (deployedCommit !== EXPECTED_COMMIT) {
    console.error(
      `Production is stale: deployed commit ${deployedCommit} does not match the latest commit ${EXPECTED_COMMIT} on main.\n` +
        `Run 'vercel deploy --prod' to bring it up to date.`
    );
    process.exit(1);
  }

  console.log(`OK - production is running the latest commit (${deployedCommit}).`);
} catch (err) {
  console.error("Failed to check deploy freshness:", err instanceof Error ? err.message : err);
  process.exit(1);
}
