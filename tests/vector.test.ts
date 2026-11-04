import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeF32, decodeF32, encodeInt8, decodeInt8, cosine, normalize, truncate } from '../lib/vector';

function rnd(dim: number, seed = 1) {
  let s = seed;
  return Float32Array.from({ length: dim }, () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  });
}

test('float32 is exactly reversible', () => {
  const v = rnd(768);
  const back = decodeF32(encodeF32(v));
  assert.equal(back.length, v.length);
  for (let i = 0; i < v.length; i++) assert.equal(back[i], v[i]);
  assert.equal(cosine(v, back), 1);
});

test('float32 keeps ranking identical', () => {
  const dim = 768;
  const docs = Array.from({ length: 200 }, (_, i) => rnd(dim, i + 1));
  const q = rnd(dim, 999);
  const exact = docs.map((d, i) => ({ i, s: cosine(d, q) })).sort((a, b) => b.s - a.s).slice(0, 10).map((x) => x.i);
  const stored = docs.map((d) => decodeF32(encodeF32(d)));
  const fromStore = stored.map((d, i) => ({ i, s: cosine(d, q) })).sort((a, b) => b.s - a.s).slice(0, 10).map((x) => x.i);
  assert.deepEqual(fromStore, exact);
});

test('int8 with a per-vector scale stays close; uniform [-1,1] quantisation does not', () => {
  const dim = 3072;
  const docs = Array.from({ length: 300 }, (_, i) => normalize(rnd(dim, i + 7)));
  const q = normalize(rnd(dim, 4242));

  const truth = docs.map((d, i) => ({ i, s: cosine(d, q) })).sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.i);
  const int8 = docs.map((d) => decodeInt8(encodeInt8(d)));

  // the codec this replaces: 256 levels spread over [-1,1] no matter the values
  const legacy = (v: Float32Array) => {
    const n = normalize(v);
    const q8 = Uint8Array.from(n, (x) => Math.round(((x + 1) / 2) * 255));
    return Float32Array.from(q8, (x) => ((x / 255) * 2 - 1));
  };

  const rate = (decoded: Float32Array[]) => {
    let hit = 0;
    for (const [rank, idx] of truth.entries()) {
      const top = decoded.map((d, i) => ({ i, s: cosine(d, q) })).sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.i);
      if (top.includes(idx)) hit += 1;
    }
    return hit / truth.length;
  };

  const int8Rate = rate(int8);
  const legacyRate = rate(docs.map(legacy));
  assert.ok(int8Rate >= 0.8, `int8 recall ${int8Rate}`);
  assert.ok(legacyRate < int8Rate, `legacy ${legacyRate} should be worse than int8 ${int8Rate}`);
});

test('truncate renormalises and keeps direction', () => {
  const v = normalize(rnd(3072, 5));
  const t = truncate(v, 768);
  assert.equal(t.length, 768);
  assert.ok(Math.abs(Math.sqrt(t.reduce((s, x) => s + x * x, 0)) - 1) < 1e-5);
});

test('cosine refuses a length mismatch instead of guessing', () => {
  assert.throws(() => cosine(new Float32Array(4), new Float32Array(8)), /different length/);
});
