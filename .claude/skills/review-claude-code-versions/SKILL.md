---
name: review-claude-code-versions
description: Run a review round of the Claude Code versions released since the last one recorded in docs/AI_CLAUDE_CODE_VERSIONS.md — triage the changelog, diff the transcript corpus, find what could break claude-history AND what new it could build on, propose a decision for each, and record it. Use when the user asks what is new in Claude Code, says Claude Code has been updated, wants to resume or catch up the versions register, or suspects a CLI update broke something.
---

# Reviewing new Claude Code versions

The register is [`docs/AI_CLAUDE_CODE_VERSIONS.md`](../../../docs/AI_CLAUDE_CODE_VERSIONS.md). Read its Invariants and decision vocabulary first: this skill is HOW a round is done, that file is WHAT the rounds found, and nothing here is repeated there.

A round never implements anything. It ends with entries written, decisions proposed and the user's answer recorded; every `implement` becomes its own change afterwards, and its entry is edited to link to it when it lands.

## 1. Where we are, and where the round ends

- **Start**: the first version heading of the register (`## X.Y.Z`). That is the newest version reviewed; the round starts at the next published one — which may be a new minor or major (`2.2.0`), so never assume the `2.1.` prefix.
- **End**: the version installed on this machine (`claude --version`). The corpus only knows what has run here, so a version that is published but not installed cannot be reviewed whole. If the changelog has newer ones, say so and offer `claude update` before starting — the user's call.
- Tell the user the range and how big it is (versions, bullets) before triaging.

## 2. The changelog

- **Source**: `~/.claude/cache/changelog.md`, the copy the CLI keeps for itself (read it, never write it). If it is missing or stops short of the end version, use `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`.
- **Published versions** are exactly the `## X.Y.Z` headings in it; skipped numbers were never published and only get a mention in the Rounds row.
- Cut the range into the scratchpad (one file per slice) instead of reading the 1 MB file in place. Both ends are full versions and inclusive, compared part by part:

  ```bash
  awk -v lo=2.1.313 -v hi=2.2.4 '
    function key(v,  p) { split(v, p, "."); return sprintf("%05d%05d%05d", p[1], p[2], p[3]) }
    /^## [0-9]/ { k = key($2); keep = (k >= key(lo) && k <= key(hi)) }
    keep' ~/.claude/cache/changelog.md > <scratchpad>/slice.md
  ```

## 3. Triage

Every bullet gets one area, or none:

- **reads** — anything that could change what is on disk in `~/.claude` or the other folders this app reads ([Transcripts](../../../docs/AI_TRANSCRIPTS.md)): line types, fields, content blocks, new tools or new tool input/output shapes; how sessions are stored, named, titled, forked, branched, resumed, compacted, rewound or swept; subagent and background-agent storage; `sessions/<pid>.json`; history; plans; settings and credential files; anything new that ends up written in a transcript.
- **runs** — the CLI and the SDK this app spawns ([Running Claude](../../../docs/AI_RUNNING_CLAUDE.md)): flags, the Agent SDK, permission and plan modes, resume / session-id behaviour, the fullscreen renderer, terminal input and keyboard protocols, Windows-only behaviour, environment variables, usage limits and their API, auth, process lifecycle.
- **idea** — something new this app could build on. Ask it of every bullet that adds or changes a feature, and of every new field the corpus turns up: *what could claude-history draw, use or offer with this?* A datum worth drawing (how long Claude thought, how a call was approved), a cause worth naming (why context was re-cached, what made a session expensive), a new way in or out (open in Claude Desktop, a mod inside the CLI), a state worth telling apart (background sessions). The answer is a one-line proposal of what the app would do, not a restatement of the bullet.
- **none** — everything else: CLI cosmetics, vim mode, the status line, MCP server management that touches neither its logs nor transcripts, Bedrock / Vertex / Foundry / Mantle, OpenTelemetry, gateways, managed settings, and fixes that reach none of the above.

