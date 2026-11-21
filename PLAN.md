# Cerebras × Kimi K3.1 Pro × OpenClaw — 24h Hackathon Plan

**Event:** Sat Nov 21, 10:00 AM PT → Sun Nov 22, 10:00 AM PT (online, Cerebras Discord, `#kimi-k3.1-pro-hackathon`)
**Prize pool:** $5000 — 3 × $1000 (top organic impressions on X) · 1 × $1000 (top upvotes on r/cerebras) · $1000 (fastest TPS prompt)
**Non-negotiable requirement:** you must use the **OpenClaw harness**, with **Kimi K3.1 Pro on Cerebras** as a central component. Not "we used an OpenAI-compatible endpoint" — the OpenClaw agent loop has to be in the product.

### What the official rules doc says, verbatim

From the hackathon document (shorturl.at/csaGl):

- **"Do I have to use OpenClaw harness for my project? Yes, you need to use OpenClaw harness within your project."** The test is that OpenClaw is *within* the project, not that every screen routes through it.
- **"Pre-existing scaffolding, boilerplate code, and development frameworks are permitted. However, the core project and its functionality should be developed during the hackathon and must leverage Kimi K3.1 Pro running on Cerebras as a central component of the solution."**
- Demo video: max 60s, must show Cerebras speed, and a side-by-side against a GPU provider is *recommended*, not required.
- Elevated capacity is **100 RPM / 100K TPM**, not the public 30 RPM / 1M-per-day.
- The doc's model-ID answer is **blank** — the exact ID is confirmed at kickoff, so never hardcode a guess without checking `/v1/models`.
- Prizes are audience choice on X and Reddit plus a fastest-TPS bounty. There is no technical judging, so the video is the deliverable.

---

## 1. Read the scoring before you read the idea list

There is **no judged technical prize**. Every dollar is audience choice (impressions / upvotes) plus one speed bounty. That changes the job:

- A clever architecture nobody can see in a 60-second clip scores zero.
- A simple thing that *looks* impossible ("that answer rendered before I finished reading the question") scores.
- The competition is **distribution**, and it runs until **Tuesday 10:00 AM PT**. You post Sunday morning, then you keep working the thread Monday.

So: build for the 60-second video, not for the architecture diagram. The build still has to be real, but the demo is the product.

---

## 2. Hard deadlines — the one that can disqualify you

