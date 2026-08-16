# Plan mode — progress

Branch `plan-mode`, off `main`. No PR: merged straight into `main` when finished.
**This file is deleted before the merge.**

The approved plan lives at
`C:\Users\Edgar\.claude\plans\investiga-el-funcionamiento-del-serialized-wilkes.md`.

## Steps

- [x] **1. Parser + types.** `PlanOutcome`, `ToolResultInfo.plan`, `plan-mode` block,
      `MessageItem.permissionMode`, `summarizeInput` case, plan-mode attachments.
- [ ] 2. `PlanCard` + insertion in `Turn.tsx` + `SystemItem` + `PLAN` chip.
- [ ] 3. Consumers of the new kind: export, folding, segments.
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
