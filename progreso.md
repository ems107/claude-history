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
- [ ] 4. Enricher + `CACHE_VERSION` 12 + `plan` search role + `deepSearch` de-dup.
- [ ] 5. `GET /api/plans` + `PlansPage`.
- [ ] 6. Composer: live permission-mode picker + initial mode from the transcript.
- [ ] 7. `ExitPlanMode` approval panel with the three decisions.
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
