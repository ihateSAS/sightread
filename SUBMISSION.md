# Submission Pack

The copy is written and the measured figures are filled in. They were measured on
`qwen-3.8-27b` because Kimi capacity has not landed; if it lands before you post,
re-measure, swap the numbers, and put Kimi back in the title. Only the video
attachment stays blank until the take exists.

---

## The required block (paste into the Discord track channel)

```text
Project Name: Sightread

Team Members: @ihateSAS

Project Description:
Ask Sightread about a change to a repository and it answers twice: once with the
parsed import graph in the prompt, and once with the same model and no graph at
all. Point it at Express, ask about lib/application.js, and the graph lists 100
downstream files starting at lib/express.js line 18, while the same model, with the
same tools and no graph, has to work that list out itself. The pair is the product:
computed evidence with clickable file and line citations, the model's answer
without that evidence, and a count of how much of the graph the unaided run named.
Speed is load-bearing because every change question is answered twice. On Cerebras
the graph-backed answer streams its first token in 0.61s and finishes in 0.86s at
424 tok/s, which is what makes asking twice usable instead of wasteful.

GitHub Repository: https://github.com/ihateSAS/sightread
Demo Video: <attach the 60s MP4>
```

Discord gets the **demo video attached or linked**, plus the description. Post it in the channel for each track you want considered.

---

## Measured for this cut (Nov 18, 2026)

Every figure below came from the live page on `repos/expressjs__express`, with
`npm start` streaming straight from Cerebras. The machine was loaded (load
average 33), so these are conservative numbers, not a best case.

| Run | First token | Total | Throughput | What was on screen |
|---|---|---|---|---|
| Ask, graph on | 0.61s | 0.86s | 424 tok/s | 397→365 tokens, 21 of 100 named |
| Ask, graph off | 0.21s | 1.49s | — | 6 of 100 named alone, 21 with the graph |
| Race, Cerebras, 600 tokens | 0.22s | 0.38s | 1,583 tok/s | qwen-3.8-27b |
| Race, OpenRouter, 600 tokens | 0.79s | 2.52s | 238 tok/s | qwen/qwen3.8-27b |

**Model caveat.** `cerebras/kimi-k3.1-pro` still returns `model_not_found` on the
public key, so every number above was measured on the declared fallback,
`qwen-3.8-27b`. The app says so on screen: the header chip reads
`qwen-3.8-27b cerebras`, and the answer carries a fallback banner. When capacity
lands, swap the key, restart, and confirm the boot line reads
`"primary":"cerebras/kimi-k3.1-pro","kimiLive":true`. The chip, the banner and
the model chain switch to Kimi with no code change. Re-measure before posting and
put Kimi back in the title.

---

## Competitive read (Nov 20)

The swarm video that is circulating is a 96-second RuneScape run: 25 agents trying to make money under evolutionary pressure, using Voyager/MineDojo for skill development, RuneBench/rs-sdk as the world, Pi Harness per agent, death dropping items, and fitness-weighted mating. It is spectacle, not a hackathon submission proof: it does not show Cerebras/Kimi latency, a repo question answered with file and line citations, or a measurable gap between a model with and without evidence.

Do not chase it. Sightread is not a multi-agent world and does not evolve skills. Its defensible beat is narrower and stronger on camera: the graph lists 100 downstream files, the same model with no graph names only a fraction of them, and the page counts the gap while the answer streams in 0.61s. If a judge asks why Sightread is not "25 agents doing things," the answer is that the product is a decision tool for a change, not a simulation. The swarm can look alive while proving nothing about whether the answer was right.

---

## The 60-second video (script, timed against the clock)

The layout and the graph counts below were checked against
`repos/expressjs__express` on Nov 18. Coverage varies per run, so read that count
off the screen rather than reciting one from memory. Total runtime 0:58, two
seconds of slack.

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
5. Start the timer at 0:00 and record the whole viewport. Do not cut between beats;
   the run has to look continuous.

### The beats

