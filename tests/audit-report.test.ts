import { test } from 'node:test';
import assert from 'node:assert/strict';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;
test('load the notifier', async () => {
  mod = await import('../scripts/audit-report.mjs');
  assert.equal(typeof mod.render, 'function');
});

const report = {
  ranAt: '2026-11-04T03:31:00.000Z',
  judge: 'openai:qwen3-4b',
  apply: true,
  totals: { scanned: 4, pairsJudged: 2, contradictions: 1, duplicates: 0, applied: 1, judgeErrors: 0 },
  users: [
    {
      userId: 'ab',
      results: [
        { newer: 'aaaaaaaa-1', older: 'bbbbbbbb-2', similarity: 0.675, relation: 'contradiction', reason: 'model answered CONTRADICTION', applied: true },
        { newer: 'cccccccc-3', older: 'dddddddd-4', similarity: 0.519, relation: 'unrelated', reason: 'model answered UNRELATED', applied: false },
      ],
    },
  ],
};

test('a night that changed something is worth an email', () => {
  assert.equal(mod.shouldSend(report, 0), true);
  const { subject, body } = mod.render({ report, code: 0, host: 'vm1', reportPath: '/r.json' });
  assert.match(subject, /1 fact superseded/);
  assert.match(body, /Result: 1 fact superseded from 4 memories/);
  assert.match(body, /ab {2}contradiction {2}similarity 0\.675/);
  assert.match(body, /Report: \/r\.json/);
  assert.doesNotMatch(body, /unrelated.*->.*cccccccc/, 'unchanged pairs are not listed as changes');
});

test('a quiet night is silent unless asked', () => {
  const quiet = {
    ...report,
    totals: { ...report.totals, contradictions: 0, applied: 0 },
    users: [{ ...report.users[0], results: report.users[0].results.map((r) => ({ ...r, applied: false })) }],
  };
  assert.equal(mod.shouldSend(quiet, 0), false);
  assert.equal(mod.shouldSend(quiet, 0, true), true);
  const { body } = mod.render({ report: quiet, code: 0, host: 'vm1' });
  assert.match(body, /Nothing needed correcting/);
});

test('a failure is always worth an email, and says what to check', () => {
  for (const code of [2, 3, 4]) {
    assert.equal(mod.shouldSend(null, code), true);
    const { subject, body } = mod.render({ report: null, code, host: 'vm1' });
    assert.match(subject, new RegExp(`audit FAILED on vm1 \\(exit ${code}\\)`));
    assert.match(body, /journalctl -u memoria-audit/);
  }
});

test('pairs the judge could not answer are listed, not swallowed', () => {
  const broken = {
    ...report,
    totals: { ...report.totals, applied: 0, judgeErrors: 1 },
    users: [{ userId: 'ab', results: [{ newer: 'a', older: 'b', similarity: 0.7, relation: 'error', reason: 'the judge failed', applied: false, judgeError: 'timeout after 30000ms' }] }],
  };
  const { body } = mod.render({ report: broken, code: 0, host: 'vm1' });
  assert.match(body, /Pairs that could not be judged/);
  assert.match(body, /timeout after 30000ms/);
});
