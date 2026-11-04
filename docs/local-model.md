# Running the judge on a local model

A contradiction judge that leaves the machine is a dependency, a bill and a data
egress at once. It does not have to: the task is a four-way classification of two
short sentences, and a 1.7B model in Q4 does it in about a second on two cores.

Everything below was measured on this VM (2 vCPU AMD EPYC, 7 GB RAM, no GPU,
Ubuntu 24.04, llama.cpp built from source).

## The configuration

| Piece | Value |
| --- | --- |
| Runtime | `llama-server` from llama.cpp, built with `-DGGML_NATIVE=ON` |
| Model | `Qwen3-1.7B` Q4_K_M, 1.11 GB |
| Protocol | `MEMORIA_JUDGE_FORMAT=letters` — one letter per candidate |
| Thinking | `MEMORIA_JUDGE_NO_THINK=1` (`/no_think` in the user turn) |
| Latency | **mean 926 ms, p50 909 ms, p95 1370 ms** per judgement |

## What the measurements say

Sixteen labelled pairs (six contradictions, three duplicates, three refinements,
four unrelated), scored with `npm run judge:calibrate`:

| Model / protocol | Answer valid | Relation correct | Contradiction recall | Precision | Mean latency |
| --- | --- | --- | --- | --- | --- |
| Qwen2.5-1.5B Q4 · JSON | 81% | 44% | 50% | 75% | 2.6 s |
| Qwen2.5-1.5B Q4 · word | 100% | 31% | **0%** | — | 0.9 s |
| **Qwen3-1.7B Q4 · letters** | **100%** | **75%** | **4/6 (67%)** | **4/4 (100%)** | **0.9 s** |
| Qwen3-1.7B Q4 · word | 100% | 87% (8-pair set) | — | — | 3.3 s |
| Qwen3-1.7B Q4 · two yes/no gates | 100% | 3/8 | 0% | — | 3.7 s |
| Qwen3-4B-Instruct-2507 Q4 · letters | **100%** | **10/10 contradictions** | **100%** | **100%** | 2.6 s |

Two conclusions worth carrying:

1. **The 1.5B could not do it.** It collapsed onto one label ("refines" for
   everything) and never contradicted anything, at any prompt. A model that always
   says "no action" is worse than no judge, because it looks like it works.
2. **Precision is what matters inline, and it was 100%.** It never invalidated a
   fact that should have stayed. Recall of 67% means one contradiction in three is
   missed — those facts simply both stay, which is the old behaviour, not a new bug.

The letter protocol is the fastest and the most accurate of the four framings tried;
the JSON envelope was the main source of failure on small models, so it is not the
default. Keep `MEMORIA_JUDGE_FORMAT=json` for a model big enough to keep a candidate
list straight.

## Two models, and when each is right

The sweep (`npm run judge:sweep`) embeds 29 labelled pairs, judges the ones that
clear the lowest floor, and reports both stages per floor. Contradictions caught, of
ten:

| Candidate floor | Qwen3-1.7B catch | Qwen3-4B-Instruct-2507 catch | Precision (both) | False supersedes | Calls per pair |
| --- | --- | --- | --- | --- | --- |
| 0.35 | 6/10 | **10/10** | 100% | 0 | 1.00 |
| 0.40 | 6/10 | **10/10** | 100% | 0 | 0.93 |
| 0.45 | 6/10 | **10/10** | 100% | 0 | 0.86 |
| 0.50 (default) | 6/10 | **10/10** | 100% | 0 | 0.86 |
| 0.55–0.65 | 6/10 | **10/10** | 100% | 0 | 0.79 |
| 0.70 | 5/10 | 7/10 | 100% | 0 | 0.66 |
| 0.75 | 4/10 | 6/10 | 100% | 0 | 0.59 |

Three conclusions:

1. **The floor is not the lever.** Every contradiction already *reaches* the judge at
   0.35 — 10/10. What the 1.7B loses, it loses in judgement, not in retrieval. Lower
   floors only buy extra calls. 0.60 is the cost-optimal point (same recall as 0.50,
   ~8% fewer calls); 0.70 starts losing reach.
2. **The 4B is the recall fix**, and it is not a small one: 6/10 → 10/10 for
   +1.7 s per judgement and +1.4 GB of RAM.
3. **Precision was 100% in every configuration** — not one false supersede in 29
   pairs × 9 floors × 2 models. That is the number that makes this safe to enable;
   a miss keeps both facts, a false positive would delete a true one.

