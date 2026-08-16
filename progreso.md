# Plan mode — progress

Branch `plan-mode`, off `main`. No PR: merged straight into `main` when finished.
**This file is deleted before the merge.**

The approved plan lives at
`C:\Users\Edgar\.claude\plans\investiga-el-funcionamiento-del-serialized-wilkes.md`.

## Steps

- [x] **1. Parser + types.** `PlanOutcome`, `ToolResultInfo.plan`, `plan-mode` block,
      `MessageItem.permissionMode`, `summarizeInput` case, plan-mode attachments.
- [x] **2. `PlanCard` + insertion in `Turn.tsx` + `SystemItem` + `PLAN` chip.**
- [x] **3. Consumers of the new kind: export, folding, segments.**
- [x] **4. Enricher + `CACHE_VERSION` 12 + `plan` search role + `deepSearch` de-dup.**
- [x] **5. `GET /api/plans` + `PlansPage`.**
- [x] **6. Composer: live permission-mode picker + initial mode from the transcript.**
- [x] **7. `ExitPlanMode` approval panel with the three decisions.**
- [ ] 8. `CLAUDE.md`.
- [ ] 9. Delete this file and merge into `main`.

## Verified so far

**Corpus (116 sessions, `parseTranscript` before vs after).** Only `items` moved, and only
in the 11 sessions that touch plan mode, by exactly the number of markers emitted
(f3384d17 +7 = 2 enter + 1 reentry + 2 exit + 2 reference; 980751cb +3; the rest +2 or +1).
**Turns, prompts and the four token totals are identical everywhere.** The only other diff is
`e95a1a42`, the session running the work, which grew between the two passes.

**Counts.** 16 plans in 10 sessions (11 approved, 5 rejected, 0 pending) — the research
reported 14 in 9, and the extra 2 are this session's own, made while implementing. Markers:
12 enter, 1 reentry, 11 exit, 3 reference. 20 items carry `permissionMode: 'plan'`.
Turns opened by a marker alone: **0**.

**The exit gate works.** `b343d4ac` holds four `plan_mode_exit` lines and only **one** is
rendered — the other three fire on a CLI first prompt with no plan mode open.

**Fixture `b343d4ac`.** enter 17:55:04 (`planExists: false`) → rejected
`toolu_01CyGpmXFjFcBj8apDVmAXck` with feedback *"Las pruebas que hagas hazlas siempre con haiku
o sonnet…"* → approved `toolu_014qndvKLoC1hKQ6JMiW1MhD`, 16,894 chars, saved to
`lexical-swimming-tulip.md` → exit 18:21:35 (`planExists: true`). The collapsed header reads the
plan's own H1 instead of 17 KB of stringified JSON.

**In the browser (headless Chrome over CDP), `b343d4ac`.** 2 plan cards — `✖ NOT APPROVED` with
the feedback quoted under "the user said", and `✔ APPROVED` — plus the 2 markers and 1 `plan`
chip. The rejected card still shows its 16.2k-char plan, which only works because the text falls
back to the call's own input: a rejection keeps no copy on the result. Opening the fold renders
real markdown (4 headings, 4 code blocks) and does **not** collapse the turn (248 bubbles before
and after). The fold headers are `DIV`s with `role="button"` and hold nothing interactive. No raw
JSON and no ANSI anywhere on the page.

`f3384d17` shows 1 marker and 0 cards, which is right: the rest sit inside compacted segments,
and those render nothing until unfolded.

**Export.** `buildMarkdown` over the real `b343d4ac` payload gives two `📝 **Plan — …**` blocks
with the right verdicts, the file path on the approved one, `The user said:` under the rejected
one, and the two plan-mode markers. **No `ExitPlanMode` is left as a tool `<details>`** and there
are zero JSON-stringified plans. The plan survives `includeTools: false` — it is the decision,
not tool traffic.

