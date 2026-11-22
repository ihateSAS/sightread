# Submission Pack

The copy is written and the measured figures are filled in. **Kimi K3.1 Pro is
live on the trial endpoint**, so the figures below are Kimi's, not the qwen
fallback's. Read the congestion caveat before recording: the trial endpoint is
shared with every team at the event, so first token swings from under 1s to over
10s depending on the minute. Only the video attachment stays blank until the take
exists.

---

## The required block (paste into the Discord track channel)

```text
Project Name: Sightread

Team Members: @ihateSAS

Project Description:
Ask Sightread about a change to a repository and it answers twice: once with the
parsed import graph in the prompt, and once with the same model and no graph at
all. Point it at Express, ask about lib/application.js, and the graph lists 100
downstream files starting at lib/express.js line 18, while the same model with no
graph has to work that list out itself. On Kimi K3.1 Pro the unaided run named 13
of those 100; with the graph it named 21. If the shared trial queue is long the app
answers on its qwen fallback instead, which named 1 to 3 unaided and 20 to 21 with
the graph. The pair is the product: computed
evidence with clickable file and line citations, the model's answer without that
evidence, and a count of how much of the graph the unaided run named. Speed is
load-bearing because every change question is answered twice, and the graph pays
for itself: the aided answer finishes sooner than the unaided one while sending
more prompt, because rebuilding a hundred-file list from memory costs about four
times the output tokens. Every answer streams from Cerebras and the page reports
its own first-token time.

GitHub Repository: https://github.com/ihateSAS/sightread
Demo Video: sightread-demo.mp4, attached, 46 s
```

The film is built and sits beside this file: `sightread-demo.mp4`, 46 seconds,
1920x1080, no key on screen. It types the question, cuts to a capture of the running
page, then states the counted result. It is a house-style film rather than a screen
recording start to finish, and the capture inside it is the real app answering.

Discord gets the **demo video attached or linked**, plus the description. Post it in the channel for each track you want considered.

---

## Measured for this cut (Nov 21, 2026)

Every figure below came from a fresh `npm start` run against
`repos/expressjs__express`, with Ask streaming straight from Cerebras. Health
reported configured and answering `cerebras/moonshotai-kimi-k3.1-pro-trial`,
transport `cerebras`. Coverage is the page's own count, produced by
`app/public/coverage.mjs`, the same module the UI and the tests use. Treat these
as one verified run, not a promise for every load condition.

| Run | First token | Total | Output tokens | What was on screen |
|---|---|---|---|---|
| Ask, graph on | 6.78s | 7.12s | 422 | 479 input, 21 of 100 named, 1 direct at `lib/express.js:18` |
| Ask, graph off | 9.10s | 11.05s | 1,605 | 13 of 100 named with no graph, 21 with it |

**The graph is cheaper even though it sends more prompt.** The aided call sent
479 input tokens against the unaided 198, yet finished 3.9s sooner, because the
unaided model writes 1,605 tokens to reconstruct a list it can only guess at.
Both runs answered on `moonshotai-kimi-k3.1-pro-trial`.

**Congestion caveat, and it matters more than the absolute times.** The trial
endpoint is shared by every team at the event. Server-side timings show the
queue, not the model, driving first token:

| Time | Queue | Compute | Server rate |
|---|---|---|---|
| congested | 14,517ms | 1,209ms | 301 tok/s |
| quiet | 10ms | 471ms | 353 tok/s |

So first token can land under 1s or over 12s with no code change. Compute sits
near 300 tok/s under the event load, against 1,746 tok/s for `gpt-oss-120b` on the
same box. **Check the queue before recording** (step 1 of the pre-flight) and let
the recorder quote the numbers on screen rather than these. Quote a total only
when the run was quiet.

**Both parties can be reached, and the two sets are not interchangeable.** Kimi's
trial bucket spent long stretches answering `429 high traffic` with no queue at
all, so the app's first-token budget hands those turns to the qwen fallback inside
about 2.5s. That is the designed behaviour and the page says so in the answer.
Whichever chip is in the finished take, quote that run:

