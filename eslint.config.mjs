import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-admin/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    // .claude/worktrees/ holds background-agent git worktrees (full repo
    // checkouts, each with its own .next/**) - the patterns above only
    // match at repo root, not nested under here, so a running agent's
    // worktree pollutes any lint run from the main checkout with its own
    // build output (found 2026-07-15 while verifying PR #10).
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