| Use | Model | Latency (2 cores) | Recall | RAM |
| --- | --- | --- | --- | --- |
| Inline, every write | Qwen3-1.7B Q4 (`llama-judge.service`, :8082) | **0.9 s** (p95 1.4 s) | 60% | 1.2 GB |
| Backfill and audit | Qwen3-4B-Instruct-2507 Q4 (`llama-judge-4b.service`, :8085) | **2.6 s** (p50 2.59, max 2.73) | **100%** | 2.6 GB |

The 4B unit is not enabled at boot — start it for a sweep, stop it after:

```sh
sudo systemctl start llama-judge-4b
MEMORIA_JUDGE_BASE_URL=http://127.0.0.1:8085/v1 MEMORIA_JUDGE_MODEL=qwen3-4b \
  npm run contradictions -- --apply
sudo systemctl stop llama-judge-4b
```

The sweep also found a defect worth remembering: the 1.7B called *"three children" →
"two children"* a **duplicate** at similarity 0.911. Duplicate used to mean "discard
the new text", which would have kept the false fact and dropped the true one. A
duplicate now **supersedes** — identical outcome for a genuine duplicate (one
current fact, the newer wording), correct for a mislabelled contradiction.

## Nightly audit — where the 4B actually belongs

Inline judgement costs 0.9 s on a write and catches 60% of contradictions. The
same store audited nightly by the 4B catches **10/10** and costs nothing while you
are typing. That is the arrangement worth running: the inline judge stops facts from
rotting in the common case, the nightly pass catches what it missed.

```sh
sudo install -m 644 deploy/memoria-audit.service deploy/memoria-audit.timer \
                      deploy/llama-judge-4b.service /etc/systemd/system/
sudo mkdir -p /etc/memoria
sudo install -m 600 -o root -g root deploy/memoria-audit.env.example /etc/memoria/audit.env
sudoedit /etc/memoria/audit.env          # MEMORIA_DB_PATH, judge URL, ceilings
sudo systemctl daemon-reload
sudo systemctl enable --now memoria-audit.timer
```

What happens at 03:30 (spread by up to 30 minutes, `Persistent=true` so a VM that
was off catches up):

1. `nightly-audit.sh` starts `llama-server` with the 4B weights itself
   (`MEMORIA_AUDIT_MANAGE_JUDGE=1`) and waits on `/health` — it answers 503 until the
   weights are in, so the first call never races the load.
2. Every user with current memories is swept: newest 200 rows, at most 40 judge
   calls each, `--apply`, so a contradiction supersedes the older fact and leaves a
   `contradicts` edge.
3. The JSON report lands in `data/audit/audit-YYYY-MM-DD.json`; `.err` files hold
   stderr; everything older than 30 days is deleted.
4. The script exits, its `EXIT` trap kills the model. **The 4B is resident for about
   half a minute a day, not always.**

Why the script owns the process instead of systemd starting a unit and stopping it
afterwards: the first version did the latter (`Requires=llama-judge-4b.service` plus
an `ExecStopPost` that ran `systemctl stop`). It failed twice — as user `exedev` a
nested `systemctl` needs polkit ("Interactive authentication required"), and adding
`sudo -n` made systemd queue a stop against a unit it was itself stopping, which
hung the unit mid-exit. Forking the model from the script has no such coupling, needs
no privileges, and works under plain cron or in a container. `llama-judge-4b.service`
still exists for the other case: start it by hand for a long sweep and set
`MEMORIA_AUDIT_MANAGE_JUDGE=0`.

Cost: 40 calls × 2.6 s ≈ 105 s per user per night, on an idle CPU (`Nice=10`,
`IOSchedulingClass=idle`), plus embedding the store's current rows.

### Reading the result

```sh
systemctl list-timers memoria-audit.timer
journalctl -u memoria-audit -n 20
jq '.totals' data/audit/audit-$(date +%F).json
```

Exit codes are chosen so that `systemctl --failed` means something:

| Exit | Meaning |
| --- | --- |
| 0 | Ran; any number of contradictions found and applied |
| 2 | Every judged pair errored — the judge is up but unusable |
| 3 | The judge never became healthy within `MEMORIA_AUDIT_WAIT_S` (default 240 s) |
| 4 | The run produced no parseable report; the output is kept as `*.bad.json` |

### It emails you when the night was interesting

`scripts/audit-report.mjs` renders the report as plain text and sends it through the
exe.dev mail gateway (`http://169.254.169.254/gateway/email/send`, which only accepts
recipients who are you, your team, or someone who has used the VM). The rule is chosen
so an email always means something:

| Night | Email |
| --- | --- |
| A fact was superseded | **yes** — subject names the count, body lists each pair with its similarity and the judge's one-line reason |
| The audit failed (exit 2/3/4) | **yes** — subject says FAILED, body says what to check |
| Nothing needed correcting | no — unless `MEMORIA_AUDIT_EMAIL_ALWAYS=1` |

```sh
MEMORIA_AUDIT_EMAIL_TO=you@example.com          # in /etc/memoria/audit.env
node scripts/audit-report.mjs data/audit/audit-2026-11-04.json 0   # send by hand
```

A notification that cannot be sent is logged and never changes the audit's exit code —
the report file and the journal are still the source of truth.

Run it by hand any time (it starts and stops the model itself):

```sh
sudo systemctl start memoria-audit.service && journalctl -u memoria-audit -n 5
```

Report-only, without the timer, when you want to look before anything moves:

```sh
npm run contradictions -- --limit 200 --max-calls 40
```

## Install

```sh
# 1. build the server once (about 6 minutes on two cores)
git clone --depth 1 https://github.com/ggml-org/llama.cpp ~/llm/llama.cpp
cmake -B ~/llm/llama.cpp/build -S ~/llm/llama.cpp -DCMAKE_BUILD_TYPE=Release \
  -DGGML_NATIVE=ON -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_CURL=OFF -DLLAMA_BUILD_SERVER=ON
cmake --build ~/llm/llama.cpp/build --target llama-server -j2

# 2. the model (1.11 GB)
mkdir -p ~/llm/models && curl -fL -o ~/llm/models/qwen3-1.7b-q4_k_m.gguf \
  https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf

# 3. run it as a service
sudo cp deploy/llama-judge.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now llama-judge
curl -s localhost:8082/health   # {"status":"ok"}
```

## Point Memoria at it

```sh
MEMORIA_JUDGE_MODEL=qwen3-1.7b
MEMORIA_JUDGE_BASE_URL=http://127.0.0.1:8082/v1
MEMORIA_JUDGE_FORMAT=letters
MEMORIA_JUDGE_NO_THINK=1
MEMORIA_JUDGE_TIMEOUT_MS=30000
MEMORIA_CONTRADICTION_FLOOR=0.5
```

Then, before letting it touch anything real, calibrate it on your own pairs:

```sh
npm run judge:calibrate            # 16 hard pairs, ~15 s on this hardware
npm run contradictions             # report-only sweep of what is already stored
npm run contradictions -- --apply  # once the report looks right
```

## Embeddings too — and why it matters for the judge

A second `llama-server` (`deploy/llama-embeddings.service`, port 8083) serves
`nomic-embed-text-v1.5` in Q8: 768 dimensions, 146 MB, **198 ms for a two-text
batch** on this VM.

```sh
MEMORIA_EMBED_PROVIDER=openai
MEMORIA_EMBED_BASE_URL=http://127.0.0.1:8083/v1
MEMORIA_EMBED_MODEL=nomic-embed-text-v1.5
# leave MEMORIA_EMBED_DIM unset: the dimension is learned from the first vector
```

The embedder is not a side note here — **it decides whether the judge ever sees the
candidate.** Measured on the same two sentences:

| Embedder | cosine("lives in Brooklyn", "moved to Queens in March 2026") | candidate at floor 0.5? |
| --- | --- | --- |
| offline hashing (lexical) | ~0.1 | no — the judge is never called |
| nomic-embed-text-v1.5 | **0.734** | yes — judged and superseded |

End to end on this VM, with both local services:

```
write 1  "lives in Brooklyn and works at Acme"        167 ms   (no candidates yet)
write 2  "moved to Queens in March 2026"              963 ms   contradiction -> superseded B
write 3  "now works at Stripe as a staff engineer"   1030 ms   judged unrelated -> missed
write 4  "the gateway listens on port 9527"            52 ms   no candidates
graph 4 nodes / 1 edge (contradicts) · history keeps the superseded row
```

So: **~1 s per write with a candidate, ~50–170 ms without**, one contradiction caught
and one missed in this sample — which is the 67% recall from the calibration table,
not a surprise.

## Limits, honestly

- **67% recall** on contradictions is not a correctness guarantee. Facts it misses
  stay, and the audit pass is how you catch them later.
- **~0.9 s added to every write** that has a candidate. If that is too slow for an
  interactive path, judge at import/audit time instead and leave inline judgement
  off; the two use the same code path.
- **A 3B–4B model** will recall more and cost 2–3× the latency. Measure before
  switching: `npm run judge:calibrate` takes fifteen seconds.
- **This is one machine's numbers.** A different CPU (or any GPU) changes them by
  an order of magnitude, which is why the calibration script ships with the code.