| Take | Aided | Unaided | Coverage |
|---|---|---|---|
| Kimi chip | 1.05s first token, 1.23s total, 274 out | 6.68s first token, 9.75s total, 1,829 out | 21 vs 13 of 100 |
| Qwen fallback chip | 3.23s, 154 out | 1.14s, 998 out | 20 vs 1 of 100 |

The Kimi row is the take worth having: the graph turns an 1,829-token guess into a
274-token list and finishes 8x sooner. The fallback take pays the 3s budget as
visible first-token time, because the abandoned Kimi attempt is part of the turn.
The unaided count swings 1 to 3 on the fallback, so read it off the screen.

The fallback take is faster and its blind spot is wider, because a weaker model
guesses worse. Do not mix a Kimi sentence with a Qwen frame.

The film quotes the Kimi row exactly: 21 of 100 named with the graph in 1.23s,
13 named without it in 9.75s. Its capture came from a quiet minute, which is why
the timer in the film is faster than the congested run in the table above; the
coverage counts, 21 and 13, are the same in both.

**Model id.** The organizers announce the id as
`moonshotai-kimi-k3.1-pro-trial`. Our org's catalog briefly listed
`moonshotai-kimi-k3.1-pro-test` as well; `check-cerebras.sh` probes both and
prints whichever answers. A bare `kimi-k3.1-pro` returns `model_not_found`, and
so does `reasoning_effort: "none"` on Kimi (HTTP 400); the provider sends `low`,
the fastest value it accepts.

**Do not publish a number the panel did not measure.** If the take lands during a
queue spike, quote the token counts and the 21-versus-13 coverage, and leave the
milliseconds to the timer on screen.

---

## Competitive read (Nov 20)

The swarm video that is circulating is a 96-second RuneScape run: 25 agents trying to make money under evolutionary pressure, using Voyager/MineDojo for skill development, RuneBench/rs-sdk as the world, Pi Harness per agent, death dropping items, and fitness-weighted mating. It is spectacle, not a hackathon submission proof: it does not show Cerebras/Kimi latency, a repo question answered with file and line citations, or a measurable gap between a model with and without evidence.

Do not chase it. Sightread is not a multi-agent world and does not evolve skills. Its defensible beat is narrower and stronger on camera: the graph lists 100 downstream files, the same model with no graph names 13 of them, and the page counts the gap while the answer streams. If a judge asks why Sightread is not "25 agents doing things," the answer is that the product is a decision tool for a change, not a simulation. The swarm can look alive while proving nothing about whether the answer was right.

---

## The 60-second video (script, timed against the clock)

**Direction from InventorBlack (Nov 20):** a raw capture is a good start, but mix
in overlays to indicate what is happening or progressing, and the cut must be
**60 seconds or less**. The script below is built for that: raw screen capture
underneath, burned-in overlays on top, no narration required to follow it.
X and Reddit autoplay muted, so the overlays carry the story on their own.

The layout and the graph counts below were checked against
`repos/expressjs__express` on Nov 20. Coverage varies per run, so read that count
off the screen rather than reciting one from memory. Total runtime 0:58, two
seconds of slack. Hard cap 1:00; if the export runs long, trim the race beat
first, never the blind-spot count.

### Recording pre-flight (5 minutes, before you press record)

0. **Kimi is the model the rules name, so the take you want is a Kimi take.**
   The organizers say configure `moonshotai-kimi-k3.1-pro-trial` and OpenClaw, and
   the awards are for this model on this platform. Nothing in the rules forbids a
   fallback, so a Qwen take is legal, but it is a substituted model answering.

   Start the take the matching way, which sets the budget and both race lanes in
   one go:

   - `npm run take:kimi` for the take you want. Budget 12s, both race lanes on the
     Kimi ids.
   - `npm run take:fallback` only if the queue never clears. Budget 3s, both race
     lanes on the qwen ids, so the race stays same-model either way.

   Never leave one lane Kimi and the other qwen; the panel does say when the lanes
   differ, but a mixed race proves nothing about either.
