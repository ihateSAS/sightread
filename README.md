# Sightread

**Ask a codebase anything. Change answers cite the file and line evidence.**

Built for the Cerebras × Kimi K3.1 Pro × OpenClaw weekend hackathon, Nov 21–22 2026.

---

## The idea

Most code assistants index a repository into chunks, embed them, and retrieve the
few that look relevant to your question. Sightread skips the index. It parses the
repository's own imports, then gives the model only the scoped evidence a
question resolves to, one prompt at a time.

Long context is headroom, not a paste buffer. Nothing ships the whole repository
to the model: a turn carries a scoped prompt and either the parsed evidence for
the file you asked about or a best-effort unaided prompt. On Express the local
graph covers 142 files and 160 internal imports, so the aided answer starts from
a real dependency list rather than a guess.

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

Sightread is also not a multi-agent world. It does not run agents that explore a
game, earn money, die, or breed by fitness. It runs one question twice, with and
without computed evidence, and counts how many downstream files the unaided model
named. The claim is about developer decisions, not simulation spectacle.

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

## How OpenClaw is used

OpenClaw is in the project, but the Ask panel does not route every question
through the OpenClaw agent loop. With `CEREBRAS_API_KEY` set, `/api/ask` and
`/api/ask/stream` call Cerebras directly so the page can report real first-token
time; the header chip shows the actual answering model and transport. The CLI
gateway/exec path remains for keyless setups and as a fallback, and the OpenClaw
provider patch, scoped `sightread` agent config, and repo-read skill ship with
the project for that path and for the hackathon harness requirement.

```bash
npm run gateway                 # optional: only for the OpenClaw CLI fallback
openclaw agent -m "<question>" \
  --agent sightread \
  --model cerebras/kimi-k3.1-pro \
  --thinking low --json
```

The direct path was a measured choice: on this machine the gateway spent 14–22s
of some turns in its own session store while the same prompt answered from the
provider in about 2s. That does not make the gateway the demo path. The demo
path is the direct stream; OpenClaw remains the configured harness and fallback
surface, and the UI says which transport answered.

Two skills ship with the project:

| Skill | What it does |
|---|---|
| `openclaw/skills/repo-read` | Forces citations (`file:line`), requires reading before answering, and forbids inventing implementation details. |
| `openclaw/skills/kimi-speed-lab` | Measures throughput honestly — server-side `completion_time` reported separately from wall clock. |

## The model

Kimi K3.1 Pro on Cerebras is the configured primary, registered as an
OpenAI-compatible provider in `openclaw/kimi-cerebras.patch.json5`:

- provider `cerebras` → `https://api.cerebras.ai/v1`
- configured primary `cerebras/kimi-k3.1-pro`
- direct-stream chain: Kimi K3.1 Pro first, then `cerebras/qwen-3.8-27b`, then `cerebras/gpt-oss-120b`
- `reasoning_effort` bounded to `low|medium|high|max` for K3.1 Pro — it rejects `none`

Kimi end-to-end is **pending capacity**: on the current key the provider still
returns `model_not_found` for `kimi-k3.1-pro`, so the fresh verified run answered
with `qwen-3.8-27b`. Treat every current speed number as qwen-fallback
measurements, not Kimi measurements. The page’s thinking selector applies to
non-qwen models; qwen is forced to reasoning off because it can spend a short
answer’s budget on hidden reasoning.

## Run it

```bash
export CEREBRAS_API_KEY=csk-...

openclaw config patch --file ./openclaw/kimi-cerebras.patch.json5
openclaw config patch --file ./openclaw/sightread-agent.patch.json5
mkdir -p skills && cp -R openclaw/skills/repo-read skills/repo-read
openclaw gateway restart                         # optional: CLI fallback only

./check-cerebras.sh                        # key, model inventory, tok/s, one turn
npm start                                  # http://localhost:8787 (auto-loads .env, Ask + Speed Race)
npm test                                   # run server/repo/env unit tests
```

With a Cerebras key present, `npm start` streams Ask directly from Cerebras and
does not need the gateway. The scoped OpenClaw agent config and skills are for
the CLI/gateway fallback path.

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

Working end to end on `cerebras/qwen-3.8-27b` while Kimi capacity is pending:
repo clone, parsed impact graph, paired answers, clickable citations, race panel,
TPS lab. `kimi-k3.1-pro` still returns `model_not_found` until the capacity
request is processed; the config lists it as the primary and the stream chain
uses the qwen fallback while it waits. Kimi speed numbers are **pending**, not
claimed.

