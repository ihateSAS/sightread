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
repository to the model: a turn carries a ~10k-token system prompt and the handful
of files the agent chose to open. On Express the local graph covers 142 files and
160 internal imports, so the agent starts from a real dependency list rather than
a guess.

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
defend is narrower: the computed evidence and the model's own answer sit on the
same screen, with a switch between them. Turning the graph off reruns the same
question with the same model and no `<computed_impact>` block, so the gap between
what the model works out alone and what the graph knows is visible instead of
buried in a footnote.

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

The agent decides what to look at, calls tools (`read`, `ls`, `rg` via the
harness), reads the results, and only then answers. `--json` returns a stable
envelope — `final`, `usage`, `toolSummary`, `assistantTurns`, `sessionId` — which
the UI renders directly. The "agent turns" and "tool calls" counters on screen are
those numbers, not decoration: if the agent had answered from memory without
reading, they would read zero and the demo would be a lie.

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

Working: repo clone, page, provider config written but not applied, skill, TPS
harness. The server answers `/api/health` and serves the page.

**Not yet proven:** no agent turn has completed end-to-end against Cerebras,
because the API key is not in the environment. That is the next commit.

No performance numbers are claimed in this README. When there are some, they will
come from `kimi-speed-lab` with the run details attached, not from a vibe.

## License

MIT — see `LICENSE`.


