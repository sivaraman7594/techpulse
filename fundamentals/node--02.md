## 3. Modules and Packages

### CommonJS modules
<!-- level: basic; ref: https://nodejs.org/api/modules.html -->
CommonJS (CJS) was Node's original module system and is still widespread. A module exports by assigning to `module.exports` (or adding properties to `exports`) and imports with `require()`.

Under the hood, Node wraps each CJS file in a function `(exports, require, module, __filename, __dirname) => { ... }`, which is why those names are available and why top-level variables are module-private. `require` is synchronous: it resolves the path, reads the file, executes it, and caches the resulting `module.exports` in `require.cache` keyed by absolute filename. Subsequent requires return the cached object — modules are effectively singletons per resolved path.

Resolution for bare names (`require('express')`) walks up `node_modules` directories from the current file. Relative paths try exact name, then `.js`, `.json`, `.node`, then directory `index` files.

```js
// lib/rate-limit.js
const buckets = new Map();             // module-private, shared by all importers

function allow(key, limit = 10) {
  const count = (buckets.get(key) ?? 0) + 1;
  buckets.set(key, count);
  return count <= limit;
}

module.exports = { allow };

// app.js
const { allow } = require('./lib/rate-limit');
const config = require('./config.json');  // JSON is parsed automatically
```

#### Pitfalls
- `exports = { allow }` does nothing — it rebinds the local variable; assign `module.exports` instead.
- Circular `require` returns a partially filled `module.exports`, giving `undefined` functions at load time.
- Two copies of a package in different `node_modules` folders are two separate singletons.

### ES modules in Node.js
<!-- level: basic; ref: https://nodejs.org/api/esm.html -->
Node supports standard ES modules (`import`/`export`). A file is treated as ESM when it has a `.mjs` extension, or a `.js` extension inside a package whose nearest `package.json` has `"type": "module"`. `.cjs` is always CommonJS. Since Node 22.7 (and 20.19), Node can also detect ESM syntax in ambiguous `.js` files without a `"type"` field, but declaring it explicitly is clearer and faster.

Differences from CommonJS in Node:

- Relative imports need full file extensions: `import './util.js'`, not `'./util'`.
- No `require`, `__dirname`, `__filename`; use `import.meta.dirname`, `import.meta.filename`, or `createRequire` when you really need `require`.
- Top-level `await` is allowed.
- Built-ins can be imported with the `node:` prefix (`node:fs`), which is recommended to avoid confusion with npm packages.
- JSON imports require an import attribute: `import data from './data.json' with { type: 'json' }`.
- Strict mode always; `this` at top level is `undefined`.

```js
// package.json: { "type": "module" }
import { readFile } from 'node:fs/promises';
import express from 'express';            // CJS packages can be imported (default = module.exports)
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const legacy = require('./legacy-config.cjs');

const schema = JSON.parse(await readFile(new URL('./schema.json', import.meta.url), 'utf8'));
const app = express();
```

#### Interview tip
- New projects should use ESM; mention the extension rule and the `node:` prefix as practical differences that trip up teams migrating from CJS.

### CommonJS and ESM interoperability
<!-- level: advanced; ref: https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require -->
Mixing the two systems used to be the most painful part of the Node ecosystem. The rules now:

- ESM importing CJS: works. `module.exports` becomes the default export, and Node statically detects common named exports patterns (via cjs-module-lexer) so `import { x } from 'cjs-pkg'` often works too.
- CJS importing ESM: historically only possible with dynamic `import()`, which is async. Since Node 22.12 and 20.19, `require(esm)` is enabled by default for ES modules without top-level `await`. It returns the module namespace object. If the ES module uses top-level await, `require` throws `ERR_REQUIRE_ASYNC_MODULE`.

The "dual package hazard": a package that ships both CJS and ESM builds can be loaded twice in one app (once per format), giving two copies of its state and failing `instanceof` checks. With `require(esm)` available, many library authors now ship ESM only.

```js
// legacy.cjs — CommonJS consumer of an ESM-only package
const { nanoid } = require('nanoid');     // Node 22.12+/20.19+: works synchronously

// Before require(esm) you had to do:
async function main() {
  const { nanoid } = await import('nanoid');
  console.log(nanoid());
}

// esm.mjs — ESM consumer of a CommonJS package
import pg from 'pg';                       // default = module.exports
const { Pool } = pg;
```

