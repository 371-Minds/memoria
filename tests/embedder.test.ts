import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * The adapters, against a fake server. The point is that "custom models" is a
 * configuration change, not a code change: each test speaks one of the wire
 * formats the embedder claims to support and asserts what comes back.
 */
let requests: { url: string; body: any; headers: any }[] = [];
let mode: 'openai' | 'tei' | 'gemini' | 'fail500' | 'fail400' = 'openai';
let dim = 8;

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ url: req.url || '', body, headers: req.headers });
    const reply = (status: number, obj: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const vec = (n = dim) => Array.from({ length: n }, (_, i) => (i % 2 ? 0.5 : -0.25));

    if (mode === 'fail500') return reply(500, { error: 'boom' });
    if (mode === 'fail400') return reply(400, { error: 'bad model name' });

    if (mode === 'openai') {
      const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
      const d = body.dimensions || dim;
      return reply(200, { data: inputs.map((_, i) => ({ index: i, embedding: vec(d) })) });
    }
    if (mode === 'tei') {
      const inputs: string[] = body.inputs;
      return reply(200, inputs.map(() => vec()));
    }
    // gemini
    return reply(200, { embeddings: body.requests.map(() => ({ values: vec(body.requests[0].outputDimensionality || dim) })) });
  });
});

const listen = () =>
  new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port)));

let port = 0;

test.before(async () => {
  port = await listen();
});

test.after(() => server.close());

const setEnv = (env: Record<string, string | undefined>) => {
  const e = process.env as Record<string, string | undefined>;
  for (const k of ['MEMORIA_EMBED_PROVIDER', 'MEMORIA_EMBED_BASE_URL', 'MEMORIA_EMBED_API_KEY', 'MEMORIA_EMBED_MODEL', 'MEMORIA_EMBED_DIM', 'MEMORIA_EMBED_TIMEOUT_MS']) delete e[k];
  Object.assign(e, env);
};

test('openai-compatible: batched input, sorted by index, key sent as bearer', async () => {
  const { embed } = await import('../lib/embedder');
  mode = 'openai';
  requests = [];
  setEnv({
    MEMORIA_EMBED_PROVIDER: 'openai',
    MEMORIA_EMBED_BASE_URL: `http://127.0.0.1:${port}/v1`,
    MEMORIA_EMBED_API_KEY: 'sk-test',
    MEMORIA_EMBED_MODEL: 'my-model',
    MEMORIA_EMBED_BATCH: '4',
  });
  const { vectors, info } = await embed(['a', 'b', 'c', 'd', 'e']);
  assert.equal(vectors.length, 5);
  assert.equal(info.id, 'openai:my-model');
  assert.equal(requests.length, 2, 'five texts at batch 4 is two requests');
  assert.equal(requests[0].url, '/v1/embeddings');
  assert.equal(requests[0].headers.authorization, 'Bearer sk-test');
  assert.equal(requests[0].body.model, 'my-model');
  assert.ok(Math.abs(Math.hypot(...vectors[0]) - 1) < 1e-6, 'vectors come back unit length');
});

test('openai-compatible: dimensions truncate and renormalise', async () => {
  const { embed } = await import('../lib/embedder');
  mode = 'openai';
  requests = [];
  setEnv({
    MEMORIA_EMBED_PROVIDER: 'openai',
    MEMORIA_EMBED_BASE_URL: `http://127.0.0.1:${port}/v1`,
    MEMORIA_EMBED_MODEL: 'my-model',
    MEMORIA_EMBED_DIM: '4',
  });
  const { vectors } = await embed(['hello']);
  assert.equal(vectors[0].length, 4);
  assert.ok(Math.abs(Math.hypot(...vectors[0]) - 1) < 1e-6);
});

test('tei: native /embed shape', async () => {
  const { embed } = await import('../lib/embedder');
  mode = 'tei';
  requests = [];
  setEnv({
    MEMORIA_EMBED_PROVIDER: 'tei',
    MEMORIA_EMBED_BASE_URL: `http://127.0.0.1:${port}`,
    MEMORIA_EMBED_MODEL: 'bge-m3',
  });
  const { vectors, info } = await embed(['x', 'y']);
  assert.equal(vectors.length, 2);
  assert.equal(info.id, 'tei:bge-m3');
  assert.equal(requests[0].url, '/embed');
  assert.deepEqual(requests[0].body.inputs, ['x', 'y']);
});

test('gemini: batchEmbedContents shape with the key in a header', async () => {
  const { embed } = await import('../lib/embedder');
  mode = 'gemini';
  requests = [];
  setEnv({
    MEMORIA_EMBED_PROVIDER: 'gemini',
    MEMORIA_EMBED_BASE_URL: `http://127.0.0.1:${port}/v1beta`,
    MEMORIA_EMBED_API_KEY: 'g-key',
    MEMORIA_EMBED_MODEL: 'gemini-embedding-001',
    MEMORIA_EMBED_DIM: '8',
  });
  const { vectors, info } = await embed(['one', 'two']);
  assert.equal(vectors.length, 2);
  assert.equal(info.id, 'gemini:gemini-embedding-001');
  assert.equal(requests[0].url, '/v1beta/models/gemini-embedding-001:batchEmbedContents');
  assert.equal(requests[0].headers['x-goog-api-key'], 'g-key');
});

test('a 400 is reported with the endpoint and the body', async () => {
  const { embed, EmbeddingError } = await import('../lib/embedder');
  mode = 'fail400';
  setEnv({ MEMORIA_EMBED_PROVIDER: 'openai', MEMORIA_EMBED_BASE_URL: `http://127.0.0.1:${port}/v1`, MEMORIA_EMBED_MODEL: 'nope' });
  await assert.rejects(() => embed(['x']), (e: unknown) => {
    assert.ok(e instanceof EmbeddingError);
    assert.match((e as Error).message, /400/);
    assert.match((e as Error).message, /bad model name/);
    return true;
  });
});

test('a 500 is retried, then reported as a sentence', async () => {
  const { embed } = await import('../lib/embedder');
  mode = 'fail500';
  requests = [];
  setEnv({ MEMORIA_EMBED_PROVIDER: 'openai', MEMORIA_EMBED_BASE_URL: `http://127.0.0.1:${port}/v1`, MEMORIA_EMBED_MODEL: 'm' });
  await assert.rejects(() => embed(['x']), /500/);
  assert.equal(requests.length, 3, 'two retries after the first attempt');
});

test('nothing configured means offline hashing, not a crash', async () => {
  const { embedderInfo } = await import('../lib/embedder');
  setEnv({});
  const info = embedderInfo();
  assert.equal(info?.provider, 'hash');
  assert.equal(info?.id, 'hash:lexical-hash');
});

test('provider none disables embeddings with an actionable message', async () => {
  const { embed, embedderInfo } = await import('../lib/embedder');
  setEnv({ MEMORIA_EMBED_PROVIDER: 'none' });
  assert.equal(embedderInfo(), null);
  await assert.rejects(() => embed(['x']), /MEMORIA_EMBED_PROVIDER=none/);
});
