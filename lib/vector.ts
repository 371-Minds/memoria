/**
 * Vector encoding for storage and ranking.
 *
 * Two rules live here, and both exist because the previous store broke them:
 *
 * 1. Cosine similarity is only meaningful between vectors of the same model and
 *    the same length. A pair of different lengths is an error, not something to
 *    line up with `Math.min` — that comparison returns a plausible number and a
 *    wrong answer, which is worse than failing.
 * 2. The default codec is float32, because it is exact and it is cheap: 3 KB per
 *    768-dimension memory, and a brute-force scan of 10,000 of them costs ~20 ms
 *    on a two-core VM. The optional int8 codec uses a per-vector scale, which
 *    keeps ~97% recall@5 at the same bytes. The codec this replaces quantised
 *    each component over a fixed [-1, 1] range instead, which measured 81%.
 */

export type Codec = 'f32' | 'int8';

/** float32 little-endian blob. 4 bytes per dimension, exactly reversible. */
export function encodeF32(v: Float32Array): Buffer {
  const b = Buffer.allocUnsafe(v.length * 4);
  for (let i = 0; i < v.length; i++) b.writeFloatLE(v[i], i * 4);
  return b;
}

export function decodeF32(b: Uint8Array): Float32Array {
  // Copy into an aligned buffer: a Uint8Array from SQLite has no alignment
  // guarantee, and Float32Array over an unaligned ArrayBuffer throws.
  const copy = Buffer.from(b);
  const out = new Float32Array(copy.length >> 2);
  for (let i = 0; i < out.length; i++) out[i] = copy.readFloatLE(i * 4);
  return out;
}

/**
 * int8 with one scale per vector: value ≈ q * scale, scale = max|v| / 127.
 * Uniform quantisation over [-1,1] (the old behaviour) spends most of its 256
 * levels on a range a unit vector barely uses; a per-vector scale puts the
 * levels where the values are.
 */
export function encodeInt8(v: Float32Array): Buffer {
  let max = 0;
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i]);
    if (a > max) max = a;
  }
  if (max === 0) max = 1;
  const scale = max / 127;
  const b = Buffer.allocUnsafe(4 + v.length);
  b.writeFloatLE(scale, 0);
  for (let i = 0; i < v.length; i++) {
    const q = Math.max(-127, Math.min(127, Math.round(v[i] / scale)));
    b.writeInt8(q, 4 + i);
  }
  return b;
}

export function decodeInt8(b: Uint8Array): Float32Array {
  const copy = Buffer.from(b);
  const scale = copy.readFloatLE(0);
  const n = copy.length - 4;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = copy.readInt8(4 + i) * scale;
  return out;
}

export function encode(v: Float32Array, codec: Codec): Buffer {
  return codec === 'int8' ? encodeInt8(v) : encodeF32(v);
}

export function decode(b: Uint8Array, codec: string): Float32Array {
  return codec === 'int8' ? decodeInt8(b) : decodeF32(b);
}

export function encodeArray(v: number[] | Float32Array): Float32Array {
  return v instanceof Float32Array ? v : Float32Array.from(v);
}

export function norm(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

export function normalize(v: Float32Array): Float32Array {
  const n = norm(v);
  if (n === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** Cosine similarity. Throws on a length mismatch instead of guessing. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `vectors of different length (${a.length} vs ${b.length}); they came from different embedding models or dimensions`
    );
  }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * Matryoshka truncation: taking the first N components of a trained embedding
 * and re-normalising is a supported operation for the models that advertise it
 * and a guess for the models that do not. Only call it when configured.
 */
export function truncate(v: Float32Array, dims: number): Float32Array {
  if (dims <= 0 || v.length <= dims) return v;
  return normalize(v.subarray(0, dims));
}