#### Pitfalls
- In ESM, `import { Pool } from 'pg'` may fail if the named export cannot be detected statically; import the default and destructure.
- Bundlers and test runners have their own interop rules, which may differ from Node's.

### package.json: type, exports and imports
<!-- level: intermediate; ref: https://nodejs.org/api/packages.html -->
Several `package.json` fields control how Node loads a package:

- `"type"`: `"module"` or `"commonjs"` (default) — how `.js` files are interpreted.
- `"main"`: legacy entry point.
- `"exports"`: the modern entry point map. It defines exactly which subpaths can be imported and which file to load for each condition (`import`, `require`, `node`, `default`, `types`, plus custom conditions like `development`). Anything not listed is inaccessible, giving packages true encapsulation.
- `"imports"`: private aliases starting with `#`, resolved within the package (`#db/*`). They work in Node and TypeScript, unlike bundler-only path aliases.
- `"engines"`: supported Node versions; `"files"`: what gets published; `"bin"`: CLI executables.

Conditions are matched in object order, so put more specific ones first and `default` last; `types` should come first for TypeScript.

```json
{
  "name": "@acme/money",
  "version": "2.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./format": "./dist/format.js",
    "./package.json": "./package.json"
  },
  "imports": {
    "#internal/*": "./src/internal/*.js"
  },
  "engines": { "node": ">=20.19" },
  "files": ["dist"]
}
```

#### Pitfalls
- Adding `exports` to an existing package is a breaking change: deep imports like `@acme/money/dist/utils.js` stop working.

### npm, semver and lockfiles
<!-- level: basic; ref: https://nodejs.org/en/learn/getting-started/an-introduction-to-the-npm-package-manager -->
npm is Node's default package manager (alternatives: pnpm, Yarn, Bun). It installs dependencies listed in `package.json` into `node_modules`.

Dependencies are categorised as `dependencies` (needed at runtime), `devDependencies` (build, test, lint tools), `peerDependencies` (expected to be provided by the host project, e.g. a React plugin needs `react`), and `optionalDependencies`.

Versions follow semantic versioning `MAJOR.MINOR.PATCH`: breaking changes bump major, new features bump minor, fixes bump patch. Ranges: `^1.4.2` allows `<2.0.0` (and for `0.x`, only patch updates within the minor), `~1.4.2` allows `<1.5.0`, an exact `1.4.2` pins.

The lockfile (`package-lock.json`) records the exact resolved version and integrity hash of every package in the tree. Commit it. Use `npm ci` in CI and deployments: it installs exactly what the lockfile says, fails if `package.json` and the lockfile disagree, and starts from a clean `node_modules`.

```bash
npm install zod                  # adds to dependencies, updates lockfile
npm install -D vitest            # devDependency
npm ci                           # reproducible install for CI/production
npm ci --omit=dev                # production image without dev tools
npm outdated                     # see available updates
npm ls lodash                    # why is this package installed?
npm update --save                # update within ranges
```

```json
{
  "dependencies": { "express": "^5.1.0", "zod": "~3.24.0" },
  "devDependencies": { "vitest": "^3.0.0" },
  "overrides": { "semver": "7.6.3" }
}
```

#### Pitfalls
- Deleting the lockfile to "fix" install errors silently upgrades hundreds of transitive packages.
- `overrides` force a transitive version (useful for security patches) but can break packages expecting another major.

### npm scripts and npx
<!-- level: basic; ref: https://nodejs.org/en/learn/getting-started/an-introduction-to-the-npm-package-manager -->
The `scripts` field defines project commands run with `npm run <name>` (or `node --run <name>` in Node 22+ for faster startup). Inside scripts, `node_modules/.bin` is on the `PATH`, so locally installed tools like `tsc`, `vitest` and `eslint` can be called directly without global installs — keeping tool versions consistent across the team.

Conventions: `start`, `test`, `build`, `dev`, `lint`. `pre<name>` and `post<name>` scripts run automatically around `<name>` with npm (but not with `node --run`). Lifecycle scripts like `postinstall` run during installs — including for dependencies, which is a known supply-chain risk.

`npx <pkg>` runs a package binary, downloading it temporarily if not installed. Pin the version (`npx create-vite@6`) for reproducibility and safety.

