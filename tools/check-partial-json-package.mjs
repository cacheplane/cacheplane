// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedExports = [
  'create',
  'createPartialJsonParser',
  'finish',
  'isArrayNode',
  'isBoolNode',
  'isComplete',
  'isNullNode',
  'isNumberNode',
  'isObjectNode',
  'isStringNode',
  'materialize',
  'push',
  'resolve',
];
const packageDirectory = new URL('../packages/partial-json/', import.meta.url);
const kernelDirectory = new URL('../packages/json-stream/', import.meta.url);
const kernelManifest = JSON.parse(
  await readFile(new URL('../packages/json-stream/package.json', import.meta.url), 'utf8'),
);
const require = createRequire(import.meta.url);

const esm = await import(new URL('dist/index.mjs', packageDirectory));
const cjs = require(fileURLToPath(new URL('dist/index.cjs', packageDirectory)));
assert.deepEqual(Object.keys(esm).sort(), expectedExports);
assert.deepEqual(Object.keys(cjs).sort(), expectedExports);

const declaration = await readFile(new URL('dist/index.d.ts', packageDirectory), 'utf8');
const esmSource = await readFile(new URL('dist/index.mjs', packageDirectory), 'utf8');
const cjsSource = await readFile(new URL('dist/index.cjs', packageDirectory), 'utf8');
assert.match(declaration, /from '@cacheplane\/json-stream'/);
assert.doesNotMatch(declaration, /\bNodeStatus\b/);
assert.match(esmSource, /from '@cacheplane\/json-stream'/);
assert.match(cjsSource, /require\(['"]@cacheplane\/json-stream['"]\)/);

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'cacheplane-partial-json-'));
try {
  const tarball = pack(packageDirectory, temporaryDirectory);
  const kernelTarball = pack(kernelDirectory, temporaryDirectory);
  const manifest = JSON.parse(
    execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }),
  );
  const files = execFileSync('tar', ['-tf', tarball], { encoding: 'utf8' }).trim().split('\n');

  assert.equal(manifest.dependencies['@cacheplane/json-stream'], `^${kernelManifest.version}`);
  assert.doesNotMatch(JSON.stringify(manifest), /workspace:/);
  assert.ok(files.every((file) => !file.startsWith('package/src/')));

  await writeFile(
    join(temporaryDirectory, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' })}\n`,
  );
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      kernelTarball,
      tarball,
    ],
    { cwd: temporaryDirectory, stdio: 'pipe' },
  );
  smokeInstalledPackage(temporaryDirectory, 'module');
  smokeInstalledPackage(temporaryDirectory, 'commonjs');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log('partial-json package boundary verified');

function pack(directory, destination) {
  const output = execFileSync(
    'pnpm',
    ['pack', '--pack-destination', destination],
    { cwd: directory, encoding: 'utf8' },
  );
  const tarball = output.trim().split('\n').at(-1);
  if (!tarball) throw new Error(`pnpm pack did not return a tarball path for ${directory}`);
  return tarball;
}

function smokeInstalledPackage(directory, inputType) {
  const load = inputType === 'module'
    ? "import * as api from '@cacheplane/partial-json';"
    : "const api = require('@cacheplane/partial-json');";
  const script = `
    ${load}
    const expected = ${JSON.stringify(expectedExports)};
    if (JSON.stringify(Object.keys(api).sort()) !== JSON.stringify(expected)) process.exit(2);
    const parser = api.createPartialJsonParser();
    parser.push('{"ok":true}');
    if (JSON.stringify(api.materialize(parser.root)) !== '{"ok":true}') process.exit(3);
  `;
  execFileSync(process.execPath, [`--input-type=${inputType}`, '--eval', script], {
    cwd: directory,
    stdio: 'pipe',
  });
}
