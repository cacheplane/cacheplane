# Cacheplane

Streaming parsers for incomplete input — built for parsing the output of LLMs token by token, with stable node identity across pushes so your UI can use referential equality for memoization.

## Packages

| Package | Version | Description |
|---|---|---|
| [`@cacheplane/partial-json`](packages/partial-json) | [![npm](https://img.shields.io/npm/v/@cacheplane/partial-json.svg)](https://www.npmjs.com/package/@cacheplane/partial-json) | Streaming JSON parser. AST grows in place; nodes carry `pending / streaming / complete` status. |
| [`@cacheplane/partial-markdown`](packages/partial-markdown) | [![npm](https://img.shields.io/npm/v/@cacheplane/partial-markdown.svg)](https://www.npmjs.com/package/@cacheplane/partial-markdown) | Streaming Markdown parser with GFM tables, task lists, citations, and indent-aware nested lists. Same architectural shape applied to markdown. |

Both packages: ESM + CJS bundled, zero runtime dependencies, side-effect free, dual push-style and pull-style APIs over a shared core.

## Repository layout

- `packages/*` — published to npm under `@cacheplane/*`
- `libs/*` — private workspace-only code (never published)
- `apps/*` — deployable services / frontends (reserved)
- `tools/*` — repo-internal scripts (reserved)

## Development

```bash
pnpm install
pnpm verify          # lint + typecheck + test + build
pnpm test            # tests only
pnpm build           # publishable artifacts in packages/*/dist
```

## Releasing

See [RELEASING.md](RELEASING.md). Tag-routed publish: `partial-json-v0.2.2` triggers an OIDC trusted-publishing release of `@cacheplane/partial-json@0.2.2`, same for partial-markdown.

Monorepo-level changes (CI, tooling, workspace structure) are tracked in the root [CHANGELOG.md](CHANGELOG.md). Per-package release notes live in each package's own `CHANGELOG.md`.

## License

MIT