Fresh verified run on `repos/expressjs__express`, Nov 20, on the qwen fallback
(configured model `cerebras/kimi-k3.1-pro`, answering model
`cerebras/qwen-3.8-27b`, transport `cerebras`):

| Run | First token | Wall | Downstream named |
|---|---|---|---|
| With graph | 0.23s | 0.38s | 21 of 100 |
| Without graph | 0.13s | 1.12s | 3 of 100 |

The graph resolves `lib/application.js` to 100 downstream files: one direct
importer at `lib/express.js:18` and 99 indirect across three levels. The aided
turn answered from that list and named 21 of them. The unaided turn was the same
model with no graph, asked to make its best guess from what it knows, and named
3 in this run. Coverage varies per run; the earlier Nov 18 run named 6 alone.
Coverage comes from `app/public/coverage.mjs`, the module the page imports, so
the number on screen is the number the tests check. The baseline is a real
attempt on purpose: handing it only a path invited "I have no file access",
which would inflate the gap without testing the graph.

Wall time is a range: the first ask after boot also pays the import parse, and
the unaided turn reaches its first token sooner because it has no graph to wait
for, then runs longer because it writes the list itself. A third question inside
the same minute can reach the Cerebras ceiling, so a demo asks one pair and
pauses before the next ask.

Three different numbers live in this project, and they measure different things:

| Path | What it measures | Fresh verified run |
|---|---|---|
| Speed Race panel (raw streaming) | first token, then a 600-token answer, same model both sides | 190ms first token, 405ms total, 1,482 tok/s wall |
| Speed Race panel, OpenRouter lane | the same 600 tokens, same model | 1,188ms first token, 2.55s total, 236 tok/s wall |
| Ask panel, aided turn | graph parsed locally, then the first streamed chunk | 230ms first token, 384ms total |
| Ask panel, unaided turn | same model, same question, no graph | 128ms first token, 1.12s total |

Treat these as one fresh run on the qwen fallback, not a promise for every run.
Kimi numbers remain pending capacity.

The Ask panel streams directly from Cerebras, so its first-token number is the
first delta the browser received, not an estimate. That is a measured choice:
on this machine the gateway spent 14-22s of every turn in its own session store
(its log shows `slow chat send ... preparation=14117ms` with multi-second
SQLite writes), while the same prompt answered from the provider in about 2s.
The answer needs no tools, no history and no workspace access, so the agent
runtime was adding cost without adding anything.

Each turn is timed in phases and printed by `npm start` as
`turn <model> ttft=...ms prepare=...ms {...}`: local preparation, request
headers, wait to first chunk, then streaming. That is how the gateway cost was
found, and it stays in the log so the next regression is attributable instead of
one unexplained number.

The model chain lives in the same stream helper: Kimi K3.1 Pro first,
qwen-3.8-27b next, gpt-oss-120b last. A model the provider does not list is
skipped and the next one answers, so the chain upgrades the moment Kimi appears.
The server still reconciles that chain at boot against the provider's model list
and reports the resolved model separately from `configuredModel`, so the page can
say plainly when the fallback answered. `/api/ask` still returns the whole
envelope for callers that do not stream.

The blind-spot turn uses the streaming route too, so it reports its own
first-token time in the pane instead of only a total.

The free tier still adds variance, and a retry costs a 60s wait, so the page
reports the number it measured rather than a best case. A paired run starts the
no-graph turn as soon as the parsed impact arrives, so both answers run at once.

A sub-second clip is almost always a streamed completion with a short answer.
Sightread can produce that number on the race panel, and it is the honest one to
put next to tok/s. The Ask panel measures a full streamed answer, and reports
both its first token and its total on screen.

The public Cerebras tier allows 30,000 tokens/minute and counts the requested
output against it. The provider config therefore asks for 4,096 output tokens,
memory-core is off, and `/api/ask` stops a turn at `SIGHTREAD_DEADLINE_MS`
rather than waiting out the harness retry ladder. A rate limit arrives as HTTP
429 with a retry hint, not as a hang or a vague 502.

Not yet proven: `kimi-k3.1-pro` end to end, and the 60s video does not exist yet.

## License

MIT — see `LICENSE`.


