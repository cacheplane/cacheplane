# Changelog

Releases up to and including `0.0.3` were cut from `cacheplane/pretable`, where
this package originally lived. Entries below `0.0.3` are the changesets-generated
history from that repo, preserved verbatim.

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
