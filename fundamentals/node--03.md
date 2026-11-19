## 5. Streams

### Stream types
<!-- level: intermediate; ref: https://nodejs.org/api/stream.html -->
A stream is an abstraction for data that arrives or leaves over time in chunks, instead of all at once. Streams keep memory usage flat for large or infinite data and let processing begin before all data is available.

Node has four stream types, all `EventEmitter`s:

- Readable: a source you read from — `fs.createReadStream`, an HTTP request on the server, `process.stdin`, a database cursor.
- Writable: a destination — `fs.createWriteStream`, an HTTP response, `process.stdout`.
- Duplex: both readable and writable, independently — a TCP socket.
- Transform: a duplex where output is computed from input — `zlib.createGzip`, encryption, CSV parsing.

By default streams carry `Buffer`s or strings. Object mode (`objectMode: true`) carries arbitrary JavaScript values, which is handy for record-processing pipelines.

Each stream has an internal buffer whose target size is `highWaterMark` (64 KiB for file streams, 16 KiB for most others in bytes, 16 objects in object mode). It is the key to backpressure.

```js
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';

// The response is a Writable; the file stream is a Readable
createServer((req, res) => {
  const file = createReadStream('./video.mp4');
  res.setHeader('content-type', 'video/mp4');
  file.pipe(res);
  file.on('error', () => {
    res.statusCode = 500;
    res.end();
  });
}).listen(3000);
```

#### Interview tip
- Give a concrete example per type and explain why serving a 2 GB file with `readFile` would fail under concurrency while streaming works.

### Readable streams: flowing and paused modes
<!-- level: advanced; ref: https://nodejs.org/api/stream.html#two-reading-modes -->
A readable stream is in one of two modes:

- Paused (the initial state): data accumulates in the internal buffer until you pull it with `read()`, typically inside a `'readable'` event handler.
- Flowing: data is pushed to you through `'data'` events as fast as it arrives. A stream switches to flowing when you attach a `'data'` listener, call `resume()`, or `pipe()` it.

In flowing mode, if no one consumes the data events, the data is lost; if your handler cannot keep up, there is no automatic backpressure unless you `pause()` manually. That is why modern code prefers either `pipeline()` or async iteration: `for await (const chunk of readable)` pulls one chunk at a time and waits for your loop body before reading more, giving natural backpressure.

Custom readables implement `_read()` and call `push(chunk)`; `push(null)` signals the end. `Readable.from(iterable)` turns any iterable or async iterable into a stream.

```js
import { Readable } from 'node:stream';

// From an async generator: paginate a database into a stream
async function* allUsers(db) {
  let cursor = null;
  do {
    const page = await db.users.find({ after: cursor, limit: 500 });
    for (const u of page.items) yield u;
    cursor = page.nextCursor;
  } while (cursor);
}

const users = Readable.from(allUsers(db));      // objectMode stream

for await (const user of users) {
  await sendNewsletter(user);                   // next user read only after this resolves
}
```

#### Pitfalls
- Mixing `'data'` listeners, `'readable'` listeners and `pipe` on the same stream leads to confusing behaviour; pick one consumption style.
- Async iteration processes chunks sequentially; for parallel processing use bounded concurrency on top.

### Writable streams and backpressure
<!-- level: advanced; ref: https://nodejs.org/en/learn/modules/backpressuring-in-streams -->
Backpressure is the mechanism that slows a fast producer down to the pace of a slow consumer. Without it, data piles up in memory until the process crashes.

For writables, `write(chunk)` returns a boolean. `true` means the internal buffer is below `highWaterMark` and you may continue. `false` means the buffer is full: stop writing and wait for the `'drain'` event before continuing. The chunk is still accepted — the return value is advice, and ignoring it is how memory blows up.

`pipe()` and `pipeline()` implement this automatically: they pause the source when `write` returns `false` and resume on `'drain'`. When writing manually in a loop, you must handle it yourself.

Custom writables implement `_write(chunk, encoding, callback)` and call `callback()` when the chunk is handled; the stream will not deliver the next chunk until then.

