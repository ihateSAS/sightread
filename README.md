# Sightread

**Ask a codebase anything. Every answer cites the file and line it came from.**

Built for the Cerebras × Kimi K3.1 Pro × OpenClaw weekend hackathon, Nov 21–22 2026.

---

## The idea

Most code assistants index a repository into chunks, embed them, and retrieve the
few that look relevant to your question. Sightread doesn't retrieve — it **reads**.

Kimi K3.1 Pro carries a 1M-token context, and Cerebras serves it fast enough that
the whole repository, plus the agent's tool calls, fits inside one interaction.
The answer arrives while you're still framing the follow-up question.

That is the entire product thesis. Everything below exists to make it visible in
under sixty seconds.

## What the model does not do

Repo chat is crowded. CodeLens, Sherlock, GitLab Duo and CodeMap AI all put an
assistant in front of a codebase, and GitDiagram already turns a repository into
an architecture diagram with a narrated video. Answering questions well is table
stakes, not a differentiator.

So the second surface is **computed, not generated**. The change-impact map in
`app/lib/impact.mjs` parses real import statements, resolves relative specifiers
against the files that actually exist, and walks a file's dependents outward. The
panel lists direct importers with the line their import sits on, then indirect
ones by hop distance. No model touches that graph, so it cannot invent an edge.
The model's job is to explain the list, not to produce it.

That is the claim worth checking in a demo: every arrow on screen is a line you
can open.

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
openclaw gateway start          # once — stays warm
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

Working: repo clone, page, provider config, skill, TPS harness. The server answers
`/api/health` and serves the page.

**Not yet proven:** no agent turn has completed end-to-end against Cerebras,
because the API key is not in the environment. That is the next commit.

No performance numbers are claimed in this README. When there are some, they will
come from `kimi-speed-lab` with the run details attached, not from a vibe.

## License

MIT — see `LICENSE`.


