# Saturday Runbook

All times **PT**. Deadline is Sun 10:00 AM PT. Two irreversible things: the Friday form, and the submission links.

---

## Friday, before 7:00 PM PT

```bash
# 1. cloud.cerebras.ai → add payment method → copy Org ID
# 2. submit Org ID: https://forms.gle/qoG8ciAiogoSEVtM8
# 3. prove the key works
export CEREBRAS_API_KEY=csk-...
curl -s https://api.cerebras.ai/v1/models -H "Authorization: Bearer $CEREBRAS_API_KEY" \
  | python3 -m json.tool | grep '"id"'
```

If `kimi-k3.1-pro` is **not** in that list, that is expected before approval. `gpt-oss-120b` means you're live.

---

## 09:45 — Pre-flight (15 min)

```bash
cd ~/Desktop/home/kimi-hackathon
git pull
export CEREBRAS_API_KEY=csk-...
./check-cerebras.sh                # must print "harness green"
node app/server.mjs                # :8787 — leave running
node race/server.mjs               # :8788 — leave running
```

Open `http://localhost:8788` and press **Start** once. If both panes move, the video is safe.

---

## 10:00 — Kickoff Q&A. Ask these four, in this order

1. Exact model ID string for K3.1 Pro on my org?
2. TPS bounty: server-side `completion_time` or wall clock? Is `reasoning_effort` counted against me?
3. Does preview enforce a `contextWindow` below 1M?
4. Any restriction on tool-heavy agent loops given the RPM ceiling?

Answers go straight into `.env`. Do not guess the model ID later.

---

## 10:30 — Harness green (the only window with engineers awake)

```bash
openclaw skills install ./openclaw/skills/repo-read --global
openclaw skills install ./openclaw/skills/kimi-speed-lab --global
openclaw config patch --file ./openclaw/kimi-cerebras.patch.json5
# if the Q&A gave a different context_length, edit the patch first, then re-run
openclaw agent exec "List the top-level files and reply in one line." \
  --cwd . --model cerebras/kimi-k3.1-pro --thinking low --json
```

Green means: real text back, `toolSummary` populated, no 4xx. **If it isn't green by 12:30, drop to `gpt-oss-120b` and keep building.** A working demo on the public model beats a broken demo on the right one.

---

## 11:00 — Scope freeze

Write the one-sentence description now, then build only that:

> Paste a repo, ask a question, get a cited answer in ~2 seconds because it read the whole thing.

Anything not serving that sentence is cut. No auth, no database, no multi-repo.

---

## 12:00–16:00 — Build

```bash
# every time something works
git add -A && git commit -m "<what now works>"
```

Target at 16:00: paste URL → clone → ask → cited answer, ugly UI, no crashes.

---

## 16:00 — UI pass (2h)

Calm and expensive-looking on camera: big type, no clutter, no devtools, no tabs. The four numbers (time, turns, tool calls, tok/s) must be legible at 1080p.

---

## 18:00 — Post #1 on X

15-second clip of it working. Text like: *"24h to build this. Kimi K3.1 Pro on Cerebras, driven by OpenClaw. #KimiOnCerebras"*. Tag `@Cerebras` `@Kimi_Moonshot`. **No external link in the post** — repo goes in a reply.

Early posts bank impressions you can keep replying to Monday.

---

## 18:00–23:00 — Polish + fallback video

Record a scratch 60s now, even if rough. From here you always have something to submit.

---

## 23:00 — Sleep

Non-negotiable. A rested 7 AM take beats a fried 6 AM one.

---

## Sunday

| Time | Action |
|---|---|
| 06:00 | Only finish features if the demo already works. Otherwise change nothing. |
| 07:00 | Three takes of the 60s. Pick the most lopsided race. |
| 08:00 | Post to X, r/cerebras (flair **Kimi K3.1 Pro Hackathon**), Discord track channel. |
| 09:00 | Verify every link resolves logged-out. |
| 09:45 | Stop. Submit what exists. |
| Mon | Reply to every comment; post one follow-up clip. Impressions close Tue 10:00 AM PT. |

---

## Recording checklist

- [ ] 1080p, notifications off, fresh browser profile, one tab
- [ ] No key, no email, no `.env` anywhere in frame
- [ ] Both timers real, both panes from the same run
- [ ] Opens with the result, not a logo
- [ ] ≤60s, repo link + `#KimiOnCerebras` in the last 8 seconds

## If it breaks

| Symptom | Fix |
|---|---|
| `404 model not found` | model ID from Q&A, or fall to `gpt-oss-120b` |
| `401` | key not exported in this shell |
| right pane says `skip` | `OPENROUTER_API_KEY` unset — race runs unopposed, still recordable |
| `429` | slow down; you're on the public tier (form missed) |
| agent answers with no tool calls | `repo-read` not installed globally — re-run the install |
