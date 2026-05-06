# @cacheplane/partial-json

Streaming partial-JSON parser. Returns a structured AST as bytes arrive, preserves object identity across mutations, and supports both pull-style (`create / push / finish / resolve`) and push-style (`createPartialJsonParser` with events) APIs.

## Install

```bash
npm install @cacheplane/partial-json
```

## Quick start

```ts
import { createPartialJsonParser, materialize } from '@cacheplane/partial-json';

const parser = createPartialJsonParser();
parser.push('{"items":[{"id":"a"},');
parser.push('{"id":"b"}]}');

const node = parser.getByPath('/items/1/id');
const value = materialize(parser.root);
```

## API

See full documentation at https://github.com/cacheplane/partial-json
