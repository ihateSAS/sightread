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

## How OpenClaw is load-bearing

This is not a chat wrapper around a completion endpoint. Every question is a real
OpenClaw agent turn:

```bash
openclaw agent exec "<question>" \
  --cwd <path-to-repo> \
  --model cerebras/kimi-k3.1-pro \
  --thinking low --json
```

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

openclaw skills install ./openclaw/skills/repo-read --global
openclaw skills install ./openclaw/skills/kimi-speed-lab --global
openclaw config patch --file ./openclaw/kimi-cerebras.patch.json5

./check-cerebras.sh          # key, model inventory, tok/s, one agent turn
node app/server.mjs          # http://localhost:8787
```

The `--global` install matters: the agent's working directory is the *target*
repository, so a workspace-local skill would not be discovered.

Environment:

| Variable | Default | Purpose |
|---|---|---|
| `CEREBRAS_API_KEY` | — | required for any agent turn |
| `SIGHTREAD_MODEL` | `cerebras/gpt-oss-120b` | set to `cerebras/kimi-k3.1-pro` once preview access lands |
| `PORT` | `8787` | |

## Layout

```
app/server.mjs                  HTTP server, no dependencies
app/public/index.html           the page
openclaw/kimi-cerebras.patch.json5   provider + model config
openclaw/skills/                repo-read, kimi-speed-lab
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


