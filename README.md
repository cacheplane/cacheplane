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