`folding.ts` and `segments.ts` needed nothing: `foldedCounts` only looks at assistant items and
`isPromptItem` requires the user role, so a plan-mode item counts as neither a response, nor a
tool, nor a prompt. Checked, not assumed.

**Search, after the `CACHE_VERSION` 12 bump.** `/api/meta` came back `cacheHits: 0` with all
116 sessions enriched. A phrase living only inside a plan (`"es el mayor riesgo del proyecto"`)
now returns two `plan` rows, each anchored on its own `ExitPlanMode` call; `in=user` drops them,
which is right — a plan is not something the user wrote.

**The arithmetic closes both ways**: 3 places / 3 `pageMatches` / 3 `matchCount` indexed, and
6 / 6 / 6 deep. Deep stays a superset (1 session → 3; that session 3 → 6 matches).

**The double count is really gone, and there were two of them.** The call input was the one the
plan named; the approval's tool_result turned out to echo the whole plan back after a fixed
preamble, with the SAME anchor as the indexed row — one plan, twice, both links landing in the
same place. Cutting the echo at `## Approved Plan:` took `b343d4ac` from 7 deep matches to 6
while keeping the preamble, which names the file the plan was saved to.

**The Plans page.** 17 rows, newest first, each linking at its own plan with `?tool=` rather
than at the session. The disk state came out **10 on disk, 1 overwritten, 6 with no file**, and
every part of that is the predicted behaviour: the overwritten one is
`quiero-que-planifiques-la-playful-pearl.md`, written by two approvals a day apart, of which
only the second survives — the exact case the research named — and all 6 "no file" rows are
`rejected` or `pending`, since only an approval records a path.

That check was wrong first time round and the bug is worth keeping in mind: comparing
`stat.size` to the recorded length is **bytes against characters**, and every plan here is
Spanish. The retention plan is 12,299 characters and 12,546 bytes, so the shortcut answered
"gone" for all eleven files that were sitting right there. The files are read whole now — nine
of them, 51 KB at the worst.

Deep link: `?tool=` on a plan opens its run and nothing else (3 tool blocks in the DOM of a
session with hundreds), flashes for ~2.2 s of its 2.5 s budget, and scrolls to it.

**The composer, end to end against a real session** (`d29ebc13`, a throwaway in a temp folder,
haiku — never opus or fable, and the spawned pid captured rather than filtering on `claude.exe`).

A prompt sent with `permissionMode: plan` started the process in plan mode and the status
reported it. Claude planned, asked an `AskUserQuestion`, and then `ExitPlanMode` arrived through
`canUseTool` with **1,419 characters of plan**. Pressing *Keep planning* with a note sent the
plan back, and the note came round the other side: the card now shows *"Anade tambien una
seccion sobre el ano de copyright"* under "the user said". That round trip is the whole point —
the two halves of this feature meeting on real data.

Two things the corpus could not have told us, both now handled:

- **2.1.233 sends `{plan, planFilePath}`**, not the bare `{plan}` of every call in the archive.
  The path is taken from the input now and the slug derivation kept only as the fallback.
- **A refusal sent from the app is NOT recorded like one typed in a terminal.** The SDK's
  `canUseTool` deny lands as `toolDenialKind: "permission-rule"` with **no `userFeedback` field
  at all** — the message travels inside `toolUseResult` as `"Error: <message>"`. Reading only
  the field lost every note sent from here, which is exactly the half the card exists to show.
  `planFeedback` reads both and ignores the generic refusals.

The picker opens on `plan` for that session, restored from the transcript's last
`permissionMode`. Process cleanup is clean: `pnpm stop` took pid 22832 (the one the server
spawned) and left 12432 and 26892 — including this very terminal — untouched.

**Corpus:** 17 plans in 11 sessions (11 approved, 5 rejected, 1 pending), text recorded for
17/17. The `pending` one is genuine, not a parse failure: `2ed0a955`'s last written line IS its
`ExitPlanMode` call, its tool id appears once in the whole file, and it is the same session that
shows `enter=1, exit=0`. A plan awaiting an answer right now.