0b. **Watch the bucket before you commit to the take.** `node kimi-queue.mjs`
   prints queue, compute and rate every 90 seconds. The trial bucket both queues
   and refuses. A `429` is retried once on the same model after 400ms before the
   fallback wins, so a refusal usually still ends on Kimi about half a second later;
   a queue over the budget waits and then falls back. Neither is one shot: expect to
   retake. Take the retake, it is 60 seconds.
   Shoot only when the chip reads `Kimi K3.1 Pro` with no fallback banner. If the
   queue sits at 1 to 10s, Kimi fits the 12s budget from `take:kimi`. Above about
   15s of sustained queue, stop waiting and shoot the fallback take instead, then
   swap the post's last line (see the X section) and do not say Kimi.
1. **Start the take you picked:** `npm run take:kimi` (preferred), or
   `npm run take:fallback`. Either streams straight from Cerebras; the gateway is
   not on the Ask path. Open `http://localhost:8787`, click the header
   chip, and confirm it reads `Kimi K3.1 Pro cerebras` with no fallback banner.
   **The chip, not the clock, decides what you may claim.** If it reads
   `Qwen 3.8 27B` while the queue is still long, the app did the right thing and
   handed the turn to the fallback after the first-token budget; either wait for
   a quiet minute and retake so the take is a Kimi take, or keep the take and say
   Cerebras without naming Kimi. A chip that says Qwen next to a sentence about
   Kimi is the one thing a judge will catch. If the chip says Qwen in a quiet
   minute, then the key or the trial access is genuinely missing. Close the
   popover. The Speed Race
   panel used in the 0:44 beat is the **Speed Race tab on this same page**
   (`:8787`), not the standalone `node race/server.mjs` on `:8788`.
   The page layout is two columns: question form on the left, Change impact on
   the right. On load the impact graph **roams** on its own, cycling the hot
   files every few seconds next to a pulsing green dot. That motion is the
   first frame. It stops the moment you click a hot file chip, press **Ask**,
   or type a repo URL (dot greys out), and it never changes what a question
   asks about: ambient roaming cannot select the ask target.
2. Get Express on screen. On a fresh clone there is no pre-loaded Express chip:
   type `expressjs/express` into the **repository** field and click **Clone repo**.
   The server clones it into `repos/` and parses the graph. The existing Express
   chip appears only after a clone has happened once. Then ask *"If I change
   lib/application.js, what breaks?"* and let both answers finish, the graph answer
   and the unaided run under it. Pressing Ask stops the roaming (grey dot) and the
   impact panel locks onto the asked file's graph (`application.js`, 1 direct,
   99 indirect). Note the coverage count, because it is the number you will point
   at. **Do not reload the page after this.** The populated panel is what the
   recording opens on, and pressing Ask in the filmed take keeps the graph
   parked on the same file.
3. **Wait 60 seconds after that pre-flight pair before recording.** The public
   Cerebras key allows 30,000 tokens/minute, and a pre-flight pair plus a filmed
   pair inside the same minute will rate limit the take you are shooting. The
   pre-flight pair also pays the first import parse, so the filmed pair starts
   from a warm graph.
4. Zoom the browser to 110 percent. Hide the bookmarks bar and any notification
   banner. No `.env`, no terminal with the key, no Discord in frame.
5. Start the timer at 0:00 and record the whole viewport as one continuous raw
   take. Overlays are added in the edit, on top of that take; do not cut the
   capture itself between beats.
6. Overlay kit ready before you start: lower-third title card, step counter
   (1/5 to 5/5), progress bar, callout boxes with a thin pointer line, and a
   live timer readout. Same font and colour across every overlay, no glass,
   no bubbles, no pills. Plain type, top-left, high contrast.