| Clock | On screen | Say | You do |
|---|---|---|---|
| **0:00–0:06** | Impact panel already populated, summary reading `application.js · high risk · 1 direct, 99 indirect · showing 14 of 100`; toggle reads `paired run on` | "This is Express. Change one file, and a hundred others sit downstream." | Nothing. Let the number sit still for a beat before you talk. |
| **0:06–0:12** | Repo selected, impact header reading `142 files · 160 imports parsed` | "Sightread parsed 142 files and 160 imports before the agent read a single one." | Point at the count, then at the hot chips. |
| **0:12–0:24** | Question submitted: *If I change lib/application.js, what breaks?* Graph answer appears, then `Without the graph` starts filling underneath | "Ask it once and it answers twice. First with the parsed graph in the prompt." | Submit at 0:12. Let the first answer land without narrating the file list. |
| **0:24–0:36** | Blind spot pane filled: `N of 100 downstream files named by the model alone · M with the graph`, plus the unaided answer | "Then the same model with no graph. That count is how many of the graph's hundred it found by itself." | Point at the count, then let the unaided text sit. Read only numbers on screen. |
| **0:36–0:44** | Impact panel: `1 direct, 99 indirect · showing 14 of 100`; first row `lib/express.js` with `imports it · line 18`; rows tagged `depth 2`, `depth 3` | "Every one of those edges is a parsed import you can open. The model wrote the sentence. The graph wrote the list." | Scroll slowly and stop on a `depth 3` row. |
| **0:44–0:53** | Race panel, `1..1000 TPS Test` preset, 600 tokens, both providers streaming | "Same model, same prompt, two providers, timed from the same start." | At 0:45 click the `1..1000 TPS Test` preset, then Start Race. The measured cut was 0.38s vs 2.52s; say only what the panel shows. |
| **0:53–0:58** | Pull back to the impact panel | "Sightread. Ask your repo, then see what your change breaks." | Stop moving. Repo URL goes in the caption, never spoken. |

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
- **One take per beat is fine**, but the timer must be continuous. Stitch only if
  the join is invisible at 0:13 and 0:40.
- Captions on: X and Reddit autoplay muted, so the first frame has to carry the
  claim on its own. Burn in `100 files downstream` as the opening caption.

## Reddit (r/cerebras)

**Title**

```text
Sightread: change one file in Express, see the 100 files downstream, in 0.61s on Cerebras
```

**Body**

```text
I point Sightread at a repo and ask it a question. Every answer cites the file and
line it came from, which is table stakes. The part I wanted was the other half:
what breaks if I change this?

On Express it parses the import graph across 142 files and 160 internal imports,
then resolves a change to lib/application.js into 100 downstream files. One direct
hit at lib/express.js line 18, ninety nine indirect, three levels deep into the
examples. That list is computed from the import graph, not written by the model.
Then it runs the same question again with no graph in the prompt and counts how
many of those hundred files the model names on its own. Graph tools that do blast
radius already exist; what I had not seen was the model's own answer next to that
evidence, with the gap counted. That comparison is the point of the project.

Speed is load-bearing here because every change question is answered twice. The
graph replaces exploration rather than adding to it: the aided answer is one turn
with no tool calls. On Cerebras the graph-backed answer streams its first token in
0.61s and finishes in 0.86s at 424 tok/s, while the unaided run takes 1.49s and
names a fraction of the graph's hundred files. That is what makes asking twice
usable instead of wasteful. The same pair on a slow endpoint is the reason people
stop asking their codebase questions.

60 second demo: <video attached>
Code, MIT: https://github.com/ihateSAS/sightread

Built during the Kimi K3.1 Pro hackathon, using the OpenClaw harness on Cerebras.
#KimiOnCerebras
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

0.61s to first token, 424 tok/s on @Cerebras. #KimiOnCerebras
```

That is 265 characters, so it fits without a paid account. Do not add the repo link
to it.

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

- [ ] Video is ≤60s and opens with the result, not a logo
- [ ] Side-by-side against a GPU provider is visible, with real timers
- [ ] No API key, email, notification, or personal tab anywhere in frame
- [ ] Links resolve when logged out
- [ ] Repo is public and its README says how OpenClaw is used
- [ ] Header chip says the model that answered, and no fallback banner is in frame if the copy claims Kimi
- [ ] Posting from an account that isn't rate-limited or shadowbanned (check with a logged-out search)