| When | What | Why it matters |
|---|---|---|
| **Now** | Sign up at [cloud.cerebras.ai](https://cloud.cerebras.ai), copy your **Org ID** (Default Project → All Projects → Settings) | Needed for the form below |
| **Fri Nov 20, 7:00 PM PT** | Submit Org ID via the [capacity request form](https://forms.gle/qoG8ciAiogoSEVtM8) | **Miss this and you get the public tier (30 RPM / 1M tokens-day) instead of 100 RPM / 100K TPM. No exceptions, they said so explicitly.** |
| Sat Nov 21, 10:00 AM PT | Kickoff + 30 min Q&A with the Cerebras product team | Ask the 4 questions in §7 |
| Sat 10:30 AM – 12:30 PM PT | Cerebras engineers live in Discord | Your only guaranteed debugging window. Have the harness green before this ends. |
| **Sun Nov 22, 10:00 AM PT** | Submission deadline (Discord + Reddit + X) | Luma is authoritative: Sat 21 → Sun 22. The Google Doc says "Sunday Nov 21" and "Monday, Sunday Nov 22" — both are typos. |
| Access retained until Mon Nov 23, 10:00 AM PT | — | Buffer for recording a better video / fixing a demo |
| **Tue Nov 25, 10:00 AM PT** | Impressions + upvotes counted | Your Sunday post is the seed; Monday is where the prize is won |

Team size: "as many as you want, recommend 2." Recruit one person whose job is the video + posting, not the code. That is the highest-ROI hire for this specific scoring.

---

## 3. Pre-flight (today → Friday)

Do all of this before Saturday. Scaffolding and boilerplate are explicitly allowed; the core has to be built in the 24h.

- [ ] **Org ID + capacity form submitted** (Fri 7 PM PT). This is the whole ballgame.
- [ ] `CEREBRAS_API_KEY` in your shell / `.env`. Verify with `./check-cerebras.sh`.
- [ ] Install the OpenClaw Cerebras provider + patch config: `openclaw plugins install @openclaw/cerebras-provider`, then both patches in `openclaw/` (provider, and the scoped `sightread` agent that keeps the prompt at ~10k tokens).
- [ ] Prove the loop end-to-end **tonight** against `gpt-oss-120b` (public, no approval needed) so that Saturday is only "swap model id", not "why doesn't this work".
- [ ] Install the `kimi-speed-lab` skill and run one TPS measurement on `gpt-oss-120b`. Baseline numbers today = a credible speed claim tomorrow.
- [ ] Register a throwaway demo repo + have a "GPU provider" key ready for the side-by-side. Pick one you can actually show being slower.
- [ ] Decide the project (§4). Don't decide it at 10:05 AM Saturday.
- [ ] X account warmed up: bio mentions the hackathon, pinned nothing, no locked replies. Reddit account old enough that r/cerebras doesn't filter the post.

---

## 4. Three project shapes, pick one

All three satisfy "OpenClaw harness + Kimi central". Ranked by demo-per-hour-of-build.

### A. Repo Time Machine — *recommended*
Drop a GitHub URL, ask anything about the codebase, get an answer with `file:line` citations in ~2 seconds. The 1M context is the trick: it isn't retrieving from an index, it's *reading*.

- **Why it wins:** the event's own copy is "refactoring legacy code, exploring new codebases." You are demoing the thing they asked for.
- **OpenClaw shape:** a skill with tools (clone, `rg`, read) that the agent loops over. Genuinely uses the harness rather than wrapping a chat completion.
- **60s clip:** paste a 200k-line repo → type "where does auth expire?" → answer lands with citations while the GPU column is still showing "thinking…".
- **Risk:** repo clone/parse eats your first 4 hours. Cap it: support one language, one repo, pre-cloned.

### B. Ops Copilot
Replay a log bundle / incident, agent finds the root cause and writes the postmortem chrome. Same harness, less impressive visually — text in, text out.

### C. Speed Arena
A UI that races Kimi-on-Cerebras against a GPU provider on the same prompt with live TPS counters. **Do not build this as the project** — it reads as a benchmark, not a product, and judges of "content quality" can smell a stunt. Instead, steal the overlay for the video of A or B (see §6).

**Decision rule:** if by 2:00 PM Saturday the chosen idea isn't showing something on screen, cut features until it does. A working narrow demo beats a broken ambitious one, always, in an impressions contest.

---

## 5. How OpenClaw actually gets harnessed

Three legitimate patterns. Pick per project shape.

**1. Chat-surface agent (native OpenClaw).**
Gateway + a channel (Discord/Telegram/WhatsApp/WebChat) + your custom skill. The product *is* an assistant in a chat app. Cheapest to build, and the demo video is just a screen recording of a chat — which is exactly the format that performs on X.

```bash
npm run gateway
openclaw channels add            # or: openclaw onboard
openclaw skills install ./openclaw/skills/kimi-speed-lab --global
```

**2. Warm gateway (what we actually use — the sidecar design was measured and dropped).**
Your app owns the interface; every turn is sent to an already-running Gateway, which runs the Kimi tool loop and returns JSON.

```bash
npm run gateway                       # once, stays warm
openclaw agent -m "Where does auth expire in repos/owner__name?" \
  --agent sightread \
  --model cerebras/kimi-k3.1-pro \
  --thinking low \
  --json
```

**Why not `agent exec`:** it starts a fresh process per question and paid **4.5–5.0s** before the model was even called. It also failed on profile-routed credentials (*"No route-compatible authentication source is configured"*) while the gateway, same machine, same model, answered fine. Do not build on it.

**Measured, same machine, same model (`gpt-6.1-sol`), three runs each:**

| Path | Median turn | Prompt tokens |
|---|---|---|
| `agent exec` (cold, per request) | ~4,500ms | 18.1k |
| gateway, default agent | 3,846ms | 18.4k |
| gateway, scoped `sightread` agent | **2,041ms** | **10.2k** |

**The remaining cost is the system prompt, not the model.** A default agent shipped 25 skills and five workspace files (18.5k chars) before saying a word. The scoped agent in `openclaw/sightread-agent.patch.json5` carries one skill and injects no workspace files: prompt 18,447 → 10,157 tokens, turn 3,846ms → 2,041ms.

**Consequence for the pitch:** budget ~2s per agent turn. Do not claim sub-second end-to-end; claim that the model reads the whole repo in one pass. Model speed is what the race page shows, separately and honestly.

**3. Session-backed app.**
Same gateway, plus `--session-id` so context survives across turns. Worth it only if the product genuinely needs multi-turn memory.

**Minimum bar to satisfy "used the harness":** the agent loop — model picks a tool, calls it, reads the result, continues — is doing real work in your product. A single `chat.completions.create` call with OpenClaw's name in the README will not survive a question from the Cerebras team, and they will be in the Discord asking.

---

## 6. The 60-second video (this is the deliverable)

Requirements: ≤60s, must *clearly* show Cerebras speed, side-by-side vs a GPU provider recommended, no leaks of keys/tabs/notifications.

Shot list:

| Time | Beat |
|---|---|
| 0–5s | The problem, one sentence, on screen. No logo intro, no "hey guys". |
| 5–15s | Your product doing one thing, real data, no cuts. |
| 15–40s | **The race.** Same prompt, split screen: left GPU provider streaming word by word, right Cerebras finishing in one gulp + a live TPS counter. Real timers, not captions. |
| 40–52s | The agent actually doing agentic work — tool call visible, result landing. This is what proves OpenClaw is load-bearing. |
| 52–60s | What it's for + repo link + `#KimiOnCerebras`. |

Record at 1080p, mute notifications, fresh browser profile with no tabs, no key in frame. Keep the raw take too — a second, longer cut for the Reddit post.

---

## 7. Questions to ask in the kickoff Q&A (10:00 AM Sat)

1. **Exact model ID** — the Google Doc left the `kimi-k3.1-pro` model-ID field blank, and Cerebras docs list K3.1 Pro under *Dedicated Inference* (org-specific endpoint ID) while the doc says "standard API, no separate endpoint." Confirm the literal string before you hardcode it: `curl https://api.cerebras.ai/v1/models`.
2. **TPS bounty rules** — which number counts: `completion_tokens / time_info.completion_time` from a single non-streaming call, or wall clock? Does `reasoning_effort` count against you? Is it measured on your submission or a fresh run by them?
3. Does private preview enforce a different `contextWindow` than the 1M Moonshot advertises? (Your config should not claim more than the endpoint serves.)
4. Any ban on `--code-mode` / tool-heavy loops, given the RPM ceiling?

---

## 8. Schedule (PT)

**Sat**
- 10:00 Kickoff + Q&A — ask the four questions, get the model ID right.
- 10:30 Harness green: config patched, one `agent exec` turn on `kimi-k3.1-pro` returning real text. Engineers are live — this is the window.
- 11:00 Freeze scope. Write the one-sentence demo description first, then build only that.
- 10:30–16:00 Core loop works end-to-end with ugly UI. **Commit at every green state.**
- 16:00 UI pass. It has to look calm and expensive on video, not featureful.
- 18:00 **Post #1 on X** — a 15s clip of the thing working, "building this in the next 24h, #KimiOnCerebras". Early posts bank impressions and you can reply to them Monday.
- 18:00–23:00 Polish + edge cases. Record a scratch video now so you have a fallback.
- 23:00 Sleep. Non-negotiable. A tired 6:00 AM demo is worse than a rested 7:00 AM one.

**Sun**
- 06:00 Final features only if the demo already works. Otherwise: fix nothing.
- 07:00 Record. Three takes of the 60s. Pick the one where the race is most lopsided.
- 08:00 Post to X (tag `@Cerebras` `@Kimi_Moonshot`, `#KimiOnCerebras`), r/cerebras (flair `Kimi K3.1 Pro Hackathon`), and the Discord track channel.
- 09:00–09:45 Submit everything, verify the links resolve logged-out.
- 09:45–10:00 Nothing new. Deadline is a wall.
- Monday: reply to every comment, post one follow-up clip. Impressions close Tuesday 10 AM PT.

---

## 9. Risks, ranked

1. **Missed capacity form** → public tier → your demo is slower than it should be. Fix: do it today.
2. **Wrong model ID** → 404s at 10:05 AM with engineers watching. Fix: `curl /v1/models` at kickoff.
3. **OpenClaw plugin/config mismatch** → you spend the hackathon on YAML. Fix: the patch in `openclaw/` is pre-validated; prove it tonight on `gpt-oss-120b`.
4. **Scope** → nothing on screen at 2 PM. Fix: the 11:00 AM scope freeze.
5. **Dead X account / filtered Reddit post** → zero impressions, technically perfect project. Fix: warm both accounts this week, and cross-post the video natively (X punishes external links; put the repo link in a reply).
6. **Leaked API key in the screen recording** → revoke and re-record. Check the top-right corner of every take.