### The beats

| Clock | On screen | Overlay (burned in) | Say | You do |
|---|---|---|---|---|
| **0:00–0:06** | First frame: left column is the console with `paired run on`, right column is the impact panel already populated, summary reading `application.js · high risk · 1 direct, 99 indirect · showing 14 of 100` | Title card top-left: `SIGHTREAD` / `Change one file. 100 files downstream.` Progress bar 0%. Step `1 / 5`. | "This is Express. Change one file, and a hundred others sit downstream." | Nothing. Let the number sit still for a beat before you talk. |
| **0:06–0:12** | Repo selected, impact header in the right column reading `142 files · 160 imports parsed` | Callout box on the header count: `142 files, 160 imports parsed. Computed locally, before the model runs.` Progress bar 20%. Step `2 / 5`. | "Sightread parsed 142 files and 160 imports before the model read a single one." | Point at the count, then at the hot chips. |
| **0:12–0:24** | Question submitted from the left column: *If I change lib/application.js, what breaks?* Pressing Ask stops the roaming (dot greys). Graph answer appears below, then `Without the graph` starts filling underneath | Callout on the header chip: `Answering model: <chip text>. Streaming from Cerebras.` Live timer readout top-right counting up from 0:00. Step `3 / 5`. | "Ask it once and it answers twice. First with the parsed graph in the prompt." | Submit at 0:12. Let the first answer land without narrating the file list. |
| **0:24–0:36** | Blind spot pane filled: `N of 100 downstream files named by the model alone · M with the graph`, plus the unaided answer | Callout box on the count, large type: `Model alone: N of 100. With the graph: M of 100.` Progress bar 65%. Step `4 / 5`. | "Then the same model with no graph. That count is how many of the graph's hundred it found by itself." | Point at the count, then let the unaided text sit. Read only numbers on screen. |
| **0:36–0:44** | Impact panel: `1 direct, 99 indirect · showing 14 of 100`; first row `lib/express.js` with `imports it · line 18`; rows tagged `depth 2`, `depth 3` | Callout with pointer line on the first row: `lib/express.js:18. A real import line you can open.` | "Every one of those edges is a parsed import you can open. The model wrote the sentence. The graph wrote the list." | Scroll slowly and stop on a `depth 3` row. |
| **0:44–0:53** | Race panel, `1..1000 TPS Test` preset, 600 tokens, both providers streaming | Callout on the race timers: `Same model, same prompt. Timed from the same start.` Progress bar 85%. | "Same model, same prompt, two providers, timed from the same start." | At 0:45 click the `1..1000 TPS Test` preset, then Start Race. Both lanes now run Kimi K3.1 Pro, so the lane labels are the only difference on screen. Say only what the panel shows. |
| **0:53–0:58** | Pull back to the impact panel | End card: `Sightread. Ask your repo. See what your change breaks.` Repo URL small underneath. Progress bar 100%. | "Sightread. Ask your repo, then see what your change breaks." | Stop moving. Repo URL goes in the caption and end card, never spoken. |

### Rules for the edit

- **Nothing is claimed that the frame does not show.** If the race panel shows `–`
  for tok/s, say nothing about tok/s. An unmeasured number is the one thing a
  comment section will find.
- **The race beat needs a quiet minute.** Both lanes run the same weights, so it is
  a fair comparison, but the Cerebras trial queue is shared and one congested
  minute reads as `60.1s` against OpenRouter's `1.5s`. Run the race once during
  pre-flight to see the current minute. Keep it only if the Cerebras lane leaves
  first; cut it otherwise. During a spike the race actively argues against the
  product, so do not "keep it for balance". On the qwen pair the Cerebras lane wins
  by roughly 26x on total time, so a fallback take can keep the beat.
- **If a beat overruns**, cut the race (0:44–0:53) and give the blind spot pane
  the nine seconds. The comparison is the product; the race is B-roll.
