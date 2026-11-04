#!/usr/bin/env node
/**
 * Turn an audit report into an email, and decide whether it is worth sending.
 *
 *   node scripts/audit-report.mjs data/audit/audit-2026-11-04.json 0
 *
 * An audit that runs every night and says nothing is a job nobody reads. This sends
 * when something changed (a fact was superseded) or when something broke (a non-zero
 * exit), and stays quiet on a night that found nothing — unless MEMORIA_AUDIT_EMAIL_ALWAYS=1.
 *
 * Env:
 *   MEMORIA_AUDIT_EMAIL_TO       recipient; no value means no email at all
 *   MEMORIA_AUDIT_EMAIL_ALWAYS=1 also send the "nothing found" nights
 *   MEMORIA_EMAIL_ENDPOINT       default http://169.254.169.254/gateway/email/send
 */
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';

export const EXIT_MEANING = {
  0: 'ran to completion',
  2: 'every judged pair errored — the judge is up but useless',
  3: 'the judge never became healthy, so nothing was audited',
  4: 'the run produced no parseable report',
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function shouldSend(report, code, always = false) {
  if (code !== 0) return true;
  if (always) return true;
  return !!report && report.totals.applied > 0;
}

export function render({ report, code, host = hostname(), reportPath = null, errPath = null }) {
  const t = report?.totals;
  const failed = code !== 0;
  const subject = failed
    ? `memoria audit FAILED on ${host} (exit ${code})`
    : t.applied > 0
      ? `memoria audit ${report.ranAt.slice(0, 10)}: ${plural(t.applied, 'fact superseded', 'facts superseded')}`
      : `memoria audit ${report.ranAt.slice(0, 10)} on ${host}: nothing to correct`;

  const lines = [];
  lines.push(`Memoria nightly audit — ${host}`);
  lines.push('');
  if (failed) {
    lines.push(`Result: FAILED (exit ${code}) — ${EXIT_MEANING[code] || 'unknown failure'}`);
  } else if (t.applied > 0) {
    lines.push(`Result: ${plural(t.applied, 'fact superseded', 'facts superseded')} from ${plural(t.scanned, 'memory', 'memories')}`);
  } else {
    lines.push(`Result: nothing needed correcting in ${plural(t.scanned, 'memory', 'memories')}`);
  }
  if (report) {
    lines.push(`Judge: ${report.judge} · ${report.apply ? 'changes applied' : 'report only'}`);
    lines.push(
      `Corpus: ${plural(t.scanned, 'memory', 'memories')} scanned · ${plural(t.pairsJudged, 'pair', 'pairs')} judged · ` +
        `${t.contradictions} contradictions · ${t.duplicates} duplicates · ${t.judgeErrors} errors`
    );
  }
  lines.push('');

  const changed = (report?.users || []).flatMap((u) =>
    u.results.filter((r) => r.applied).map((r) => ({ u: u.userId, r }))
  );
  const problems = (report?.users || []).flatMap((u) =>
    u.results.filter((r) => r.judgeError).map((r) => ({ u: u.userId, r }))
  );

  if (changed.length) {
    lines.push('What changed');
    for (const { u, r } of changed.slice(0, 20)) {
      lines.push(`  ${u}  ${r.relation}  similarity ${r.similarity}  ${r.older.slice(0, 8)} -> ${r.newer.slice(0, 8)}`);
      if (r.reason) lines.push(`    ${r.reason}`);
    }
    if (changed.length > 20) lines.push(`  … ${changed.length - 20} more`);
    lines.push('');
  }
  if (problems.length) {
    lines.push('Pairs that could not be judged');
    for (const { u, r } of problems.slice(0, 10)) lines.push(`  ${u}  ${r.judgeError}`);
    lines.push('');
  }
  if (!changed.length && !failed) {
    lines.push('Nothing needed correcting. No email would normally be sent for a night like this.');
    lines.push('');
  }
  if (failed) {
    lines.push('What to check');
    lines.push(`  systemctl status memoria-audit`);
    lines.push(`  journalctl -u memoria-audit -n 50`);
    if (code === 3) lines.push('  curl -fsS ' + (process.env.MEMORIA_JUDGE_BASE_URL || 'http://127.0.0.1:8085/v1').replace(/\/v1$/, '') + '/health');
    lines.push('');
  }
  if (reportPath) lines.push(`Report: ${reportPath}`);
  if (errPath) lines.push(`Stderr: ${errPath}`);
  lines.push(`Journal: journalctl -u memoria-audit -n 50`);

  return { subject, body: lines.join('\n') + '\n' };
}

async function main() {
  const [reportPath, codeArg] = process.argv.slice(2);
  const code = Number(codeArg || 0);
  const to = process.env.MEMORIA_AUDIT_EMAIL_TO || '';
  const always = process.env.MEMORIA_AUDIT_EMAIL_ALWAYS === '1';

  let report = null;
  if (reportPath) {
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch {
      report = null;
    }
  }

  if (!to) {
    console.log('no MEMORIA_AUDIT_EMAIL_TO: not notifying');
    return;
  }
  if (!shouldSend(report, code, always)) {
    console.log('nothing to report: no email sent');
    return;
  }

  const endpoint = process.env.MEMORIA_EMAIL_ENDPOINT || 'http://169.254.169.254/gateway/email/send';
  const { subject, body } = render({ report, code, reportPath, errPath: reportPath ? reportPath.replace(/\.json$/, '.err') : null });
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to, subject, body }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    console.log(`emailed ${to}: ${subject}`);
  } catch (e) {
    // A failed notification must not change the audit's own exit code.
    console.error(`could not send email to ${to}: ${e instanceof Error ? e.message : e}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
