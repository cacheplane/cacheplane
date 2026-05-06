# pnpm Workspace Consolidation — Design Spec

**Date:** 2026-05-05
**Status:** Approved (brainstorming complete, ready for implementation plan)

## Background

Two npm packages currently live in separate repos:

- `~/repos/cacheplane-partial-json` — `@cacheplane/partial-json@0.2.0`
- `~/repos/cacheplane-partial-markdown` — `@cacheplane/partial-markdown@0.3.0`

Both share architecture (streaming-AST, push + pull APIs, identity preservation, materialize), tooling (tsup dual ESM/CJS, vitest, ESLint flat config), the `StreamStatus` tristate type (currently duplicated), and a tag-triggered OIDC publish workflow.

There are no external consumers yet — these packages are co-developed and have not been adopted outside this group of projects. Migration cost is therefore one-time and contained.

## Goals

1. One repo, one install, one CI pipeline for both packages.
2. Single source of truth for shared types (`StreamStatus`) without inflicting a new published artifact on consumers.
3. Forward-compatible layout that scales to a multi-app enterprise product (modeled on `~/repos/Intelligence`) without later restructuring.
4. Per-package independent versioning and tag-routed publishing preserved.

## Non-Goals

- Backward compatibility / consumer migration coordination (no external consumers).
- Preserving git history from old repos (fresh start; old repos archived).
- Adopting Nx, changesets, or any release-automation tooling now (deferred until justified).

## Repository Layout

GitHub: `cacheplane/cacheplane`. Local: `~/repos/cacheplane/`.

```
cacheplane/
├── package.json                # private root, pnpm@9, root scripts
├── pnpm-workspace.yaml         # packages/*, libs/*, apps/*, tools/*
├── tsconfig.base.json
├── eslint.config.js
├── .github/workflows/
│   ├── ci.yml
│   └── publish.yml
├── packages/                   # PUBLISHABLE to npm
│   ├── partial-json/           # @cacheplane/partial-json
│   └── partial-markdown/       # @cacheplane/partial-markdown
├── libs/                       # PRIVATE workspace-only code
│   └── internal-types/         # @cacheplane/internal-types (private)
├── apps/                       # reserved (.gitkeep)
├── tools/                      # reserved (.gitkeep)
├── docs/
│   ├── specs/
│   └── plans/
├── README.md
└── RELEASING.md
```

### Convention

- `packages/*` — published to npm under `@cacheplane/*`.
- `libs/*` — private workspace-only; never published.
- `apps/*` — deployable services / frontends (future).
- `tools/*` — repo-internal scripts and dev utilities (future).

This mirrors the `~/repos/Intelligence` layout so the cacheplane enterprise product can grow into the same shape without restructuring.

## Shared Types: `libs/internal-types`

`StreamStatus` is the only currently-shared type. Rather than duplicate it across packages or publish a third npm package, it lives in a private workspace package and is **inlined into each publishable package's build output** via tsup's `noExternal`.

### Package definition

`libs/internal-types/package.json`:

```json
{
  "name": "@cacheplane/internal-types",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts"
}
```

Source-only (no build step) — consumed directly by sibling packages' tsup builds.

### Consumption

Each publishable package:

- Adds `"@cacheplane/internal-types": "workspace:*"` to `devDependencies` (build-time only, not a runtime dep).
- Re-exports the type from its own entry point:

  ```ts
  // packages/partial-json/src/index.ts
  export type { StreamStatus } from '@cacheplane/internal-types';
  ```

- Adds `noExternal: ['@cacheplane/internal-types']` to `tsup.config.ts` so the type/code is inlined into `dist/`.

Consumers of `@cacheplane/partial-json` see `StreamStatus` re-exported from the package itself, with **zero transitive dependencies**.

### Risk

tsup's `.d.ts` rollup occasionally produces awkward declaration output when re-exporting types from inlined modules. Mitigation: a smoke test during implementation that builds both packages and runs `tsc --noEmit` against a tiny scratch consumer that imports `StreamStatus`. If it misbehaves, fallback options are a tsup plugin or a pre-build copy step. Not blocking.

## Build & Test Tooling

Each package keeps its own `tsup.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.build.json`, `README.md`, `CHANGELOG.md`, and `LICENSE`. Per-package autonomy preserved.

**Hoisted to root** (deleted from each package):

