# Submission Pack

The copy is written and the measured figures are filled in. They were measured on
`qwen-3.8-27b` because Kimi capacity has not landed; Kimi speed numbers are
pending, not claimed. If capacity lands before you post, re-measure, swap the
numbers, and put Kimi back in the title. Only the video attachment stays blank
until the take exists.

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
graph has to work that list out itself. The pair is the product: computed
evidence with clickable file and line citations, the model's answer without that
evidence, and a count of how much of the graph the unaided run named. Speed is
load-bearing because every change question is answered twice. Measured on the
qwen fallback on Cerebras, the graph-backed answer streamed its first token in
0.23s and finished in 0.38s, which is what makes asking twice usable instead of
wasteful. Kimi numbers remain pending capacity.

GitHub Repository: https://github.com/ihateSAS/sightread
Demo Video: <attach the 60s MP4>
```

Discord gets the **demo video attached or linked**, plus the description. Post it in the channel for each track you want considered.

---

## Measured for this cut (Nov 20, 2026)

Every figure below came from a fresh `npm start` run against
`repos/expressjs__express`, with Ask streaming straight from Cerebras. Health
reported configured `cerebras/kimi-k3.1-pro`, answering
`cerebras/qwen-3.8-27b`, transport `cerebras`. Treat these as one verified run,
not a promise for every load condition.

| Run | First token | Total | Throughput | What was on screen |
|---|---|---|---|---|
| Ask, graph on | 0.23s | 0.38s | — | 397 input → 304 output tokens, 21 of 100 named |
| Ask, graph off | 0.13s | 1.12s | — | 84 input → 1,090 output tokens, 3 of 100 named alone, 21 with the graph |
| Race, Cerebras, 600 tokens | 0.19s | 0.41s | 1,482 tok/s | qwen-3.8-27b |
| Race, OpenRouter, 600 tokens | 1.19s | 2.55s | 236 tok/s | qwen/qwen3.8-27b |

**Model caveat.** `cerebras/kimi-k3.1-pro` still returns `model_not_found` on the
public key, so every number above was measured on the declared fallback,
`qwen-3.8-27b`. The app says so on screen: the header chip reads
`qwen-3.8-27b cerebras`, and the answer carries a fallback banner. When capacity
lands, swap the key, restart, and confirm `/api/health` reports
`answerModel` as `cerebras/kimi-k3.1-pro` and `answerTransport` as `cerebras`.
The chip, the banner and the model chain switch to Kimi with no code change.
Re-measure before posting and put Kimi back in the title.

---

## Competitive read (Nov 20)

The swarm video that is circulating is a 96-second RuneScape run: 25 agents trying to make money under evolutionary pressure, using Voyager/MineDojo for skill development, RuneBench/rs-sdk as the world, Pi Harness per agent, death dropping items, and fitness-weighted mating. It is spectacle, not a hackathon submission proof: it does not show Cerebras/Kimi latency, a repo question answered with file and line citations, or a measurable gap between a model with and without evidence.

Do not chase it. Sightread is not a multi-agent world and does not evolve skills. Its defensible beat is narrower and stronger on camera: the graph lists 100 downstream files, the same model with no graph names only a fraction of them, and the page counts the gap while the answer streams in 0.23s on the current qwen fallback. If a judge asks why Sightread is not "25 agents doing things," the answer is that the product is a decision tool for a change, not a simulation. The swarm can look alive while proving nothing about whether the answer was right.

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

1. `npm start` (it loads `.env` and streams straight from Cerebras; the gateway
   is no longer on the Ask path). Open `http://localhost:8787`, click the header
   chip, and confirm it reads `qwen-3.8-27b cerebras` today, or
   `kimi-k3.1-pro cerebras` once capacity lands. Close the popover.
