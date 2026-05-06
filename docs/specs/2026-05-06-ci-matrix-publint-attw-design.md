# cacheplane CI hardening — per-package matrix + publint + attw + coverage

**Status:** Approved
**Date:** 2026-05-06

## Goal

Upgrade `cacheplane/.github/workflows/ci.yml` from a minimal single-job pipeline to a parallel per-package matrix with packaging health checks. Catches ESM/types regressions before they ship to npm.

## Why now

Earlier in the session we caught two real packaging bugs in `@ngaf` libraries that would have been blocked by these checks:

- a2ui ESM imports without `.js` extensions (broke any consumer's Node ESM resolution)
- Missing public exports (`extractCitations`, `bridgeCitationsState`) shipped accidentally

`publint` catches the first class of bug. `attw` (Are The Types Wrong) catches the second. Both surface mismatches between `package.json` exports/types and what's actually in `dist/`.

## Architecture

Replace the current single `verify` job with three jobs:

1. **`workspace`** — repo-wide checks that touch all packages: `pnpm install`, root `pnpm lint`, root `pnpm typecheck`. Single-pass, fail-fast for cross-package errors.

2. **`package`** matrix (parallel: partial-json, partial-markdown) — each package runs:
   - `pnpm --filter @cacheplane/<pkg> test --coverage` (vitest with V8 coverage)
   - `pnpm --filter @cacheplane/<pkg> build`
   - `pnpm --filter @cacheplane/<pkg> exec publint` (publint package check)
   - `pnpm --filter @cacheplane/<pkg> exec attw --pack` (Are The Types Wrong, packs and inspects tarball)
   - Upload coverage as artifact (per-package, retention 7 days)

3. **(optional later: `release-readiness`)** — a no-op gate job that requires both `workspace` and all `package` matrix entries to pass; useful when adding branch protection. Skipping for now to keep scope tight; the matrix itself can be the protected check.

Single workflow file: `.github/workflows/ci.yml` overwritten. Triggers stay `pull_request` + `push` to main.

## Tooling additions to root `package.json`

Dev-deps added to root:
- `publint` (latest stable)
- `@arethetypeswrong/cli` (provides `attw` binary)
- `@vitest/coverage-v8` (already used per-package — promote to root if not already, otherwise add per-package as needed)

Each package's `package.json` gets two new scripts:
- `"publint": "publint"`
- `"attw": "attw --pack ."`

This way CI invokes them via `pnpm --filter @cacheplane/<pkg> publint` and `pnpm --filter @cacheplane/<pkg> attw`.

## Pinning

- Node version: pin to `22` (LTS, matches what dawn-style projects use; current ci.yml uses `20`).
- pnpm version: pin to whatever `packageManager` field in root `package.json` declares; if absent, pin explicitly to `10` (latest major) in the workflow.
- `actions/checkout` → `v4`, `actions/setup-node` → `v4`, `pnpm/action-setup` → `v4`.

## Coverage reporting

Per-package vitest run with `--coverage` produces `coverage/` directory. Each matrix entry uploads to GitHub Actions artifacts as `coverage-<package>` with 7-day retention. No third-party reporter integration (Codecov, Coveralls) — keep dependencies minimal. Future PRs can add badges if desired.

## Failure modes

- **publint emits warnings**: treat as failure (default `--strict`). If a current package emits real warnings, fix them in this PR.
- **attw warnings**: also treat as failure. Run locally first to surface any existing issues; fix in this PR or whitelist the specific check via `--ignore-rules`.
- **Coverage thresholds**: not enforced in this PR. Adding minimums is a separate decision.

## Validation

After landing this PR, demonstrate CI works correctly by:
1. Watching the merge-to-main CI run pass.
2. Opening a tiny no-op follow-up PR (e.g. comment-only change) and watching the matrix run cleanly. Both packages' jobs should run in parallel and report independently.
3. Confirming CI runs are visible in `gh run list --workflow ci.yml`.

## Out of scope

- Branch protection rules (admin task on GitHub, not workflow change).
- Coverage thresholds.
- Codecov / Coveralls integration.
- Cross-Node-version matrix (Node 20 + 22). Single Node 22 keeps CI fast.
- e2e or integration tests against published packages (separate concern; the publish workflow already gates publish).

**CI verified working on 2026-05-06**
