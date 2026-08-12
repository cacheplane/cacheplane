# Changelog

## 0.2.2 — 2026-08-11

### Changed

- The immutable parser API now delegates to `@cacheplane/json-stream`, which is
  the single JSON parsing kernel shared by both Cacheplane JSON packages.
- The push-style parser, event ordering, stable node identities, structural
  sharing, and existing public exports remain unchanged.

### Performance

- Removed the duplicate parser implementation from the package bundle. The
  push-style facade now ships as a smaller layer over `@cacheplane/json-stream`.

## 0.2.1 — 2026-05-06

Infrastructure-only release. No behavior changes; verifies the monorepo's
tag-routed publish pipeline.

## 0.2.0 — 2026-05-05

### Changed (breaking type renames)

- `JsonNodeStatus` → `StreamStatus`. Same value union (`'pending' | 'streaming' | 'complete'`). Migration: `sed -i '' 's/JsonNodeStatus/StreamStatus/g' your-files`.
- The internal `NodeStatus` type (`'complete' | 'incomplete'`) is no longer exported. It was an internal AST detail; consumers should not have used it. Internally it has been renamed to `AstNodeStatus` and kept un-exported.

### Why

Public API alignment with `@cacheplane/partial-markdown`, which exports an identical `StreamStatus` tristate type. Consumers using both libraries get a unified concept name.

### Migration

```diff
- import type { JsonNodeStatus } from '@cacheplane/partial-json';
+ import type { StreamStatus } from '@cacheplane/partial-json';
```

If you were importing the legacy `NodeStatus` from this package, replace with `StreamStatus`.

## 0.1.1 — initial published versions
