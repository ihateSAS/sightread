---
name: kimi-speed-lab
description: Measure tokens/sec on Cerebras and prove Kimi K3.1 Pro speed claims with real numbers before putting them in a demo video or submission.
---

# Kimi Speed Lab

Use this skill when measuring inference speed, comparing Cerebras against another
provider, or producing a number for the demo video or submission text.

## The rule

Never write a speed claim you did not measure. Report the server-side number
(`completion_tokens / time_info.completion_time`) and label the wall-clock number
separately — wall clock includes network and queueing and will look worse.

## Measure

```bash
node {baseDir}/tps.mjs --model kimi-k3.1-pro --reasoning low --max-tokens 2000 --runs 3
```

- `--runs 3` and report the median. A single run is not a measurement.
- `--reasoning low` measures throughput. Use `high`/`max` only when demonstrating
  answer quality; the thinking tokens inflate latency and deflate the story.
- `reasoning_effort: "none"` is rejected by K3.1 Pro. Never send it.

## For the TPS bounty

The bounty is for the prompt with the fastest TPS. Throughput is maximized by a
**long generation with a short prompt and no tool calls**:

- one short instruction, e.g. "Write the integers from 1 to 5000, one per line"
- `stream: false` (streaming adds per-chunk overhead and loses `time_info`)
- `max_completion_tokens` high enough that the model is not truncated mid-run
- `reasoning_effort: "low"`
- temperature 0, so the output is stable and cacheable across attempts

Measure the baseline before you tune, and keep every run's `time_info` in a log.

## For the demo video

The comparison is only fair if both sides get the same prompt, the same
`max_tokens`, and start at the same moment. Record the screen, not a terminal —
the audience needs to see the answer arrive, not a table of numbers.

## Report

```text
server  1840 tok/s  (median of 3)
wall     902 tok/s
model   kimi-k3.1-pro, effort low, 2000 max tokens
```
