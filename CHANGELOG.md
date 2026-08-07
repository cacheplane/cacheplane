# Changelog

Monorepo-level changes (CI, release tooling, workspace structure). Per-package release notes live in each package's own CHANGELOG:

- [`packages/json-stream/CHANGELOG.md`](packages/json-stream/CHANGELOG.md)
- [`packages/partial-json/CHANGELOG.md`](packages/partial-json/CHANGELOG.md)
- [`packages/partial-markdown/CHANGELOG.md`](packages/partial-markdown/CHANGELOG.md)

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).

## 2026-08-07

### Added

- Migrated `@cacheplane/json-stream` from `cacheplane/pretable`, where it had been source-resident despite carrying the `@cacheplane` scope. History preserved via `git subtree split`, so `git blame` still reaches the original commits. Package configs (`tsup`, `vitest`, `tsconfig`) replaced with the workspace-standard versions; `README.md` and `LICENSE` added to match its siblings.
- `json-stream-v*` added to the publish workflow's tag routing, and `json-stream` to the CI package matrix.

### Notes

- Releases up to `0.0.3` were cut from `cacheplane/pretable` by changesets. `0.0.4` onward is released from here via the tag-routed workflow, and is the first `json-stream` release to carry a provenance attestation.

## 2026-05-07

### Changed

- Publish workflow now runs on Node 24 (native npm 11.x). Removed the explicit `npm install -g npm@latest` step that earlier Node versions required for OIDC trusted publishing.

## 2026-05-06

### Added

- **CI rebuilt as a workspace job + per-package matrix.** Workspace job runs `install / lint / typecheck`. Matrix runs `test` (with coverage), `build`, `publint`, and `attw` per package, uploading coverage artifacts.
- `publint` and `@arethetypeswrong/cli` added as root dev dependencies; corresponding scripts added to each package.

### Fixed

- Publish workflow now uses `npm publish` (not `pnpm publish`). pnpm 9 doesn't exchange the GitHub OIDC token for an npm publish credential, so trusted-publishing failed with `404 Not Found`. The workflow upgrades npm to 11.5.1+ (since superseded by the Node 24 bump on 2026-05-07).

## 2026-05-05

### Added

- Initial monorepo bootstrap. pnpm workspace with `packages/`, `libs/`, `apps/`, `tools/` globs.
- Migrated `@cacheplane/partial-json` and `@cacheplane/partial-markdown` from separate repositories. Tooling (tsup, vitest, ESLint flat config, TypeScript) hoisted to the workspace root; per-package configs preserved.
- Shared `tsconfig.base.json` extended by each package.
- Tag-routed publish workflow: `partial-json-v*` and `partial-markdown-v*` tags trigger a single OIDC-authenticated publish for the matching package, with provenance attestations.
- `RELEASING.md` documenting the per-package release flow.

### Notes

- Old standalone repositories archived on GitHub with redirect READMEs.
- Considered a private `libs/internal-types` workspace package to share `StreamStatus`. Dropped after implementation: tsup's DTS rollup (`rollup-plugin-dts`) does not honor `noExternal` for workspace dependencies, leaking the import into consumer-facing `dist/*.d.ts`. Each package now declares the type literally and pins the tristate via `expectTypeOf` in `types.test.ts`.
