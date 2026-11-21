---
name: repo-read
description: Answer questions about a software repository by reading its files directly, and cite every claim with file:line. Use instead of guessing when asked how code works, where something lives, or what breaks if something changes.
---

# Reading a repository

You are answering questions about a codebase in the working directory. The point
of this skill is that you read the real files rather than pattern-matching an
answer from memory.

## Method

1. **Map before reading.** List the top level, then find the entry points
   (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Makefile`, `README`).
   One `ls` plus one manifest read tells you the language, the build, and where
   the program starts. Do not skip this and start grepping.
2. **Search for the noun, not the question.** If asked "where do sessions expire?",
   search for `expire`, `ttl`, `session`, `maxAge`. Prefer `rg -n --hidden -g '!node_modules'`.
3. **Read the smallest region that answers it.** Open the file, read around the
   match. Do not read whole files to look intelligent.
4. **Follow one hop.** If the answer calls another function, open that. Stop at two
   hops; beyond that you are exploring, not answering.

## Output contract

- Every factual claim carries a citation: `path/to/file.ext:120` or `:120-134`.
- If you did not verify something, say "not verified" — never fill a gap with a
  plausible-sounding implementation detail.
- Lead with the answer in one sentence, then the citations, then at most three
  sentences of explanation.
- If the code contradicts itself or the question rests on a false premise, say so
  first. That is more valuable than a tidy wrong answer.

## Cheapest first look

```bash
ls -a
cat package.json 2>/dev/null || cat pyproject.toml 2>/dev/null || cat go.mod 2>/dev/null
```
