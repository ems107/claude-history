# Claude Code versions — what changed upstream, and what we did about it

**Load this when:** Claude Code has shipped versions newer than the first one below, or something that used to work broke after a CLI update.

This app reads a format nobody documents and runs a CLI that ships almost every day, so it falls behind without noticing. This file is what stops that: every published Claude Code version from the baseline up, newest first, with what in it reaches this app and what was decided about it. How a round is carried out — the sources, the triage, the corpus check — is the `review-claude-code-versions` skill ([`.claude/skills/review-claude-code-versions/SKILL.md`](../.claude/skills/review-claude-code-versions/SKILL.md)); this file holds only what the rounds found.

## Invariants

- **The first `## 2.1.X` below is the newest version reviewed.** There is no other marker: that heading is the answer to "up to where are we".
- **Every published version from the baseline up has an entry**, even if all it says is that nothing applies. A missing version means NOT REVIEWED, never "nothing there".
- **Newest first.** A round adds its entries above the previous top, newest of the round first.
- **An entry records a decision, never how something works.** The fact goes to its area doc (`AI_TRANSCRIPTS.md`, `AI_RUNNING_CLAUDE.md`, …) and the entry links to it — one home per fact.
- **Entries are edited, not appended to.** When a decision changes — a `pending` settled, an `implement` landed — the entry is updated where it is, and Open decisions follows.
- **Baseline: 2.1.268.** Nothing older was ever reviewed as a whole. What the repo knows about earlier versions was measured one bug at a time, and lives in the area docs.

## Decisions

| Decision | Means |
| --- | --- |
| `implement` | the app will do something about it, and it stays under Open decisions until the commit that does it is linked here |
| `tolerate` | nothing to support, but it must not break anything — and it was checked that it does not |
| `not applicable` | it was a candidate, and it does not reach this app |
| `pending` | it needs a decision or a measurement, and stays under Open decisions until it has one |

Each item also names the **area** it touches: `reads` (what is on disk in `~/.claude` and the other folders this app reads), `runs` (the CLI and the SDK this app spawns: flags, modes, the renderer, the environment, usage limits) or `shows` (a feature worth drawing).

An item reads `- **[decision · area]** what changed, quoting the changelog where it helps — why it matters here — link.` A finding the changelog never mentions is filed under the version the corpus first shows it in, marked *(corpus)*.

## Open decisions

None yet.

## Rounds

| Date | Range | Installed | Notes |
| --- | --- | --- | --- |
