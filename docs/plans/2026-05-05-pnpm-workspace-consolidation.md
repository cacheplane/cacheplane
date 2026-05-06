# pnpm Workspace Consolidation Implementation Plan

**Status:** Executed and shipped 2026-05-05. Repo lives at `cacheplane/cacheplane`; `@cacheplane/partial-json@0.2.1` and `@cacheplane/partial-markdown@0.3.1` published from the monorepo via OIDC trusted publishing.

**Architecture deviated from this plan in one place:** the `libs/internal-types` private workspace package was created and then dismantled because tsup's DTS rollup did not honor `noExternal` for the workspace dependency, leaking the import into consumer-facing `dist/*.d.ts`. Final approach: each package declares `StreamStatus` literally in its own `src/types.ts`, pinned by an `expectTypeOf` literal assertion in `types.test.ts`. See the spec for the rationale.

**Source of truth:** [`docs/specs/2026-05-05-pnpm-workspace-consolidation-design.md`](../specs/2026-05-05-pnpm-workspace-consolidation-design.md).

The original task-by-task plan was preserved in git history (commit `3e42d74`) for reference; reading it without this caveat would mislead future-you.