```js
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

export async function exportRows(rows, file) {
  const out = createWriteStream(file);
  for (const row of rows) {
    const ok = out.write(`${row.id},${row.name},${row.total}\n`);
    if (!ok) await once(out, 'drain');     // respect backpressure
  }
  out.end();
  await once(out, 'finish');
}

// Leaky version: write() result ignored — with millions of rows and a slow
// disk, all pending chunks are buffered in memory.
```

#### Interview tip
- Describe backpressure end to end: the slow writable fills its buffer, `write` returns false, the readable stops reading, the TCP window fills, and ultimately the remote sender slows down.

### pipeline and stream error handling
<!-- level: intermediate; ref: https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-options -->
`pipe()` connects streams and handles backpressure, but it does not forward errors or clean up: if the destination fails, the source keeps its file descriptor open, and an error on a middle stream may go unhandled and crash the process.

`stream.pipeline()` (and its promise version in `node:stream/promises`) fixes this. It connects any number of streams, propagates errors from any of them, destroys all streams when one fails or the pipeline is aborted, and reports completion through a callback or promise. It also accepts async generator functions as transform steps, and an `AbortSignal` for cancellation.

Use `pipeline` everywhere you would have used `pipe`. Related helpers: `stream.finished()` waits for a stream to end or fail, and `stream.compose()` combines streams into one duplex.

```js
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';

export async function archiveLog(src, dest, signal) {
  await pipeline(
    createReadStream(src),
    async function* redact(source) {
      for await (const chunk of source) {
        yield chunk.toString().replace(/password=\S+/g, 'password=***');
      }
    },
    createGzip(),
    createWriteStream(dest),
    { signal },
  );
}

try {
  await archiveLog('app.log', 'app.log.gz', AbortSignal.timeout(60_000));
} catch (err) {
  console.error('archive failed; all streams were cleaned up', err);
}
```

#### Pitfalls
- The redact step above converts each chunk to a string separately, which can split multi-byte characters or a `password=` token across chunks; real transforms must handle chunk boundaries.

### Transform streams
<!-- level: intermediate; ref: https://nodejs.org/api/stream.html#class-streamtransform -->
A Transform stream reads input, changes it, and outputs the result — compression, encryption, parsing, filtering, format conversion. You implement `transform(chunk, encoding, callback)`, calling `this.push(output)` zero or more times and then `callback()` (or `callback(err)`). An optional `flush(callback)` runs at the end to emit any remaining buffered data.

Chunks rarely align with logical records: a chunk may end in the middle of a line or a JSON object. Robust transforms keep a carry-over buffer for the incomplete tail and process it when more data arrives, emitting the final piece in `flush`.

In modern code, an async generator passed to `pipeline` is often simpler than subclassing `Transform`.

```js
import { Transform } from 'node:stream';

// Split a byte stream into lines, handling chunk boundaries
export function lineSplitter() {
  let tail = '';
  return new Transform({
    readableObjectMode: true,
    transform(chunk, _enc, callback) {
      const lines = (tail + chunk.toString('utf8')).split('\n');
      tail = lines.pop();                 // incomplete last line
      for (const line of lines) if (line) this.push(line);
      callback();
    },
    flush(callback) {
      if (tail) this.push(tail);
      callback();
    },
  });
}

// CSV line -> object
export const toRecord = new Transform({
  objectMode: true,
  transform(line, _enc, cb) {
    const [id, name, amount] = line.split(',');
    cb(null, { id, name, amount: Number(amount) });   // shorthand for push + callback
  },
});
```

#### Pitfalls
- Using `chunk.toString()` per chunk can still split multi-byte characters; use `setEncoding('utf8')` on the source or a `StringDecoder` to be fully safe.

### Async iteration and Web Streams
<!-- level: advanced; ref: https://nodejs.org/api/webstreams.html -->
Node supports two stream families:

- Node streams (`node:stream`) — the classic API used by `fs`, `http`, `net`, `zlib`.
- Web Streams (`ReadableStream`, `WritableStream`, `TransformStream`) — the WHATWG standard used by `fetch`, browsers, Deno, Bun and edge runtimes. Stable in Node since v21.

Both are async iterable, so `for await` works on either. Conversion helpers bridge them: `Readable.toWeb()` / `Readable.fromWeb()` and `Writable.toWeb()` / `Writable.fromWeb()`. Use Web Streams when sharing code with browsers or edge platforms, or when working with `fetch` bodies; use Node streams for core I/O APIs, where they are generally faster.