```json
{
  "scripts": {
    "dev": "node --watch --env-file=.env src/server.js",
    "build": "tsc -p tsconfig.build.json",
    "test": "node --test --experimental-test-coverage",
    "lint": "eslint . --max-warnings=0",
    "typecheck": "tsc --noEmit",
    "check": "npm run lint && npm run typecheck && npm test"
  }
}
```

```bash
npm run check
node --run dev
npm test -- --test-name-pattern="orders"   # pass args after --
npx --yes prisma@6 migrate deploy
```

#### Pitfalls
- Scripts using shell features (`&&`, `rm -rf`, env var syntax) may break on Windows; use cross-platform tools or Node scripts.
- `npm install --ignore-scripts` (or pnpm's default of not running dependency build scripts) reduces the risk of malicious install scripts.

## 4. Buffers and the File System

### Buffers and binary data
<!-- level: intermediate; ref: https://nodejs.org/api/buffer.html -->
A `Buffer` is Node's type for raw binary data — a subclass of `Uint8Array` with extra methods for encodings and number I/O. You meet buffers when reading files without an encoding, receiving socket data, hashing, compressing, and handling uploads.

Creating buffers:

- `Buffer.from('text', 'utf8')`, `Buffer.from(array)`, `Buffer.from(base64String, 'base64')`.
- `Buffer.alloc(size)` — zero-filled, safe.
- `Buffer.allocUnsafe(size)` — faster, but contains old memory contents that may include secrets; only use it if you overwrite every byte.

Supported encodings include `utf8`, `base64`, `base64url`, `hex`, `latin1` and `utf16le`. Convert back with `buf.toString(encoding)`.

Small buffers are carved from a shared pre-allocated pool for speed, so `buf.buffer` (the underlying `ArrayBuffer`) may be larger than the buffer and shared. `buf.subarray()` creates a view sharing the same memory, not a copy.

```js
const token = Buffer.from('user:42').toString('base64url');   // 'dXNlcjo0Mg'
Buffer.from(token, 'base64url').toString();                  // 'user:42'

const header = Buffer.alloc(8);
header.writeUInt32BE(0xcafebabe, 0);
header.writeUInt32BE(1024, 4);
header.readUInt32BE(4);                                      // 1024

// Collect chunks from a stream safely
const chunks = [];
for await (const chunk of req) chunks.push(chunk);
const body = Buffer.concat(chunks).toString('utf8');

// Multi-byte characters can be split across chunks — decode the whole buffer,
// or use a TextDecoder / string_decoder when processing incrementally
```

#### Pitfalls
- Calling `chunk.toString()` on each chunk separately corrupts multi-byte UTF-8 characters at chunk boundaries.
- Comparing secrets with `===` leaks timing information; use `crypto.timingSafeEqual(bufA, bufB)`.

### The fs module: callbacks, promises and sync
<!-- level: basic; ref: https://nodejs.org/api/fs.html -->
The `fs` module offers three API styles for the same operations:

- Promise-based: `import { readFile } from 'node:fs/promises'` — the modern default with async/await.
- Callback-based: `fs.readFile(path, cb)` — the original style, slightly faster in hot paths.
- Synchronous: `fs.readFileSync(path)` — blocks the event loop; fine in startup code and CLIs.

Common operations: `readFile`, `writeFile`, `appendFile`, `mkdir` (with `recursive: true`), `readdir` (with `withFileTypes` and `recursive`), `stat`, `rm` (with `recursive` and `force`), `rename`, `copyFile`, `cp`, `access`, and `open` for a `FileHandle` with fine-grained reads and writes. Recent versions add `fs.glob` (Node 22+).

Flags control behaviour: `'w'` truncates, `'a'` appends, `'wx'` fails if the file exists — useful for lock files and avoiding overwrites.

```js
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Atomic write: write to a temp file, then rename over the target
export async function saveJson(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, path);           // atomic on the same filesystem
}

export async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;  // missing file is expected
    throw err;
  }
}

await mkdir('reports/2025', { recursive: true });
const entries = await readdir('reports', { withFileTypes: true, recursive: true });
const csvFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.csv'));
```

#### Pitfalls
- Checking `exists`/`access` before opening a file creates a race condition (TOCTOU); just try the operation and handle the error code.
- `readFile` loads the entire file into memory — use streams for large files.

### Paths and file URLs
<!-- level: basic; ref: https://nodejs.org/api/path.html -->
The `path` module manipulates file paths in a platform-aware way: Windows uses backslashes and drive letters, POSIX uses forward slashes. Never build paths with string concatenation.

Key functions: `join` (concatenate and normalise), `resolve` (make absolute, relative to the current working directory), `dirname`, `basename`, `extname`, `relative`, `parse`/`format`, and `normalize`. `path.posix` and `path.win32` force a specific style.

In ES modules, the current file is identified by a `file:` URL (`import.meta.url`). Convert with `fileURLToPath` / `pathToFileURL` from `node:url`, or use `import.meta.dirname`. Many `fs` functions accept `URL` objects directly.

Security matters when paths come from users: joining an uploaded filename like `../../etc/passwd` escapes your directory. Resolve the final path and check it is still inside the allowed root.

```js
import path from 'node:path';

const UPLOAD_ROOT = path.resolve('uploads');

export function safeUploadPath(userFileName) {
  const target = path.resolve(UPLOAD_ROOT, userFileName);
  if (target !== UPLOAD_ROOT && !target.startsWith(UPLOAD_ROOT + path.sep)) {
    throw new Error('Path traversal attempt');
  }
  return target;
}

path.join('/data', 'reports', '..', 'a.csv');   // '/data/a.csv'
path.extname('archive.tar.gz');                  // '.gz'
path.parse('/srv/app/index.js');
// { root: '/', dir: '/srv/app', base: 'index.js', ext: '.js', name: 'index' }

const templates = new URL('./templates/', import.meta.url);
```

#### Pitfalls
- `path.resolve` uses `process.cwd()`, which depends on where the process was started; for files shipped with your code, resolve relative to the module.

### File watching and filesystem edge cases
<!-- level: intermediate; ref: https://nodejs.org/api/fs.html#fswatchfilename-options-listener -->
`fs.watch` uses OS notification mechanisms (inotify, FSEvents, ReadDirectoryChangesW) to report changes; `fs.watchFile` polls with `stat` and is slower but more portable. The promise API offers `fs/promises.watch`, an async iterator.

Watching is notoriously inconsistent across platforms: events may fire multiple times for one save, editors write via rename (so you see `rename` rather than `change`), `recursive` support varies by OS and version, and network filesystems or containers with mounted volumes may not deliver events at all. Libraries like chokidar smooth these over; for development restarts, `node --watch` covers most needs.

Other edge cases worth knowing:

- File descriptors are limited per process (`EMFILE: too many open files`); limit concurrency when processing many files.
- Windows locks open files, so renames and deletes can fail with `EBUSY` or `EPERM`.
- Case sensitivity differs: macOS and Windows are usually case-insensitive, Linux is case-sensitive — imports that work locally break in a Linux container.

```js
import { watch } from 'node:fs/promises';

const ac = new AbortController();
let timer;

(async () => {
  try {
    for await (const event of watch('./config', { signal: ac.signal })) {
      clearTimeout(timer);                            // debounce bursts of events
      timer = setTimeout(() => reloadConfig(event.filename), 200);
    }
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  }
})();

process.on('SIGTERM', () => ac.abort());
```

#### Pitfalls
- Unbounded `Promise.all(files.map(readFile))` over tens of thousands of files triggers `EMFILE`; use a concurrency limit.

### Handling large files
<!-- level: intermediate; ref: https://nodejs.org/api/fs.html#fscreatereadstreampath-options -->
Loading a multi-gigabyte file with `readFile` either exhausts memory or fails outright (a single string is limited to roughly 512 MB–1 GB in V8). Process large files incrementally instead:

- `fs.createReadStream` / `createWriteStream` read and write in chunks (64 KB by default for files), with backpressure via `pipeline`.
- `readline` with `crlfDelay: Infinity` iterates lines of a text file with constant memory.
- `FileHandle.read` with a reusable buffer gives full control for binary formats and random access.
- For JSON larger than memory, use a streaming parser or switch to NDJSON (one JSON object per line).

Memory then stays roughly constant regardless of file size, and processing starts immediately instead of after the whole file is read.

```js
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

// Count error lines in a 10 GB log with constant memory
export async function countErrors(file) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let errors = 0;
  for await (const line of rl) {
    if (line.includes(' ERROR ')) errors++;
  }
  return errors;
}

// Compress a large file
await pipeline(
  createReadStream('export.csv'),
  createGzip(),
  createWriteStream('export.csv.gz'),
);
```

#### Interview tip
- Explain why streaming improves both memory and time-to-first-byte, and mention `highWaterMark` as the knob for chunk size.
