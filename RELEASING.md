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

- `json-stream-v0.0.4` → publishes `packages/json-stream` at version `0.0.4`
- `partial-json-v0.2.1` → publishes `packages/partial-json` at version `0.2.1`
- `partial-markdown-v0.3.1` → publishes `packages/partial-markdown` at version `0.3.1`

The workflow verifies that the tag version matches `package.json` before publishing.

## Adding a new publishable package

Add the new tag prefix to `.github/workflows/publish.yml` `on.push.tags`.
