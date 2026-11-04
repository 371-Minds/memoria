import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../lib/auth';

const req = (key?: string) =>
  new Request('http://localhost/api/x', key ? { headers: { authorization: `Bearer ${key}` } } : undefined);

test('no keys and production refuses instead of allowing everyone', () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { NODE_ENV: env.NODE_ENV, MEMORIA_API_KEY: env.MEMORIA_API_KEY };
  delete env.MEMORIA_API_KEY;
  delete env.MEMORIA_API_KEYS;
  delete env.MEMORIA_ALLOW_ANON;
  env.NODE_ENV = 'production';
  const r = authorize(req());
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 503);
    assert.match(r.error, /MEMORIA_ALLOW_ANON/);
  }
  env.NODE_ENV = saved.NODE_ENV;
  if (saved.MEMORIA_API_KEY === undefined) delete env.MEMORIA_API_KEY;
  else env.MEMORIA_API_KEY = saved.MEMORIA_API_KEY;
});

test('a key scoped to one user cannot read another', () => {
  const env = process.env as Record<string, string | undefined>;
  env.MEMORIA_API_KEYS = 'k_client_a=client_a,k_admin=*';
  delete env.MEMORIA_API_KEY;
  assert.equal(authorize(req('k_client_a'), 'client_a').ok, true);
  const wrong = authorize(req('k_client_a'), 'client_b');
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.status, 403);
  assert.equal(authorize(req('k_admin'), 'anyone').ok, true);
  assert.equal(authorize(req('nope'), 'client_a').ok, false);
  delete env.MEMORIA_API_KEYS;
});
