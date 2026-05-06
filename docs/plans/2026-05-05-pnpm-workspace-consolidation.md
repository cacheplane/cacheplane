# pnpm Workspace Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate `@cacheplane/partial-json` and `@cacheplane/partial-markdown` into a single pnpm workspace monorepo at `~/repos/cacheplane/` (GitHub `cacheplane/cacheplane`), with shared `StreamStatus` inlined from a private workspace lib, tag-routed per-package npm publish, and a forward-compatible layout (`packages/`, `libs/`, `apps/`, `tools/`) modeled on `~/repos/Intelligence`.

**Architecture:** pnpm workspaces, no Nx. Each publishable package keeps its own tsup/vitest/tsconfig and `package.json`. Shared types live in `libs/internal-types/` (private, source-only) and are inlined into each package's `dist/` via `tsup`'s `noExternal`. Independent per-package versioning; tag patterns `partial-json-v*` / `partial-markdown-v*` route to a single tag-derived publish workflow with OIDC trusted publishing.

**Tech Stack:** pnpm@9, Node 20, TypeScript 5.6, tsup 8, vitest 3, ESLint 9 (flat config), GitHub Actions.

**Source repos for migration:**
- `~/repos/cacheplane-partial-json` (`@cacheplane/partial-json@0.2.0`)
- `~/repos/cacheplane-partial-markdown` (`@cacheplane/partial-markdown@0.3.0`)

