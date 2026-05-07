# Contributing

Thanks for helping improve Cacheplane.

## Development

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs lint, typecheck, tests, and package builds for every published package.

## Pull Requests

- Open a pull request against `main`.
- Keep changes focused and include tests for behavior changes.
- Run `pnpm verify` before requesting review.
- Update package README or docs when public behavior changes.
- Do not include secrets, credentials, private tokens, or generated `dist/` output.

## Licensing

Cacheplane is MIT licensed. By submitting a contribution, you agree that your contribution may be distributed under the MIT License.

No separate Contributor License Agreement is required at this time.

## Security

Please do not report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).