2. Select **expressjs/express**. Ask *"If I change lib/application.js, what
   breaks?"* and let both answers finish, the graph answer and the unaided run
   under it. Note the coverage count, because it is the number you will point at.
   **Do not reload the page after this.** The populated panel is what the recording
   opens on.
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
| **0:00–0:06** | Impact panel already populated, summary reading `application.js · high risk · 1 direct, 99 indirect · showing 14 of 100`; toggle reads `paired run on` | Title card top-left: `SIGHTREAD` / `Change one file. 100 files downstream.` Progress bar 0%. Step `1 / 5`. | "This is Express. Change one file, and a hundred others sit downstream." | Nothing. Let the number sit still for a beat before you talk. |
| **0:06–0:12** | Repo selected, impact header reading `142 files · 160 imports parsed` | Callout box on the header count: `142 files, 160 imports parsed. Computed locally, before the model runs.` Progress bar 20%. Step `2 / 5`. | "Sightread parsed 142 files and 160 imports before the model read a single one." | Point at the count, then at the hot chips. |
| **0:12–0:24** | Question submitted: *If I change lib/application.js, what breaks?* Graph answer appears, then `Without the graph` starts filling underneath | Callout on the header chip: `Answering model: <chip text>. Streaming from Cerebras.` Live timer readout top-right counting up from 0:00. Step `3 / 5`. | "Ask it once and it answers twice. First with the parsed graph in the prompt." | Submit at 0:12. Let the first answer land without narrating the file list. |
| **0:24–0:36** | Blind spot pane filled: `N of 100 downstream files named by the model alone · M with the graph`, plus the unaided answer | Callout box on the count, large type: `Model alone: N of 100. With the graph: M of 100.` Progress bar 65%. Step `4 / 5`. | "Then the same model with no graph. That count is how many of the graph's hundred it found by itself." | Point at the count, then let the unaided text sit. Read only numbers on screen. |
| **0:36–0:44** | Impact panel: `1 direct, 99 indirect · showing 14 of 100`; first row `lib/express.js` with `imports it · line 18`; rows tagged `depth 2`, `depth 3` | Callout with pointer line on the first row: `lib/express.js:18. A real import line you can open.` | "Every one of those edges is a parsed import you can open. The model wrote the sentence. The graph wrote the list." | Scroll slowly and stop on a `depth 3` row. |
| **0:44–0:53** | Race panel, `1..1000 TPS Test` preset, 600 tokens, both providers streaming | Callout on the race timers: `Same model, same prompt. Timed from the same start.` Progress bar 85%. | "Same model, same prompt, two providers, timed from the same start." | At 0:45 click the `1..1000 TPS Test` preset, then Start Race. The fresh verified run was 0.41s vs 2.55s; say only what the panel shows. |
| **0:53–0:58** | Pull back to the impact panel | End card: `Sightread. Ask your repo. See what your change breaks.` Repo URL small underneath. Progress bar 100%. | "Sightread. Ask your repo, then see what your change breaks." | Stop moving. Repo URL goes in the caption and end card, never spoken. |

### Rules for the edit

- **Nothing is claimed that the frame does not show.** If the race panel shows `–`
  for tok/s, say nothing about tok/s. An unmeasured number is the one thing a
  comment section will find.
- **If a beat overruns**, cut the race (0:44–0:53) and give the blind spot pane
  the nine seconds. The comparison is the product; the race is B-roll.
- **Name Kimi only if the chip does.** The header chip reports the model that
  will answer, so a Kimi take needs `kimi-k3.1-pro` in the chip and no fallback
  banner. Otherwise say Cerebras and leave the model out of the claim.
- **If the first ask stalls past four seconds**, keep talking through the spinner.
  Dead air reads as a broken product; a spinner while you explain does not.
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

## Reddit (r/cerebras)

**Title**

```text
Sightread: change one file in Express, see the 100 files downstream, in 0.23s on Cerebras
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
many of those hundred files the model names on its own. Graph tools that do blast
radius already exist; what I had not seen was the model's own answer next to that
evidence, with the gap counted. That comparison is the point of the project.

Speed is load-bearing here because every change question is answered twice. The
graph replaces exploration rather than adding to it: the aided answer is one
streamed answer with no tool calls. Measured on the qwen fallback on Cerebras
while Kimi capacity is pending, the graph-backed answer streamed its first token
in 0.23s and finished in 0.38s, while the unaided run took 1.12s and named a
fraction of the graph's hundred files. That is what makes asking twice usable
instead of wasteful. The same pair on a slow endpoint is the reason people stop
asking their codebase questions.

60 second demo: <video attached>
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
- First post Sunday ~08:00 PT. Monday: one follow-up (a different 15s clip, or a reply showing a surprising result).
- No paid promotion: "organic impressions" only, and paid amplification is disqualifying.

Suggested first post:

```text
Ask a code change question and Sightread answers twice: once with the repo's
parsed import graph, once with the same model and no graph. 100 files downstream
on Express, and what the unaided run missed.

0.23s to first token on @Cerebras, qwen fallback while Kimi capacity is pending. #KimiOnCerebras
```

That fits without a paid account. Do not add the repo link to it.

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

## Pre-post checklist

- [ ] Video is ≤60s (hard cap), opens with the result, not a logo
- [ ] Overlays burned in on every beat: title card, step counter, progress bar, callouts, live timer; story follows muted
- [ ] Side-by-side against a GPU provider is visible, with real timers
- [ ] No API key, email, notification, or personal tab anywhere in frame
- [ ] Links resolve when logged out
- [ ] Repo is public and its README accurately describes the OpenClaw fallback and direct-stream demo path
- [ ] Header chip says the model that answered, and no fallback banner is in frame if the copy claims Kimi
- [ ] Posting from an account that isn't rate-limited or shadowbanned (check with a logged-out search)