**Target:** `~/repos/cacheplane/` (already exists, git-init'd, contains `docs/specs/` + `docs/plans/` and the spec commit).

**Spec:** `docs/specs/2026-05-05-pnpm-workspace-consolidation-design.md`

---

## File Structure (final state after plan)

```
~/repos/cacheplane/
├── .github/workflows/ci.yml
├── .github/workflows/publish.yml
├── .gitignore
├── README.md
├── RELEASING.md
├── package.json                                    # private root, pnpm@9
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js
├── apps/.gitkeep
├── tools/.gitkeep
├── libs/internal-types/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/index.ts                                # exports StreamStatus
├── packages/partial-json/
│   ├── package.json                                # devDeps stripped, repo URL updated, internal-types devDep added
│   ├── tsconfig.json
│   ├── tsconfig.build.json
│   ├── tsup.config.ts                              # noExternal: ['@cacheplane/internal-types']
│   ├── vitest.config.ts
│   ├── README.md
│   ├── CHANGELOG.md
│   ├── LICENSE
│   └── src/                                        # copied from old repo, types.ts re-exports StreamStatus
├── packages/partial-markdown/
│   ├── (same shape as partial-json)
│   └── src/
└── docs/
    ├── specs/2026-05-05-pnpm-workspace-consolidation-design.md   # already committed
    └── plans/2026-05-05-pnpm-workspace-consolidation.md          # this file
```

Each task below produces a self-contained, committable change. Tasks are intended to be executed in order; later tasks depend on earlier ones.

---

### Task 1: Root scaffolding (workspace, configs, scripts)

**Files:**
- Create: `~/repos/cacheplane/.gitignore`
- Create: `~/repos/cacheplane/package.json`
- Create: `~/repos/cacheplane/pnpm-workspace.yaml`
- Create: `~/repos/cacheplane/tsconfig.base.json`
- Create: `~/repos/cacheplane/eslint.config.js`
- Create: `~/repos/cacheplane/README.md`
- Create: `~/repos/cacheplane/RELEASING.md`
- Create: `~/repos/cacheplane/apps/.gitkeep` (empty file)
- Create: `~/repos/cacheplane/tools/.gitkeep` (empty file)

- [ ] **Step 1: Write `.gitignore`**

```gitignore
node_modules/
dist/
coverage/
.DS_Store
*.log
.env
.env.local
.idea/
.vscode/
*.tsbuildinfo
```

- [ ] **Step 2: Write root `package.json`**

```json
{
  "name": "@cacheplane/source",
  "version": "0.0.0",
  "private": true,
  "description": "Cacheplane monorepo: streaming parsers and shared infrastructure.",
  "license": "MIT",
  "packageManager": "pnpm@9.15.9",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "pnpm -r --filter './packages/*' build",
    "test": "pnpm -r --filter './packages/*' test",
    "test:coverage": "pnpm -r --filter './packages/*' test:coverage",
    "lint": "eslint .",
    "typecheck": "pnpm -r typecheck",
    "verify": "pnpm lint && pnpm typecheck && pnpm test && pnpm build"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "eslint": "^9.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
  - 'libs/*'
  - 'apps/*'
  - 'tools/*'
```

- [ ] **Step 4: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "exactOptionalPropertyTypes": false,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 5: Write root `eslint.config.js`**

```js
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  {
    files: ['**/src/**/*.ts'],
    languageOptions: { parser: tsparser },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'warn',
    },
  },
];
```

- [ ] **Step 6: Write `README.md`**

```markdown
# Cacheplane

Monorepo for cacheplane streaming parsers and supporting infrastructure.

## Packages

- [`@cacheplane/partial-json`](packages/partial-json) — streaming partial-JSON parser
- [`@cacheplane/partial-markdown`](packages/partial-markdown) — streaming partial-Markdown parser

## Layout

- `packages/*` — published to npm under `@cacheplane/*`
- `libs/*` — private workspace-only code (never published)
- `apps/*` — deployable services / frontends (reserved)
- `tools/*` — repo-internal scripts (reserved)

## Development

```bash
pnpm install
pnpm verify   # lint + typecheck + test + build
```

## Releasing

See [RELEASING.md](RELEASING.md).
```

- [ ] **Step 7: Write `RELEASING.md`**

```markdown
# Releasing

Each package is versioned and released independently.

## Steps

1. Bump the version in the package's `package.json` (e.g. `packages/partial-json/package.json`).
2. Update the package's `CHANGELOG.md`.
3. Commit on `main`: `chore(release): partial-json 0.2.1`.
4. Tag with the package-prefixed pattern:
   - `git tag partial-json-v0.2.1`
   - `git tag partial-markdown-v0.3.1`
5. Push the tag: `git push origin partial-json-v0.2.1`.
6. The `Publish` workflow runs automatically and publishes via npm OIDC trusted publishing.

## Tag → package mapping

The publish workflow derives the package directory and version directly from the tag name:

- `partial-json-v0.2.1` → publishes `packages/partial-json` at version `0.2.1`
- `partial-markdown-v0.3.1` → publishes `packages/partial-markdown` at version `0.3.1`

The workflow verifies that the tag version matches `package.json` before publishing.

## Adding a new publishable package

Add the new tag prefix to `.github/workflows/publish.yml` `on.push.tags`.
```

- [ ] **Step 8: Create empty placeholder files**

```bash
mkdir -p ~/repos/cacheplane/apps ~/repos/cacheplane/tools
touch ~/repos/cacheplane/apps/.gitkeep ~/repos/cacheplane/tools/.gitkeep
```

- [ ] **Step 9: Verify structure**

Run: `ls -la ~/repos/cacheplane/`
Expected: shows `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `README.md`, `RELEASING.md`, `apps/`, `tools/`, `docs/`, `.git/`.

- [ ] **Step 10: Commit**

```bash
cd ~/repos/cacheplane
git add -A
git commit -m "chore: scaffold pnpm workspace root"
```

---

### Task 2: Create `libs/internal-types` private package

**Files:**
- Create: `~/repos/cacheplane/libs/internal-types/package.json`
- Create: `~/repos/cacheplane/libs/internal-types/tsconfig.json`
- Create: `~/repos/cacheplane/libs/internal-types/src/index.ts`

- [ ] **Step 1: Write `libs/internal-types/package.json`**

```json
{
  "name": "@cacheplane/internal-types",
  "version": "0.0.0",
  "private": true,
  "description": "Private workspace-only types shared by @cacheplane/* packages. Inlined at build time; never published.",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Write `libs/internal-types/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `libs/internal-types/src/index.ts`**

```ts
/**
 * StreamStatus — tristate streaming state shared across @cacheplane/* parsers.
 *
 * - `pending`  : parser created, no input consumed yet.
 * - `streaming`: input has been consumed; more may arrive.
 * - `complete` : end-of-input signaled; no further state changes.
 */
export type StreamStatus = 'pending' | 'streaming' | 'complete';
```

- [ ] **Step 4: Commit**

```bash
cd ~/repos/cacheplane
git add libs/internal-types
git commit -m "feat(internal-types): add private workspace lib for shared StreamStatus"
```

---

### Task 3: Migrate `@cacheplane/partial-json` source

**Files:**
- Copy from `~/repos/cacheplane-partial-json/` into `~/repos/cacheplane/packages/partial-json/`:
  - `src/`
  - `tsup.config.ts`
  - `vitest.config.ts`
  - `tsconfig.json`
  - `tsconfig.build.json`
  - `README.md`
  - `CHANGELOG.md`
  - `LICENSE`
  - `package.json`
- Modify: `~/repos/cacheplane/packages/partial-json/package.json`
- Modify: `~/repos/cacheplane/packages/partial-json/tsconfig.json`
- Modify: `~/repos/cacheplane/packages/partial-json/tsup.config.ts`
- Modify: `~/repos/cacheplane/packages/partial-json/src/types.ts`
- Delete: `~/repos/cacheplane-partial-json/eslint.config.js` is NOT copied.

- [ ] **Step 1: Copy source tree**

```bash
mkdir -p ~/repos/cacheplane/packages/partial-json
cd ~/repos/cacheplane-partial-json
cp -R src ~/repos/cacheplane/packages/partial-json/
cp tsup.config.ts vitest.config.ts tsconfig.json tsconfig.build.json README.md CHANGELOG.md LICENSE package.json ~/repos/cacheplane/packages/partial-json/
```

- [ ] **Step 2: Rewrite `packages/partial-json/package.json`**

Replace the entire file with:

```json
{
  "name": "@cacheplane/partial-json",
  "version": "0.2.0",
  "description": "Streaming partial-JSON parser with identity preservation, push/pull APIs, JSON Pointer lookups, and structural-sharing materialization.",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.mjs" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    },
    "./package.json": "./package.json"
  },
  "sideEffects": false,
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@cacheplane/internal-types": "workspace:*"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/cacheplane/cacheplane.git",
    "directory": "packages/partial-json"
  },
  "homepage": "https://github.com/cacheplane/cacheplane/tree/main/packages/partial-json#readme",
  "bugs": "https://github.com/cacheplane/cacheplane/issues",
  "keywords": ["json", "stream", "partial", "parser", "incremental", "llm"],
  "publishConfig": { "access": "public", "provenance": true },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 3: Update `packages/partial-json/tsconfig.json` to extend the base**