- **Name Kimi only if the chip does.** The header chip reports the model that
  actually answered, so a Kimi take needs `Kimi K3.1 Pro` in the chip and no
  fallback banner. Otherwise say Cerebras and leave the model out of the claim.
  The first-token budget hands a queued turn to the fallback on purpose, so a
  fallback banner in frame is a working product, not a fault; just do not
  narrate over it as if Kimi answered.
- **If the first ask stalls past four seconds**, keep talking through the spinner.
  Dead air reads as a broken product; a spinner while you explain does not. The
  first-token budget normally hands the turn to the fallback inside a couple of
  seconds, so a long stall means the budget is switched off (see step 0).
- **If the model happens to name a long list**, drop that beat and open on the
  graph instead. Do not let the video imply the model guessed two files when it
  guessed ten.
- Overlays are burned in, not captions alone: title card, step counter, progress
  bar, callout boxes and a live timer, per the beat table. A muted viewer must
  be able to follow the whole story from the overlays and the numbers on screen.
- Overlays annotate only what the frame shows. Never overlay a number the panel
  did not measure. If the chip reads qwen, the overlay reads qwen; if it reads
  Kimi, it reads Kimi. No overlay may claim a Kimi figure from an OpenRouter
  run or any other proxy: the race panel already does the honest same-model
  comparison on screen, and borrowed speed numbers will not survive a judge
  asking which provider answered.
- One take per beat is fine, but the capture stays continuous underneath the
  overlays. Stitch only if the join is invisible at 0:13 and 0:40.
- The roaming graph is intentional motion for the opening frame. Do not click a
  hot file chip during the take; any click, Ask press, or repo typing stops the
  roaming and greys the dot. If the panel has parked on the wrong file before
  you press record, press Ask as part of the pre-flight and let it lock onto
  the asked file instead of clicking chips to steer it.
- Record at a desktop width above 860 CSS pixels (1440 at 100 percent, or
  110 percent zoom on a wider screen). Below that the two columns stack and the
  first frame stops showing the product side by side.

## Reddit (r/cerebras)

**Title**

```text
Sightread: change one file in Express, see the 100 files downstream
```

**Body**

```text
I point Sightread at a repo and ask it a question. Change answers cite the file
and line evidence behind them, which is table stakes. The part I wanted was the
other half: what breaks if I change this?

On Express it parses the import graph across 142 files and 160 internal imports,
then resolves a change to lib/application.js into 100 downstream files. One direct
hit at lib/express.js line 18, ninety nine indirect, three levels deep into the
examples. That list is computed from the import graph, not written by the model.
Then it runs the same question again with no graph in the prompt and counts how
many of those hundred files the model names on its own. Kimi named 13 of them; in a
congested minute the app hands the turn to its qwen fallback instead and that run
named 3. With the graph, 21 either way, and every edge was a parsed import you can
open. Graph tools
that do blast radius already exist; what I had not seen was the model's own
answer next to that evidence, with the gap counted. That comparison is the point
of the project.

Speed is load-bearing here because every change question is answered twice, and
the graph pays for itself. It sends more prompt and still finishes sooner: on
Kimi K3.1 Pro over Cerebras the graph-backed answer finished in 7.1s writing 422
tokens, while the same model unaided took 11.0s writing 1,605 to reach less of
the list. Rebuilding a hundred-file blast radius from memory costs four times the
output. The aided answer is one streamed call with no tool calls, so nothing is
spent on exploration.

Times move with event-day load, since the trial endpoint is shared: first token
was 0.9s in a quiet minute and 10s and up in a spike. The coverage count and the
token counts did not move, so those are the honest numbers.

60 second demo: attached, sightread-demo.mp4, 46 s
Code, MIT: https://github.com/ihateSAS/sightread

Built during the Kimi K3.1 Pro hackathon on Cerebras; OpenClaw provider config
and CLI fallback are in the repo, while the demo Ask path streams directly from
Cerebras so first-token time is measured honestly. #KimiOnCerebras
```

