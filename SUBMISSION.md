# Submission Pack

Fill this in by Saturday 11:00 AM PT — writing the copy is what forces the demo to be clear.

---

## The required block (paste into the Discord track channel)

```text
Project Name: <name>

Team Members: @<handle>, @<handle>

Project Description:
<2-4 sentences. What it does, who it's for, and why Cerebras speed is load-bearing —
not "we used a fast model", but "this interaction is impossible at 40 tok/s because ...".>

GitHub Repository: <url>
Demo Video: <attached or YouTube link>
```

Discord gets the **demo video attached or linked**, plus the description. Post it in the channel for each track you want considered.

---

## The 60-second video (script, timed against the clock)

Every number below was measured on `repos/expressjs__express` on Nov 17, so the
on-screen values are known in advance. Total runtime 0:58, two seconds of slack.

### Recording pre-flight (5 minutes, before you press record)

1. `npm run gateway` in one terminal, `npm start` in another. Open the health dot
   and confirm it reads warm, then close it.
2. Select **expressjs/express**. Ask *"If I change lib/application.js, what breaks?"*
   once and let it finish. **Do not reload the page after this.** The populated
   panel is what the recording opens on.
3. Zoom the browser to 110 percent. Hide the bookmarks bar and any notification
   banner. No `.env`, no terminal with the key, no Discord in frame.
4. Start the timer at 0:00 and record the whole viewport. Do not cut between beats;
   the run has to look continuous.

### The beats

| Clock | On screen | Say | You do |
|---|---|---|---|
| **0:00–0:07** | Impact panel already populated for `lib/application.js`, summary reading `application.js · high risk · 1 direct, 99 indirect · showing 14 of 100` | "This is Express. Change one file, and a hundred others sit downstream." | Nothing. Let the number sit still for a beat before you talk. |
| **0:07–0:13** | Repo picker on `expressjs/express`, hot chips `index.js 96`, `lib/utils.js 7` | "Sightread parsed all 142 files and 160 imports first. No model guessing." | Point at one chip, then at the panel. |
| **0:13–0:26** | Question typed in the ask box: *If I change lib/application.js, what breaks?* | "I ask what a change to `lib/application.js` actually touches. It resolves the file, then walks the real imports." | Type it visibly, submit around 0:16, let the spinner run while you keep talking. |
| **0:26–0:40** | Summary refreshes to `application.js · high risk · 1 direct, 99 indirect · showing 14 of 100`; first row `lib/express.js` with `imports it · line 18`; indirect rows tagged `depth 2`, `depth 3` | "One direct hit: `lib/express.js`, line 18. Ninety nine indirect, three levels deep into the examples. The model wrote the sentence. The graph wrote this list." | Scroll the list slowly, one screen height, and stop on a `depth 3` row. |
| **0:40–0:52** | Race panel, same prompt on both providers, timers running | "Same prompt, two providers, timed from the same start." | Submit the race at 0:41. Narrate only numbers you can see. |
| **0:52–0:58** | Pull back to the impact panel | "Sightread. Ask your repo, then see what your change breaks." | Stop moving. Repo URL goes in the caption, never spoken. |

### Rules for the edit

- **Nothing is claimed that the frame does not show.** If the race panel shows `–`
  for tok/s, say nothing about tok/s. An unmeasured number is the one thing a
  comment section will find.
- **If a beat overruns**, cut the race (0:40–0:52) and give the impact panel the
  twelve seconds. The graph is the product; the race is B-roll.
- **If the ask stalls past four seconds**, keep talking through the spinner. Dead
  air reads as a broken product; a spinner while you explain does not.
- **One take per beat is fine**, but the timer must be continuous. Stitch only if
  the join is invisible at 0:13 and 0:40.
- Captions on: X and Reddit autoplay muted, so the first frame has to carry the
  claim on its own. Burn in `100 files downstream` as the opening caption.

## Reddit (r/cerebras)

- Title: `<Project> — <one concrete outcome> in <N> seconds, on Kimi K3.1 Pro + Cerebras`
- Flair: **Kimi K3.1 Pro Hackathon**
- Body: description above + video (native upload beats a YouTube link) + repo link + `#KimiOnCerebras`.
- Upvotes count until **Tue 10:00 AM PT**. Reply to every comment; early engagement drives ranking.

## X

- Post the video natively. No external link in the first post — X suppresses it. Repo goes in a reply.
- Tag `@Cerebras` and `@Kimi_Moonshot`, include `#KimiOnCerebras`.
- First post Sunday ~08:00 PT. Monday: one follow-up (a different 15s clip, or a reply showing a surprising result).
- No paid promotion — "organic impressions" only, and paid amplification is disqualifying.

Suggested first post:

```text
<what it does> in <N> seconds.

Kimi K3.1 Pro on @Cerebras, driven by the @openclaw agent harness — <one number that
makes the speed real, e.g. "1,900 tok/s, the whole tool loop in 1.9s">.

Built in 24h for #KimiOnCerebras w/ @Kimi_Moonshot
```

---

## Pre-post checklist

- [ ] Video is ≤60s and opens with the result, not a logo
- [ ] Side-by-side against a GPU provider is visible, with real timers
- [ ] No API key, email, notification, or personal tab anywhere in frame
- [ ] Links resolve when logged out
- [ ] Repo is public and its README says how OpenClaw is used
- [ ] Posting from an account that isn't rate-limited or shadowbanned (check with a logged-out search)
