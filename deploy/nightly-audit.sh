#!/usr/bin/env bash
# Nightly contradiction audit: wait for the judge, sweep every user, keep the report.
#
# Run by memoria-audit.service (which starts and stops the 4B judge around it), so
# the model is resident for a couple of minutes a day instead of always.
#
#   MEMORIA_AUDIT_MAX_CALLS=40   judge calls per user per night (a cost ceiling)
#   MEMORIA_AUDIT_LIMIT=200      newest rows per user to consider
#   MEMORIA_AUDIT_REPORT_DIR=…   where audit-YYYY-MM-DD.json lands
#   MEMORIA_AUDIT_SKIP_HEALTH=1  for a remote judge that has no /health
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:${PATH}"
REPO="${MEMORIA_REPO:-/home/exedev/memoria}"
JUDGE_URL="${MEMORIA_JUDGE_BASE_URL:-http://127.0.0.1:8085/v1}"
REPORT_DIR="${MEMORIA_AUDIT_REPORT_DIR:-$REPO/data/audit}"
MAX_CALLS="${MEMORIA_AUDIT_MAX_CALLS:-40}"
LIMIT="${MEMORIA_AUDIT_LIMIT:-200}"
WAIT_S="${MEMORIA_AUDIT_WAIT_S:-240}"

# Optional: start the judge here and stop it afterwards (MEMORIA_AUDIT_MANAGE_JUDGE=1).
# Owning the process beats asynchronously stopping a systemd unit that this unit
# Requires= — that pattern either needs polkit or deadlocks against its own stop job —
# and it also works under plain cron, in a container, or with no systemd at all.
JUDGE_PID=""
cleanup() {
  if [[ -n "$JUDGE_PID" ]]; then
    kill "$JUDGE_PID" 2>/dev/null || true
    wait "$JUDGE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ "${MEMORIA_AUDIT_MANAGE_JUDGE:-0}" == "1" ]] && ! curl -fsS -m 2 "${JUDGE_URL%/v1}/health" >/dev/null 2>&1; then
  server="${MEMORIA_LLAMA_SERVER:?MEMORIA_LLAMA_SERVER is required when MEMORIA_AUDIT_MANAGE_JUDGE=1}"
  weights="${MEMORIA_LLAMA_JUDGE_MODEL:?MEMORIA_LLAMA_JUDGE_MODEL is required when MEMORIA_AUDIT_MANAGE_JUDGE=1}"
  port="${MEMORIA_AUDIT_JUDGE_PORT:-8085}"
  echo "loading $(basename "$weights") on port $port"
  "$server" -m "$weights" -c 4096 --host 127.0.0.1 --port "$port" -t "${MEMORIA_AUDIT_JUDGE_THREADS:-2}" \
    --jinja --no-webui >>"${MEMORIA_AUDIT_REPORT_DIR:-/tmp}/judge.log" 2>&1 &
  JUDGE_PID=$!
fi

if [[ "${MEMORIA_AUDIT_SKIP_HEALTH:-0}" != "1" ]]; then
  # /health answers 503 until the weights are loaded, so this waits for the model
  # rather than for the port. Without it the first call races the load and fails.
  deadline=$(( SECONDS + WAIT_S ))
  until curl -fsS -m 5 "${JUDGE_URL%/v1}/health" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "judge at ${JUDGE_URL} did not become healthy within ${WAIT_S}s" >&2
      notify 3 ""
      exit 3
    fi
    sleep 2
  done
fi

# Email, if asked: on a failure always, on a night that changed something, otherwise
# silent. A notification that cannot be sent never changes the audit's exit code.
notify() {
  [[ -n "${MEMORIA_AUDIT_EMAIL_TO:-}" ]] || return 0
  ( cd "$REPO" && node scripts/audit-report.mjs "$2" "$1" ) || true
}

mkdir -p "$REPORT_DIR"
day=$(date +%F)
tmp=$(mktemp "$REPORT_DIR/.audit-XXXXXX")

set +e
(cd "$REPO" && npx --no-install tsx scripts/contradictions.ts --apply --json \
   --limit "$LIMIT" --max-calls "$MAX_CALLS") >"$tmp" 2>"$REPORT_DIR/audit-${day}.err"
code=$?
set -e

# a healthy run leaves stderr empty; an empty file is noise in the report directory
[[ -s "$REPORT_DIR/audit-${day}.err" ]] || rm -f "$REPORT_DIR/audit-${day}.err"

if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$tmp" >/dev/null 2>&1; then
  mv "$tmp" "$REPORT_DIR/audit-${day}.json"
  report=$REPORT_DIR/audit-${day}.json
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const t = r.totals;
    console.log(`audit ${r.apply ? "applied" : "report only"} · ${t.scanned} memories · ${t.pairsJudged} pairs judged · ${t.contradictions} contradictions · ${t.duplicates} duplicates · ${t.applied} superseded · ${t.judgeErrors} errors`);
  ' "$REPORT_DIR/audit-${day}.json"
else
  # An unparseable report is itself the finding: keep it as evidence.
  mv "$tmp" "$REPORT_DIR/audit-${day}.bad.json"
  report=$REPORT_DIR/audit-${day}.bad.json
  echo "audit produced no parseable report (exit ${code}); see ${REPORT_DIR}/audit-${day}.err" >&2
  [[ $code -eq 0 ]] && code=4
fi

notify "${code:-0}" "${report:-}"
find "$REPORT_DIR" \( -name 'audit-*.json' -o -name 'audit-*.bad.json' -o -name 'audit-*.err' \) -type f -mtime +30 -delete 2>/dev/null || true
exit "$code"