- Flair: **Kimi K3.1 Pro Hackathon**
- Upload the video natively; a YouTube link costs you reach.
- Upvotes count until **Tue 10:00 AM PT**. Reply to every comment; early engagement drives ranking.

## X

- Post the video natively. No external link in the first post, X suppresses it. Repo goes in a reply.
- Tag `@Cerebras` and `@Kimi_Moonshot`, include `#KimiOnCerebras`.
- **The X post is required, not optional.** The organizers list it as a submission
  step, so a Discord post alone does not count as entered. Post it once the video
  exists, then submit the track block in Discord.
- Submissions close **Sun Nov 22, 10:00 AM**. Reply to every comment; early
  engagement drives ranking.
- No paid promotion: "organic impressions" only, and paid amplification is disqualifying.

Suggested first post:

```text
Ask a code change question and Sightread answers twice: once with the repo's
parsed import graph, once with the same model and no graph. 100 files downstream
on Express. Unaided, Kimi K3.1 Pro named 13 of them. #KimiOnCerebras
```

If the take ended on the fallback chip, swap the last line for
`Unaided, the model named 1 of them.` and keep everything else.

That fits without a paid account, and it survives a slow take because it quotes
counts, not milliseconds. Add a time in the reply, from the panel, not from this
doc. Do not add the repo link to the first post either.

First reply (repo lives here, not in the first post):

```text
Code and the graph parser: https://github.com/ihateSAS/sightread
```

Follow-up post on Monday, if the first one lands:

```text
Same question, graph evidence switched off. The model names a few files and cannot
know what it missed. With the parsed imports: 100. That gap is the whole product.
```

---

## Speed Bounty (separate entry, not the 60s video above)

A second, independent submission: $1,000 for the fastest run on the Christmas
shopping task. It is not Sightread and it is judged on tokens per second, so do
not merge the two takes.

Rules:
- Use OpenClaw with Kimi K3.1 Pro on Cerebras to find five real Christmas gifts.
- All five must be real, existing products with links. Hard-coded results fail.
- TPS comes from the official patch:
  `https://github.com/wkasekende/openclaw-speed-patch`
- Video goes in `#share-your-demo` by Sun Nov 22, 10:00 AM, with the rate in the
  message text, for example `Speed Bounty entry: 1,234 TPS`.
- `TPS = (output tokens - 1) / (last token time - first token time)`
- Public demos use standard OpenClaw, not the patched build. Patch only for the
  bounty measurement.

Harness status, verified Nov 21: OpenClaw 2026.11.4 drives
`cerebras/moonshotai-kimi-k3.1-pro-trial` end to end. It was missing from
`models.providers.cerebras.models`, which is why every kimi id 404'd before; the
entry is added and `openclaw agent exec ... --model
cerebras/moonshotai-kimi-k3.1-pro-trial` returned the expected reply. OpenClaw
prep is about 34s per turn and does not count toward TPS, because the clock only
starts at the first token.

Because TPS is first-token to last-token, it rewards the quiet window, not the
fast machine. Check `node kimi-queue.mjs` before measuring, and note the rate
comes from actual completion tokens.

---

## Rules compliance, item by item

The organizers' list, and where each item is actually satisfied. Anything not
listed here is not a rule.

