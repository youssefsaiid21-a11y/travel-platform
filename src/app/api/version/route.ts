import { NextResponse } from "next/server";

// Lets an external check (scripts/check-deploy-freshness.mjs, run on a
// schedule via .github/workflows/check-deploy-freshness.yml) confirm the
// live deployment actually matches the latest commit on main - this repo
// deploys via an explicit `vercel deploy --prod`, not automatically on
// push, so it's possible to push and test a change locally while
// production quietly keeps serving an old build. No auth: a commit SHA
// isn't sensitive, and this needs to be reachable from an unauthenticated
// CI check.
export async function GET() {
  return NextResponse.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  });
}