Replace the entire file with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/__tests__/**", "**/*.test.ts"]
}
```

- [ ] **Step 4: Update `packages/partial-json/tsup.config.ts` to inline internal-types**

Replace the entire file with:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  outDir: 'dist',
  noExternal: ['@cacheplane/internal-types'],
  outExtension({ format }) {
    return format === 'esm' ? { js: '.mjs' } : { js: '.cjs' };
  },
});
```

- [ ] **Step 5: Replace local `StreamStatus` declaration with re-export**

Open `packages/partial-json/src/types.ts`. Find this line (around line 128):

```ts
export type StreamStatus = 'pending' | 'streaming' | 'complete';
```

Replace it with:

```ts
export type { StreamStatus } from '@cacheplane/internal-types';
```

- [ ] **Step 6: Verify the package's own `eslint.config.js` was not copied**

Run: `ls ~/repos/cacheplane/packages/partial-json/eslint.config.js 2>&1 || echo "absent (correct)"`
Expected: `absent (correct)` (Step 1 didn't copy it).

- [ ] **Step 7: Commit**

```bash
cd ~/repos/cacheplane
git add packages/partial-json
git commit -m "feat(partial-json): migrate package into monorepo, re-export StreamStatus from internal-types"
```

---

### Task 4: Migrate `@cacheplane/partial-markdown` source

**Files:**
- Copy from `~/repos/cacheplane-partial-markdown/` into `~/repos/cacheplane/packages/partial-markdown/`:
  - `src/`
  - `tsup.config.ts`
  - `vitest.config.ts`
  - `tsconfig.json`
  - `tsconfig.build.json`
  - `README.md`
  - `CHANGELOG.md`
  - `LICENSE`
  - `package.json`
- Modify: `~/repos/cacheplane/packages/partial-markdown/package.json`
- Modify: `~/repos/cacheplane/packages/partial-markdown/tsconfig.json`
- Modify: `~/repos/cacheplane/packages/partial-markdown/tsup.config.ts`
- Modify: `~/repos/cacheplane/packages/partial-markdown/src/types.ts`

- [ ] **Step 1: Copy source tree**

```bash
mkdir -p ~/repos/cacheplane/packages/partial-markdown
cd ~/repos/cacheplane-partial-markdown
cp -R src ~/repos/cacheplane/packages/partial-markdown/
cp tsup.config.ts vitest.config.ts tsconfig.json tsconfig.build.json README.md CHANGELOG.md LICENSE package.json ~/repos/cacheplane/packages/partial-markdown/
```

- [ ] **Step 2: Rewrite `packages/partial-markdown/package.json`**

Replace the entire file with:

```json
{
  "name": "@cacheplane/partial-markdown",
  "version": "0.3.0",
  "description": "Streaming partial-Markdown parser with identity preservation, push/pull APIs, JSON Pointer lookups, and structural-sharing materialization.",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.mjs" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    },
    "./package.json": "./package.json"
  },
  "sideEffects": false,
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@cacheplane/internal-types": "workspace:*"
  },
  "keywords": ["markdown", "streaming", "parser", "ast", "incremental", "partial", "llm"],
  "author": "Cacheplane",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/cacheplane/cacheplane.git",
    "directory": "packages/partial-markdown"
  },
  "homepage": "https://github.com/cacheplane/cacheplane/tree/main/packages/partial-markdown#readme",
  "bugs": "https://github.com/cacheplane/cacheplane/issues",
  "publishConfig": { "access": "public", "provenance": true },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 3: Update `packages/partial-markdown/tsconfig.json` to extend the base**

Replace the entire file with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/__tests__/**", "**/*.test.ts"]
}
```

- [ ] **Step 4: Update `packages/partial-markdown/tsup.config.ts` to inline internal-types**

Replace the entire file with:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  outDir: 'dist',
  noExternal: ['@cacheplane/internal-types'],
  outExtension({ format }) {
    return format === 'esm' ? { js: '.mjs' } : { js: '.cjs' };
  },
});
```

- [ ] **Step 5: Replace local `StreamStatus` declaration with re-export**

Open `packages/partial-markdown/src/types.ts`. Find this line (around line 18):

```ts
export type StreamStatus = 'pending' | 'streaming' | 'complete';
```

Replace it with:

```ts
export type { StreamStatus } from '@cacheplane/internal-types';
```

- [ ] **Step 6: Verify no per-package `eslint.config.js` was copied**

Run: `ls ~/repos/cacheplane/packages/partial-markdown/eslint.config.js 2>&1 || echo "absent (correct)"`
Expected: `absent (correct)`.

- [ ] **Step 7: Commit**

```bash
cd ~/repos/cacheplane
git add packages/partial-markdown
git commit -m "feat(partial-markdown): migrate package into monorepo, re-export StreamStatus from internal-types"
```

---

### Task 5: Install dependencies and run full local verification

**Files:** none modified; this task validates Tasks 1–4.

- [ ] **Step 1: Install workspace dependencies**

```bash
cd ~/repos/cacheplane
pnpm install
```

Expected: completes without errors. `pnpm-lock.yaml` is created. Both packages link `@cacheplane/internal-types` from the workspace.

- [ ] **Step 2: Run lint**

Run: `cd ~/repos/cacheplane && pnpm lint`
Expected: PASS (no errors). Warnings about `no-explicit-any` or `no-console` from existing source code are acceptable.

- [ ] **Step 3: Run typecheck**

Run: `cd ~/repos/cacheplane && pnpm typecheck`
Expected: PASS for all packages. The `StreamStatus` re-exports from `@cacheplane/internal-types` should resolve cleanly.

If typecheck fails on `internal-types` resolution: confirm `libs/internal-types/package.json` has `"exports": { ".": "./src/index.ts" }` and the consuming package has `"@cacheplane/internal-types": "workspace:*"` in `devDependencies`.

- [ ] **Step 4: Run tests**

Run: `cd ~/repos/cacheplane && pnpm test`
Expected: PASS for both packages. The existing `types.test.ts` in `partial-markdown` (which type-asserts `StreamStatus` is `'pending' | 'streaming' | 'complete'`) confirms the re-export preserves the type.

- [ ] **Step 5: Run build**

Run: `cd ~/repos/cacheplane && pnpm build`
Expected: PASS. `dist/` is produced for both packages with `.mjs`, `.cjs`, `.d.ts`, `.d.cts`.

- [ ] **Step 6: Verify `StreamStatus` is inlined in built output**

Run:
```bash
grep -l "StreamStatus" ~/repos/cacheplane/packages/partial-json/dist/index.d.ts ~/repos/cacheplane/packages/partial-markdown/dist/index.d.ts
grep -l "@cacheplane/internal-types" ~/repos/cacheplane/packages/*/dist/*.d.ts ~/repos/cacheplane/packages/*/dist/*.d.cts 2>&1 || echo "no internal-types references in dist (correct)"
```
Expected: `StreamStatus` is present in each package's `index.d.ts`. There are no references to `@cacheplane/internal-types` in any `dist/` file (it has been inlined).

If `dist/` contains references to `@cacheplane/internal-types`: tsup `noExternal` did not inline the declaration. Fallback: add a `tsup` plugin or pre-build copy step. Investigate before proceeding.

- [ ] **Step 7: Commit lockfile**

```bash
cd ~/repos/cacheplane
git add pnpm-lock.yaml
git commit -m "chore: add pnpm-lock.yaml from initial install"
```

---

### Task 6: Smoke-test the inlined `StreamStatus` from a scratch consumer

**Files:**
- Create (temporary): `/tmp/cacheplane-smoke/package.json`
- Create (temporary): `/tmp/cacheplane-smoke/tsconfig.json`
- Create (temporary): `/tmp/cacheplane-smoke/index.ts`

**Goal:** Verify a consumer outside the workspace can import `StreamStatus` from each package without needing `@cacheplane/internal-types` installed.

- [ ] **Step 1: Pack both packages from the workspace**

```bash
cd ~/repos/cacheplane/packages/partial-json && pnpm pack --pack-destination /tmp/cacheplane-smoke
cd ~/repos/cacheplane/packages/partial-markdown && pnpm pack --pack-destination /tmp/cacheplane-smoke
ls /tmp/cacheplane-smoke
```
Expected: `cacheplane-partial-json-0.2.0.tgz` and `cacheplane-partial-markdown-0.3.0.tgz` exist.

- [ ] **Step 2: Set up a scratch consumer**

```bash
mkdir -p /tmp/cacheplane-smoke
cd /tmp/cacheplane-smoke
cat > package.json <<'EOF'
{
  "name": "smoke",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@cacheplane/partial-json": "file:./cacheplane-partial-json-0.2.0.tgz",
    "@cacheplane/partial-markdown": "file:./cacheplane-partial-markdown-0.3.0.tgz"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
EOF

cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": false
  },
  "include": ["index.ts"]
}
EOF

cat > index.ts <<'EOF'
import type { StreamStatus as JsonStatus } from '@cacheplane/partial-json';
import type { StreamStatus as MdStatus } from '@cacheplane/partial-markdown';

const j: JsonStatus = 'streaming';
const m: MdStatus = 'complete';

// Compile-time assertions: tristate.
type AssertJsonTristate = JsonStatus extends 'pending' | 'streaming' | 'complete' ? true : never;
type AssertMdTristate = MdStatus extends 'pending' | 'streaming' | 'complete' ? true : never;
const _aj: AssertJsonTristate = true;
const _am: AssertMdTristate = true;

console.log(j, m, _aj, _am);
EOF

npm install --no-audit --no-fund
```
Expected: install succeeds. Note `@cacheplane/internal-types` is NOT installed (verify with `ls node_modules/@cacheplane`: only `partial-json` and `partial-markdown`).

- [ ] **Step 3: Typecheck the scratch consumer**

Run: `cd /tmp/cacheplane-smoke && npx tsc --noEmit`
Expected: PASS with no diagnostics. If tsc complains it cannot find `@cacheplane/internal-types`, the `noExternal` did not inline declarations and Task 5 Step 6 should have caught it.

- [ ] **Step 4: Confirm runtime resolution (ESM)**

Run:
```bash
cd /tmp/cacheplane-smoke
node --input-type=module -e "import('@cacheplane/partial-json').then(m => console.log('json keys:', Object.keys(m).slice(0,5)));"
node --input-type=module -e "import('@cacheplane/partial-markdown').then(m => console.log('md keys:', Object.keys(m).slice(0,5)));"
```
Expected: both print key arrays without errors.

- [ ] **Step 5: Cleanup scratch directory**

```bash
rm -rf /tmp/cacheplane-smoke
```

This task does not produce a commit; it is a verification gate.

---

### Task 7: GitHub Actions CI workflow

**Files:**
- Create: `~/repos/cacheplane/.github/workflows/ci.yml`

- [ ] **Step 1: Write `ci.yml`**

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
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - run: pnpm lint

      - run: pnpm typecheck

      - run: pnpm test

      - run: pnpm build
```

- [ ] **Step 2: Commit**

```bash
cd ~/repos/cacheplane
git add .github/workflows/ci.yml
git commit -m "ci: add CI workflow (lint, typecheck, test, build)"
```

---

### Task 8: GitHub Actions publish workflow (tag-routed, OIDC)

**Files:**
- Create: `~/repos/cacheplane/.github/workflows/publish.yml`

- [ ] **Step 1: Write `publish.yml`**

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
        with:
          version: 9

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
          # tag format: <pkg>-v<version>, e.g. partial-json-v0.2.1
          PKG="${TAG%-v*}"
          VERSION="${TAG##*-v}"
          echo "name=$PKG" >> "$GITHUB_OUTPUT"
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          echo "dir=packages/$PKG" >> "$GITHUB_OUTPUT"
          echo "Resolved tag $TAG -> dir=packages/$PKG version=$VERSION"

      - name: Verify version matches package.json
        run: |
          PKG_VERSION=$(node -p "require('./${{ steps.pkg.outputs.dir }}/package.json').version")
          if [ "$PKG_VERSION" != "${{ steps.pkg.outputs.version }}" ]; then
            echo "Tag version ${{ steps.pkg.outputs.version }} does not match package.json $PKG_VERSION"
            exit 1
          fi

      - name: Build target package
        run: pnpm --filter "@cacheplane/${{ steps.pkg.outputs.name }}" build

      - name: Publish to npm with OIDC provenance
        run: pnpm --filter "@cacheplane/${{ steps.pkg.outputs.name }}" publish --no-git-checks --access public --provenance
```

- [ ] **Step 2: Commit**

```bash
cd ~/repos/cacheplane
git add .github/workflows/publish.yml
git commit -m "ci(publish): add tag-routed publish workflow with OIDC trusted publishing"
```

---

### Task 9: Push to GitHub

**Files:** none modified locally; this task creates the GitHub repo and pushes.

**Prerequisite:** `gh` CLI authenticated as the cacheplane org owner (or appropriate permissions).

- [ ] **Step 1: Confirm clean working tree**

Run: `cd ~/repos/cacheplane && git status`
Expected: `nothing to commit, working tree clean`.

- [ ] **Step 2: Create the GitHub repo**

Run:
```bash
gh repo create cacheplane/cacheplane --public \
  --description "Cacheplane monorepo: streaming parsers and supporting infrastructure" \
  --source ~/repos/cacheplane \
  --remote origin \
  --push
```
Expected: repo created at `https://github.com/cacheplane/cacheplane`, `main` pushed, remote `origin` configured.

If `gh` fails with auth or org permission errors: stop and surface the error. Do not fall back to creating the repo under a different owner.

- [ ] **Step 3: Confirm CI green**

Run:
```bash
gh run watch --repo cacheplane/cacheplane
```
Or: visit `https://github.com/cacheplane/cacheplane/actions` and wait for the `CI` workflow on the initial push to complete.
Expected: CI run for the initial push to `main` finishes with status SUCCESS.

If CI fails: do not proceed. Fix the failure in a new commit, push, and re-watch.

This task does not produce a commit (the push itself is the deliverable).

---

### Task 10: Configure npm trusted publishing for both packages

**Files:** none in this repo; this is configuration on npmjs.com.

**Goal:** Update each package's npm trusted-publishing settings to point at the new repo + workflow path so OIDC tokens are accepted.

- [ ] **Step 1: Update `@cacheplane/partial-json` trusted publisher**

Manual step on npmjs.com:
1. Go to `https://www.npmjs.com/package/@cacheplane/partial-json/access`.
2. Under "Trusted Publisher" / "GitHub Actions", set:
   - Organization or user: `cacheplane`
   - Repository: `cacheplane`
   - Workflow filename: `publish.yml`
   - Environment: (leave blank)
3. Save.

- [ ] **Step 2: Update `@cacheplane/partial-markdown` trusted publisher**

Same process, on `https://www.npmjs.com/package/@cacheplane/partial-markdown/access`.

- [ ] **Step 3: Cut a verification release for `@cacheplane/partial-json`**

```bash
cd ~/repos/cacheplane

# Bump version
node -e "
  const fs=require('fs');
  const p=require('./packages/partial-json/package.json');
  p.version='0.2.1';
  fs.writeFileSync('./packages/partial-json/package.json', JSON.stringify(p,null,2)+'\n');
"

# Update CHANGELOG manually if desired
# (skip for this verification release; revisit during normal release)

git add packages/partial-json/package.json
git commit -m "chore(release): partial-json 0.2.1 (verify monorepo publish)"
git tag partial-json-v0.2.1
git push origin main
git push origin partial-json-v0.2.1
```

Watch the publish run:
```bash
gh run watch --repo cacheplane/cacheplane
```
Expected: `Publish` workflow runs, resolves to `packages/partial-json` at version `0.2.1`, builds, and publishes successfully via OIDC.

Verify on npm: `npm view @cacheplane/partial-json version` returns `0.2.1`.

If publish fails on OIDC: re-check Step 1 settings on npmjs.com. The repo, workflow filename, and (empty) environment must match exactly.

- [ ] **Step 4: Cut a verification release for `@cacheplane/partial-markdown`**

Same as Step 3 but bump `partial-markdown` to `0.3.1` and tag `partial-markdown-v0.3.1`.

- [ ] **Step 5: Confirm both releases visible on npm**

Run:
```bash
npm view @cacheplane/partial-json version
npm view @cacheplane/partial-markdown version
```
Expected: `0.2.1` and `0.3.1` respectively.

This task does not produce a local commit beyond Steps 3–4.

---

### Task 11: Archive old repos

**Files:** none locally; GitHub UI / API operations on the old repos.

- [ ] **Step 1: Update `cacheplane/partial-json` README to point to new repo**

```bash
cd ~/repos/cacheplane-partial-json
cat > README.md <<'EOF'
# @cacheplane/partial-json

This package has moved.

The source now lives in the cacheplane monorepo: **https://github.com/cacheplane/cacheplane**

The npm package `@cacheplane/partial-json` continues to be published from there.
EOF
git add README.md
git commit -m "docs: redirect to cacheplane/cacheplane monorepo"
git push origin main
```

- [ ] **Step 2: Update `cacheplane/cacheplane-partial-markdown` README similarly**

```bash
cd ~/repos/cacheplane-partial-markdown
cat > README.md <<'EOF'
# @cacheplane/partial-markdown

This package has moved.

The source now lives in the cacheplane monorepo: **https://github.com/cacheplane/cacheplane**

The npm package `@cacheplane/partial-markdown` continues to be published from there.
EOF
git add README.md
git commit -m "docs: redirect to cacheplane/cacheplane monorepo"
git push origin main
```

- [ ] **Step 3: Archive both repos on GitHub**

```bash
gh repo archive cacheplane/partial-json --yes
gh repo archive cacheplane/cacheplane-partial-markdown --yes
```
Expected: both repos marked archived (read-only).

- [ ] **Step 4: Remove old local clones (only after confirming new repo is healthy)**

**Confirm first:**
- New repo CI is green.
- npm shows `0.2.1` and `0.3.1` published.
- Old repos are archived on GitHub.

Then:
```bash
rm -rf ~/repos/cacheplane-partial-json ~/repos/cacheplane-partial-markdown
```

---

## Self-review notes

- **Spec coverage:** Each spec section has at least one task — workspace layout (1), shared types (2), per-package migration (3, 4), build/test verification (5), inlined-types smoke test (6), CI (7), publish (8), GitHub setup (9), npm trusted publishing (10), old repo archival (11).
- **Type consistency:** `StreamStatus` is consistently `'pending' | 'streaming' | 'complete'` across the spec, the `internal-types` source, the re-exports, and the smoke test type assertions.
- **No placeholders:** every step has explicit commands, file contents, or expected output.
- **Out of scope (explicitly):** Nx adoption, changesets adoption, promoting `internal-types` to a published package. These are documented in the spec under "Deferred Decisions" and are not addressed by any task.