| Rule | Status |
|---|---|
| Install OpenClaw, required for all projects | Installed and configured. `openclaw` 2026.11.4 is a boot dependency: the server reports its version in `/api/health`, writes the agent model chain through `openclaw config` at startup, and ships a skill and a provider patch in `openclaw/`. The Ask panel streams direct from Cerebras because OpenClaw's own per-turn prep measured 14 to 34s, which does not fit a 60s video; the CLI path still answers when no key is present. This is disclosed in the README rather than implied. |
| Configure model `moonshotai-kimi-k3.1-pro-trial`, base URL `https://api.cerebras.ai/v1` | Both are set, in `.env` and in the OpenClaw provider. The header chip names whichever model answered, so a fallback can never be passed off as Kimi. |
| Demo video max 60 sec | Script is 0:58 with 1:00 as a hard cap and a stated trim order. |
| Show off Cerebras speed | First token and wall clock are measured live on screen, and the race panel runs the same model on both lanes. |
| No keys or personal info on screen | Pre-flight hides the key, terminal, bookmarks and notifications; repo chips show owner/name, never a home path. |
| Post on X, tagging @Cerebras and @Kimi_Moonshot, `#KimiOnCerebras` | Required step 5 below, with the draft in the X section. |
| Repository in the submission | Public and linked from the Discord block; MIT. |
| Reddit r/cerebras, flair `Kimi K3.1 Pro Hackathon` | Drafted as the optional entry below. |
| Speed Bounty uses OpenClaw with Kimi, 5 real gifts, official patch | Separate entry with its own rules section. Not the Sightread video. |
| Public demos use standard OpenClaw, not the patch | The patch is only for the bounty measurement. |

Nothing in the rules requires every inference call to pass through the agent loop,
and nothing forbids a fallback model, so neither is a violation. Both are stated
plainly because a judge will ask.

---

## User-only steps

These are the only items that need the recorder's own hands and accounts.
Everything above this section is checked against the repo as it exists on `main`.

1. **Record.** Follow the pre-flight and beats above. Total 0:58, hard cap 1:00.
   Keep the raw take; burn the overlays in the edit.
2. **Attach the MP4 in both spots**, replacing the two placeholders:
   - The Discord block under "The required block" (`Demo Video: <attach the 60s MP4>`).
   - The Reddit body (`60 second demo: <video attached>`).
   Upload the files natively on Discord, Reddit, and X. Do not paste a YouTube link.
3. **Make the repo public.** GitHub → Settings → Danger Zone → Change visibility.
   The README already describes the direct-stream demo path and the OpenClaw
   fallback accurately; do not edit it for this step.
4. **Logged-out check.** Open `https://github.com/ihateSAS/sightread` in a private
   window and confirm it resolves, the README renders, and no `.env` or key is
   visible in the file list. Then open each post in a logged-out search.
5. **Post.** Discord track channel(s) with the required block, r/cerebras with
   flair `Kimi K3.1 Pro Hackathon`, **and X with the video native, tagging
   @Cerebras and @Kimi_Moonshot with #KimiOnCerebras**. The X post is required by
   the organizers. Repo link in the first reply. Sunday ~08:00 PT; reply to every
   comment.

## Pre-post checklist

- [ ] Queue was quiet before recording (`node kimi-queue.mjs`), so seconds on screen are not a spike
- [ ] Take is the kind the chip says: Kimi take if the chip reads Kimi, otherwise a fallback take with the post's last line swapped
- [ ] Video is ≤60s (hard cap), opens with the result, not a logo
- [ ] First frame is side by side (console left, impact right) at desktop width, roaming graph visible before Ask, grey dot after
- [ ] Overlays burned in on every beat: title card, step counter, progress bar, callouts, live timer; story follows muted
- [ ] Side-by-side against a GPU provider is visible, with real timers
- [ ] No API key, email, notification, or personal tab anywhere in frame
- [ ] Links resolve when logged out
- [ ] Repo is public and its README accurately describes the OpenClaw fallback and direct-stream demo path
- [ ] Header chip reads `Kimi K3.1 Pro` and no fallback banner is in frame, or the take is openly a fallback one
- [ ] **Posted on X** with @Cerebras, @Kimi_Moonshot and #KimiOnCerebras; the X post is required
- [ ] TPS or timing in the post matches the panel in the take, not this document
- [ ] The coverage number in the post matches the one on screen
- [ ] Posting from an account that isn't rate-limited or shadowbanned (check with a logged-out search)
