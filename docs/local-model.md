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