`fetch` response bodies in Node are Web `ReadableStream`s; to pipe one to a file, convert it with `Readable.fromWeb`.

```js
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

export async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

// Web TransformStream: uppercase text
const upper = new TransformStream({
  transform(chunk, controller) {
    controller.enqueue(chunk.toUpperCase());
  },
});

const res = await fetch('https://example.com');
const text = res.body.pipeThrough(new TextDecoderStream()).pipeThrough(upper);
for await (const part of text) process.stdout.write(part);
```

#### Interview tip
- Know that the two families have different backpressure models (Web Streams use a pull-based `desiredSize`), and that conversion has a small overhead.

## 6. HTTP and Networking

### Building an HTTP server with node:http
<!-- level: basic; ref: https://nodejs.org/api/http.html -->
`http.createServer(handler)` creates a server that calls your handler with an `IncomingMessage` (a readable stream with `method`, `url`, `headers`) and a `ServerResponse` (a writable stream). Frameworks like Express, Fastify, Koa and Hono are layers over this core.

Understanding the raw API helps debug framework behaviour:

- You must eventually call `res.end()`, or the client hangs until a timeout.
- Headers must be set before the body starts; once `res.headersSent` is true, they are locked.
- The request body is not parsed for you — you read the stream.
- Routing is just inspecting `req.method` and the URL.

```js
import { createServer } from 'node:http';

const products = new Map([['1', { id: '1', name: 'Pen', price: 100 }]]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/products\/(\w+)$/);

  if (req.method === 'GET' && match) {
    const product = products.get(match[1]);
    if (!product) return send(res, 404, { error: 'Not found' });
    return send(res, 200, product);
  }
  send(res, 404, { error: 'No route' });
});

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
  });
  res.end(json);
}

server.listen(process.env.PORT ?? 3000);
```

#### Pitfalls
- Using `json.length` for `content-length` is wrong for non-ASCII text; use `Buffer.byteLength`.
- An exception thrown in an async handler is an unhandled rejection; wrap handlers or use a framework that catches them.

### Request bodies, limits and parsing
<!-- level: intermediate; ref: https://nodejs.org/api/http.html#class-httpincomingmessage -->
A request body arrives as a stream of chunks. To parse JSON you collect the chunks, concatenate, decode and parse — but a production-grade implementation also needs:

- A size limit, enforced while reading, so a client cannot exhaust memory with a giant body.
- Content-Type checking, to reject unexpected formats.
- Error handling for malformed JSON (respond with 400, not crash).
- Timeouts for clients that send bodies very slowly (slowloris-style attacks); Node's `server.requestTimeout` (default 300 s since Node 18) and `headersTimeout` help.
- Streaming to disk for file uploads instead of buffering (multipart parsers like busboy).

Frameworks provide body parsers with these features, but you should know what they do and configure their limits.

```js
const MAX_BYTES = 1_000_000;

export async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw Object.assign(new Error('Expected JSON'), { status: 415 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) {
      req.destroy();                       // stop receiving
      throw Object.assign(new Error('Body too large'), { status: 413 });
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Malformed JSON'), { status: 400 });
  }
}
```

#### Pitfalls
- Trusting `content-length` alone for limits; chunked requests have no length header, so count bytes while reading.

### Making HTTP requests: fetch and undici
<!-- level: intermediate; ref: https://nodejs.org/api/globals.html#fetch -->
Node 18+ includes a global `fetch` (stable since Node 21), implemented by undici, a fast HTTP/1.1 client written for Node. It follows the web standard, so the same code runs in browsers and Node.

Server-side differences to keep in mind:

- There is no default overall timeout in practice for slow responses beyond undici's header and body timeouts (300 s each); pass `signal: AbortSignal.timeout(ms)`.
- Connection pooling and keep-alive are automatic per origin. For fine control (pool size, pipelining, proxies, mocking), use undici's `Agent` or `Pool` directly via the `undici` package and `setGlobalDispatcher` or the `dispatcher` option.
- Always consume or cancel the response body; unconsumed bodies keep connections busy and can exhaust the pool.
- Cookies are not stored automatically; there is no browser cookie jar or CORS in Node.