- `devDependencies` (tsup, vitest, eslint, typescript, @types/node, @vitest/coverage-v8, @typescript-eslint/*).
- `eslint.config.js` — root flat config applied repo-wide.

**Root `package.json` scripts:**

```json
{
  "scripts": {
    "build": "pnpm -r --filter './packages/*' build",
    "test": "pnpm -r --filter './packages/*' --filter './libs/*' test",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck"
  }
}
```

**`tsconfig.base.json`:** `strict`, `moduleResolution: "bundler"`, `target: "ES2022"`, `esModuleInterop: true`. Each package's `tsconfig.json` extends it.

## CI Workflow

`.github/workflows/ci.yml` — single job, runs on PR and push to `main`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

Single job rather than a matrix: with two packages and pnpm's parallel filter execution, matrix overhead exceeds wall-time savings. Revisit when the package count grows or apps land.

## Publish Workflow

`.github/workflows/publish.yml` — tag-pattern routed:

- Tag `partial-json-v0.2.1` → publishes only `@cacheplane/partial-json@0.2.1`.
- Tag `partial-markdown-v0.3.1` → publishes only `@cacheplane/partial-markdown@0.3.1`.

```yaml
name: Publish
on:
  push:
    tags:
      - 'partial-json-v*'
      - 'partial-markdown-v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
          registry-url: 'https://registry.npmjs.org'
      - run: pnpm install --frozen-lockfile
      - name: Resolve package from tag
        id: pkg
        run: |
          TAG="${GITHUB_REF_NAME}"
          PKG="${TAG%-v*}"
          VERSION="${TAG##*-v}"
          echo "name=$PKG" >> "$GITHUB_OUTPUT"
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          echo "dir=packages/$PKG" >> "$GITHUB_OUTPUT"
      - name: Verify version matches package.json
        run: |
          PKG_VERSION=$(node -p "require('./${{ steps.pkg.outputs.dir }}/package.json').version")
          if [ "$PKG_VERSION" != "${{ steps.pkg.outputs.version }}" ]; then
            echo "Tag version ${{ steps.pkg.outputs.version }} != package.json $PKG_VERSION"
            exit 1
          fi
      - run: pnpm --filter "@cacheplane/${{ steps.pkg.outputs.name }}" build
      - run: pnpm --filter "@cacheplane/${{ steps.pkg.outputs.name }}" publish --no-git-checks --access public --provenance
```

**Adding a new publishable package later:** add its tag prefix to `on.push.tags`. Tag → directory mapping is purely string-derived; no per-package workflow file.

**npm trusted publishing config** must be updated to point each package's publisher at `cacheplane/cacheplane` + `.github/workflows/publish.yml` before the first cutover release.

## Versioning

Independent per-package semver, manual `CHANGELOG.md` updates, manual `package.json` version bumps, manual tag creation. Adopt `changesets` only if the bookkeeping starts hurting.

Patch-cadence convention (no `0.x.0` minor bumps unless explicitly needed) is inherited from current per-repo practice.

## Migration Plan (high level)

Detailed steps go in the implementation plan. High-level sequence:

1. Create skeleton (`git init`, root configs, workspace globs, empty `apps/.gitkeep` + `tools/.gitkeep`).
2. Copy package sources from old repos (no git history). Strip per-package `devDependencies` and `eslint.config.js`. Update repository URLs.
3. Create `libs/internal-types/` with `StreamStatus`. Wire `noExternal` into both tsup configs. Replace local `StreamStatus` definitions with re-exports.
4. Write root configs (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`).
5. Write `.github/workflows/{ci,publish}.yml`.
6. Verify locally: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Smoke-test the inlined `StreamStatus` types via a scratch consumer.
7. Push to `cacheplane/cacheplane`. Confirm CI green.
8. Update npm trusted publishing config for both packages.
9. Cut verification releases (`partial-json-v0.2.1`, `partial-markdown-v0.3.1`) to confirm OIDC end-to-end.
10. Archive old repos on GitHub with one-line README pointers. Delete old local clones.

## Deferred Decisions

Called out so they aren't forgotten, but not acted on now:

- **Nx** — adopt when the first app lands, or when the package graph hits ~5 packages with non-trivial inter-deps. pnpm filters suffice today.
- **changesets** — adopt when manual changelog/version bookkeeping starts hurting. Two packages on patch cadence don't need it.
- **Promoting `@cacheplane/internal-types` to a published package** — only if a third consumer appears outside this workspace.

## Success Criteria

- One `pnpm install` at the repo root produces a working dev environment for both packages.
- `pnpm test` and `pnpm build` green at root.
- CI passes on PR.
- Tag push (`partial-json-v0.2.1`) publishes only that package via OIDC.
- Consumers of either npm package see no behavior change and no new transitive dependencies.
- A new app/lib/tool can be added by dropping a directory into the relevant glob, with no workspace config changes required.
