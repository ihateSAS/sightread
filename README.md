# Sightread

**Ask a codebase anything. Every answer cites the file and line it came from.**

Built for the Cerebras × Kimi K3.1 Pro × OpenClaw weekend hackathon, Nov 21–22 2026.

---

## The idea

Most code assistants index a repository into chunks, embed them, and retrieve the
few that look relevant to your question. Sightread skips the index. It parses the
repository's own imports, then hands a scoped OpenClaw agent the files a question
actually needs, one tool call at a time.

The 1M-token window is headroom, not a paste buffer. Nothing ships the whole
repository to the model: a turn carries a scoped system prompt and either the
parsed evidence for the file you asked about, or the handful of files the agent
chose to open. On Express the local graph covers 142 files and 160 internal
imports, so the agent starts from a real dependency list rather than a guess.

That is the product thesis: the graph is computed, the reading is scoped, and the
model narrates only what it can cite.

## What this is not

Computed change impact is not new, and Sightread did not invent it. There is a
cluster of local graph tools that already answer "what breaks if I change this"
from parsed code, usually as MCP servers or CLIs for coding agents:

- [codebase-index](https://github.com/denfry/codebase-index) predicts change
  impact with file:line evidence and labels its graph coverage.
- [code-review-graph](https://github.com/tirth8205/code-review-graph) builds a
  Tree-sitter graph of callers, dependents and tests, then scores the risk.
- [repograph-codeintel](https://pypi.org/project/repograph-codeintel/) returns
  dependents with evidence, confidence labels and explicit blind spots.
- [code-graph-mcp](https://github.com/sdsrss/code-graph-mcp) and
  [tree-sitter-analyzer](https://github.com/aimasteracc/tree-sitter-analyzer) do
  transitive call-graph impact as agent tools.

Several are deeper than this project. They parse symbols and calls with
Tree-sitter, cover more languages, track test impact and report what their graph
cannot see. Sightread walks file-level imports only: JavaScript and TypeScript
`import`/`require` edges, plus relative Python imports. Everything else is
counted as a file but contributes no edges. It cannot see a function call inside
an imported module, and it has nothing to say about dynamic imports. That is a
real limit, not a design virtue.

Repo Q&A with citations is table stakes too. The difference this project can
defend is narrower: every change question is answered twice, once with the
computed evidence in the prompt and once without it, and both answers stay on
screen. The unaided run is the baseline. The UI counts how many of the graph's
files it named, so the gap between what the model works out alone and what the
graph knows is a number instead of a footnote.

The graph itself is in `app/lib/impact.mjs`: it parses import statements, resolves
relative specifiers against files that exist, and walks dependents outward. The
panel lists direct importers with the line their import sits on, then indirect
ones by hop distance. No model touches it, so it cannot invent an edge. The model
explains the list; it does not produce it.

### What the counts mean

`142 files · 160 imports parsed` is the parser's inventory, not the repository's
size. It counts source files only (JS, TS, Python, Go, Rust, and the rest of the
extension list), skips `node_modules`, `.git`, build output, and any nested clone,
and counts only relative imports that resolve to a file inside the repo. Bare
packages and `node:` builtins are not edges, because they are not part of the
change surface. A small app shows a small number, which is the point: every arrow
on screen is a line you can open.

The ask flow uses the same evidence, under a strict rule: a change verb alone buys
nothing. The impact list is injected into the agent prompt inside a
`<computed_impact>` block only when the question also names a file that resolves
in this repository, or when you picked one in the panel. The hub ranking is
reserved for questions that ask which files matter. Everything else does no graph
work at all, so ordinary reads keep their latency.

When the rule applies and evidence exists, the server is asked twice: the normal
turn, then a second turn with `impact:false` and no computed block. The second
answer is rendered under the first and compared against the graph. That is the
feature, and it is why a change question costs two agent turns rather than one.

## How OpenClaw is load-bearing

This is not a chat wrapper around a completion endpoint. Every question is a real
OpenClaw agent turn:

```bash
npm run gateway                 # sources .env, runs the gateway
openclaw agent -m "<question>" \
  --agent sightread \
  --model cerebras/kimi-k3.1-pro \
  --thinking low --json
```

A warm gateway is deliberate. `agent exec` starts a fresh process per question and
costs **4.5–5.0s** before the model is called; routing through a running gateway
brought a median turn from **3,846ms to 2,041ms**, and the scoped `sightread` agent
(in `openclaw/sightread-agent.patch.json5`) cut the system prompt from **18,447 to
10,157 tokens** by carrying one skill instead of twenty-five.

Both answers are real agent turns from the same scoped agent, which carries no
skills and no open-ended tool loop. `--json` returns a stable envelope — `final`,
`usage`, `toolSummary`, `assistantTurns`, `sessionId` — which the UI renders
directly. The counters on screen are those numbers, not decoration: an answer
lands in one or two model calls, because the graph has already done the reading.
The unaided run is the identical turn minus the graph.

Two skills ship with the project:

| Skill | What it does |
|---|---|
| `openclaw/skills/repo-read` | Forces citations (`file:line`), requires reading before answering, and forbids inventing implementation details. |
| `openclaw/skills/kimi-speed-lab` | Measures throughput honestly — server-side `completion_time` reported separately from wall clock. |

## The model

Kimi K3.1 Pro on Cerebras, registered as an OpenAI-compatible provider in
`openclaw/kimi-cerebras.patch.json5`:

- provider `cerebras` → `https://api.cerebras.ai/v1`
- primary model `cerebras/kimi-k3.1-pro`, fallback `cerebras/gpt-oss-120b`
- `reasoning_effort` bounded to `low|medium|high|max` — K3.1 Pro rejects `none`

`--thinking low` is deliberate. This is a reading task; reasoning tokens are
latency you can't show on camera.

## Run it

```bash
export CEREBRAS_API_KEY=csk-...

openclaw config patch --file ./openclaw/kimi-cerebras.patch.json5
openclaw config patch --file ./openclaw/sightread-agent.patch.json5
mkdir -p skills && cp -R openclaw/skills/repo-read skills/repo-read
openclaw gateway restart

./check-cerebras.sh                        # key, model inventory, tok/s, one turn
npm start                                  # http://localhost:8787 (auto-loads .env, Ask + Speed Race)
npm test                                   # run server/repo/env unit tests
```

The scoped agent reads skills from this repo's `skills/` directory, not the global
one — that is what keeps the system prompt at ~10k tokens instead of ~18k.

Environment:

| Variable | Default | Purpose |
|---|---|---|
| `CEREBRAS_API_KEY` | — | required for any agent turn |
| `SIGHTREAD_MODEL` | `cerebras/gpt-oss-120b` | set to `cerebras/kimi-k3.1-pro` once preview access lands |
| `SIGHTREAD_DEADLINE_MS` | `45000` | hard stop for one turn, so a rate-limited retry cannot hold the request open |
| `PORT` | `8787` | |

## Layout

```
app/server.mjs                  HTTP server, no dependencies (Ask + Race + /api/file)
app/lib/                        .env loader, safe repo/citation reader, SSE race runner
app/public/index.html           Ask Repo + Speed Race UI with clickable citations
race/server.mjs                 standalone side-by-side race server (:8788)
openclaw/kimi-cerebras.patch.json5   provider + model config
openclaw/skills/                repo-read, kimi-speed-lab
test/app.test.mjs               node --test suite
check-cerebras.sh               pre-flight
PLAN.md                         the 24h plan and scoring strategy
SUBMISSION.md                   the Discord/Reddit/X submission copy
```

## Status

Working end to end on `cerebras/qwen-3.8-27b`: repo clone, parsed impact graph,
paired answers, clickable citations, race panel, TPS lab. `kimi-k3.1-pro` still
returns `model_not_found` until the capacity request is processed; the config
lists it as the primary model and the agent uses the fallback while it waits.

Measured on `repos/expressjs__express`, Nov 18, one paired run:

| Run | First token | Wall | Downstream named |
|---|---|---|---|
| With graph | 2.92s | 3.12s | 21 of 100 |
| Graph off | 1.46s | 1.98s | 3 of 100 |

The graph resolves `lib/application.js` to 100 downstream files: one direct
importer at `lib/express.js:18` and 99 indirect across three levels. The aided
turn answered from that list and named 21 of them. The unaided turn was the same
agent with no graph, asked to make its best guess from what it knows, and named
3. Coverage comes from `app/public/coverage.mjs`, the module the page imports,
so the number on screen is the number the tests check. The baseline is a real
attempt on purpose: handing it only a path invited "I have no file access",
which would inflate the gap without testing the graph.

Wall time is a range, not a constant: the first ask after a gateway restart took
7.2s, and later pairs landed at 3.2s and 1.9s. A third question inside the same
minute still reaches the ceiling, and then the turn spends its 45s deadline
waiting rather than answering, so a demo asks one pair and pauses before the
next ask.

Three different numbers live in this project, and they measure different things:

| Path | What it measures | Measured |
|---|---|---|
| Speed Race panel (raw streaming) | first token, then a 600-token answer, same model both sides | 278ms first token, 561ms total, 1,069 tok/s wall (2,045 tok/s server) |
| Speed Race panel, OpenRouter lane | the same 600 tokens, same model | 857ms first token, 5.14s total, 117 tok/s wall |
| Ask panel, aided turn | graph parsed locally, then a fresh bridge and the first streamed chunk | 2.07s first token, 2.31s total |
| Ask panel, unaided turn | same model, same question, no graph | 3.11s first token, 4.56s total |

The Ask panel streams through the ACP bridge (`openclaw acp`), so its
first-token number is the first delta the browser received, not an estimate.
The bridge is spawned per question, because ACP sessions on one bridge share a
gateway session: a word told to the first session was recalled by the second,
which would let the no-graph answer read the aided turn and destroy the
comparison. Isolation costs about 1.2s of each turn and is worth it. The bridge
honours the page's thought level through `session/set_mode`. ACP has no
per-session model override, so the `sightread` agent is pinned to
`cerebras/qwen-3.8-27b` in its own config; the model named on screen is that
config, not just the environment variable. `/api/ask` still returns the whole
envelope for callers that do not stream.

The free tier still adds variance, and a retry costs a 60s wait, so the page
reports the number it measured rather than a best case. A paired run starts the
no-graph turn as soon as the parsed impact arrives, so both answers run at once.

A sub-second clip is almost always a streamed completion with a short answer.
Sightread can produce that number on the race panel, and it is the honest one to
put next to tok/s. The ask panel measures a full agent turn, and reports both
its first token and its total on screen.

The public Cerebras tier allows 30,000 tokens/minute and counts the requested
output against it. The provider config therefore asks for 4,096 output tokens,
memory-core is off, and `/api/ask` stops a turn at `SIGHTREAD_DEADLINE_MS`
rather than waiting out the harness retry ladder. A rate limit arrives as HTTP
429 with a retry hint, not as a hang or a vague 502.

Not yet proven: `kimi-k3.1-pro` end to end, and the 60s video does not exist yet.

## License

MIT — see `LICENSE`.