The older `http.request` / `https.request` APIs remain available for low-level control.

```js
export async function getJson(url, { timeoutMs = 5000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    await res.body?.cancel();             // release the connection
    throw new Error(`Upstream ${url} returned ${res.status}`);
  }
  return res.json();
}

// Custom pool settings with undici (npm install undici)
import { Agent, setGlobalDispatcher } from 'undici';
setGlobalDispatcher(new Agent({ connections: 50, keepAliveTimeout: 10_000 }));
```

#### Interview tip
- Mention that calling a slow upstream without a timeout ties up resources and can cascade into an outage; timeouts, retries with backoff and circuit breakers are standard resilience patterns.

### Keep-alive, agents and server timeouts
<!-- level: advanced; ref: https://nodejs.org/api/http.html#class-httpagent -->
Opening a TCP (and TLS) connection per request is expensive. HTTP keep-alive reuses connections across requests.

Client side: `http.Agent` manages pooled connections for `http.request`. Since Node 19, the global agent uses keep-alive by default. Key options: `maxSockets` (concurrent connections per host), `maxFreeSockets`, and `keepAliveMsecs`. `fetch` uses undici's own pool, not `http.Agent`.

Server side, several timeouts protect resources:

- `server.keepAliveTimeout` (default 5 s): how long an idle keep-alive connection stays open.
- `server.headersTimeout`: time allowed to receive complete headers.
- `server.requestTimeout`: time allowed to receive the whole request.
- `server.timeout` / `socket.setTimeout`: inactivity on a socket.

A classic production bug: a load balancer (for example AWS ALB with a 60 s idle timeout) reuses a connection that Node has just closed after its 5 s keep-alive timeout, producing intermittent 502 errors. The fix is to make Node's `keepAliveTimeout` longer than the load balancer's idle timeout, and `headersTimeout` slightly longer than that.

```js
import { createServer, Agent, request } from 'node:http';

const server = createServer(app);
server.keepAliveTimeout = 65_000;   // > ALB idle timeout (60 s)
server.headersTimeout = 66_000;     // must exceed keepAliveTimeout
server.requestTimeout = 30_000;
server.listen(8080);

// Dedicated agent for an internal service
const inventoryAgent = new Agent({ keepAlive: true, maxSockets: 100 });
request({ host: 'inventory.internal', path: '/stock', agent: inventoryAgent }, (res) => {
  res.resume();                     // consume the body so the socket is reused
}).end();
```

#### Pitfalls
- Not consuming a response body keeps the socket from returning to the pool, eventually stalling all requests to that host.

### HTTPS and TLS
<!-- level: intermediate; ref: https://nodejs.org/api/https.html -->
`node:https` is the HTTP API over TLS, and `node:tls` provides lower-level secure sockets. An HTTPS server needs a private key and certificate chain; a client verifies the server's certificate against trusted certificate authorities (Node bundles Mozilla's CA store, and recent versions can also use the system store with `--use-system-ca`).

In many deployments Node does not terminate TLS itself — a load balancer, reverse proxy (nginx, Envoy) or platform ingress handles certificates and forwards plain HTTP to Node. Node then must trust `X-Forwarded-*` headers only from that proxy (Express's `trust proxy` setting) to learn the real client IP and protocol.

When Node calls internal services that use a private CA, add the CA via the `ca` option or `NODE_EXTRA_CA_CERTS` — never disable verification.

```js
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';

createServer({
  key: readFileSync('/etc/tls/server.key'),
  cert: readFileSync('/etc/tls/server.crt'),
  minVersion: 'TLSv1.2',
}, app).listen(443);

// Mutual TLS client to an internal service
import { Agent, request } from 'node:https';
const agent = new Agent({
  ca: readFileSync('/etc/tls/internal-ca.pem'),
  cert: readFileSync('/etc/tls/client.crt'),
  key: readFileSync('/etc/tls/client.key'),
});
request({ host: 'payments.internal', path: '/health', agent }, (res) => res.resume()).end();
```

#### Pitfalls
- Setting `NODE_TLS_REJECT_UNAUTHORIZED=0` or `rejectUnauthorized: false` to "fix" certificate errors disables protection against man-in-the-middle attacks for the whole process.
