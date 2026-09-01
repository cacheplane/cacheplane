# Changelog

Releases up to and including `0.0.3` were cut from `cacheplane/pretable`, where
this package originally lived. Entries below `0.0.3` are the changesets-generated
history from that repo, preserved verbatim.

## 0.1.0 — 2026-09-01

### Added

- Added the public `StreamErrorCode` union with stable `INVALID_SYNTAX`,
  `UNEXPECTED_END`, and `TRAILING_CONTENT` categories.
- Parser error states retain their structured code across later `push()` and
  `finish()` calls. Human-readable messages remain diagnostic rather than a
  control-flow contract.

### Changed

- **Source-breaking:** `StreamError.code` is now required. Consumers that
  construct, narrow, or mirror `StreamError` must add the field. Branch on
  `error.code` rather than matching `error.message`; message wording is not a
  control-flow contract.
- `finish()` classifies incrementally valid number prefixes such as `-`, `1.`,
  and `1e+` as `UNEXPECTED_END`. Malformed numeric grammar remains
  `INVALID_SYNTAX`.

## 0.0.4 — 2026-08-07

First release from `cacheplane/cacheplane`, and the first to carry a provenance
attestation. No source changes from `0.0.3` — the package moved repositories,
with its history, and now releases through the tag-routed OIDC publish workflow
alongside `partial-json` and `partial-markdown`.

## 0.0.3 — 2026-08-07

Version-alignment release, no behavior changes. This package was in a changesets
`fixed` group with `@pretable/core` and `@pretable/react`, so it bumped whenever
they did. The last release from `cacheplane/pretable`.

## 0.0.2 — 2026-08-05

### Patch Changes

- Add MIT license metadata, repository links, homepage links, and issue tracker ([#104](https://github.com/cacheplane/pretable/pull/104))
  metadata to the public packages as part of the open-source community health
  pass.

## 0.0.1 — 2026-05-03

### Patch Changes

- Initial release. Pretable's wrapped-text scroll wedge (4× faster than Grid Alpha on S2/hypothesis), streaming row-stability win (H15 satisfied — pretable max visible-row drift = 1 vs Grid Alpha's 28 across 100–25,000 patches/sec), and end-to-end React adapter with reusable JSON streaming primitives. ([#58](https://github.com/cacheplane/pretable/pull/58))

  See [the publishing pipeline design](https://github.com/cacheplane/pretable/blob/main/docs/superpowers/specs/2026-05-01-npm-publishing-pipeline-design.md) for context on the build, verification, and release flow.