Be inclusive for `reads` and `runs` — a miss there is a silent breakage — and **generous with `idea`**: ideas are half of what a round is for, and the user decides which to keep. A first triage that only looks for what could break finds few of them, so after it **read every `Added` bullet of the range again with nothing but that question in mind** (`grep -E '^- (\[(SDK|Windows|Remote Control)\] )?Added'` on the slices) — the catch-up round found five more that way. An idea can come from a bullet that is `none` for maintenance: a plugin feature, a new slash command, a `/usage` warning.

**Tagged bullets.** `[SDK]`, `[Windows]` and `[Remote Control]` are triaged like any other (the composer is the SDK, the app is Windows-only, Remote Control changes live session status). Every other surface tag (`[VSCode]`, `[JetBrains]`, `[IDE]`, `[Claude Tag]`, `[Cloud sessions]`, `[Claude Code on the web]`, `[Code Review]`, `[Desktop]`, …) is dismissed in bulk and only counted — **unless** the bullet mentions transcripts, session files, resume, history, session status, titles, `~/.claude` or local storage, because VS Code runs the same CLI and writes the same transcripts.

**Small round** (a few hundred bullets): triage inline. **Large round**: split it by version ranges across parallel `general-purpose` subagents, each given its slice file, this section of this skill as the rubric, and an output file in the scratchpad. They return candidates **quoted verbatim** with their area and one line of why — or, for an `idea`, one line of what the app would do — never a decision; deciding is the round's job, with the user.

## 4. The corpus

```bash
node scripts/corpus-shapes.mjs --since <the version at the top of the register>
```

Every shape it lists was written by no older version here. For each one:

- Look it up in the area docs and in the parser (`server/src/core/parser.ts`), the summarizer and the deep scan (`server/src/core/deepSearch.ts`) — anything that walks `message.content` without checking the line's `type` will pick up a new line type that has one.
- Open the example session it names on the dev instance (`http://127.0.0.1:7434/session/<id>`) and check it draws, counts and searches right.
- Match it to the changelog bullet that explains it, if there is one. If none does, it is filed *(corpus)* under the version where it first appears.
- Ask the `idea` question of it too: a new field is often the first sign of something the app could draw — `thinkingDurationMs`, `permissionDecision` and `requestedModel` were all found this way, with no bullet announcing them.

"First seen" is not "introduced" — it depends on what was used here and on what retention has swept — so it places an entry; it does not prove one.

## 5. When the two are not enough

Only for what is still unclear: the official docs (the `claude-code-guide` subagent), or the CLI bundle itself, as the area docs already do when they cite a version ("read out of the 2.1.239 binary"). Never as the first source; it is the slowest one.

## 6. Decide with the user

Propose a decision for every candidate, with its reason, grouped by area. Anything `tolerate` must have been checked — say against which session. **`implement` needs the user's explicit yes**; without it the item is `pending`. Breakages go first, and are said plainly; then the ideas, each with what the app would do and roughly what it costs, so the user can pick.

## 7. Write it down

- One `## X.Y.Z` section per published version in the range, **newest first, above the previous top**. A version with nothing in it still gets its heading and one line: how many bullets it had, and that none reaches this app.
- Item format and vocabulary as in the register. An item about something that keeps changing across versions lives in the version where it first appeared; later versions link back to it rather than restating it.
- A fact discovered on the way — a new line type, a new field and what it means — goes to its area doc, and the item links there.
- Every `pending` item and every `implement` not yet landed gets a link under Open decisions, in its group — *To fix*, *To build* or *To measure* — and every one this round settles leaves it.
- One row in Rounds: date, range, installed version, unpublished numbers skipped, and any gap in the corpus (`corpus-shapes.mjs` prints the versions it has lines for).
- Check that the published versions in the range and the new `## X.Y.Z` headings match one to one, then commit.
