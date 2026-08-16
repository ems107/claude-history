# Logging

**Load this when:** you add logging anywhere, touch `core/logger.ts` / `core/logReader.ts` / `core/updateLogImport.ts`, or need to work out what an installed instance did — the installed server runs hidden, so these files are the only trace.

One JSONL file per **local** day in `%LOCALAPPDATA%\claude-history\logs\YYYY-MM-DD.log`, written by every way of running the server (installed, source, portable, dev). That single location is the point: the previous design took a `--log-file` path, so the installed release and the source server wrote to different files, and alternating between them split the evidence — which is exactly how a "why did the background job not fire?" question became unanswerable after the fact.

## Invariants

- **Never log with `console.*` in new code** — use `createLogger('<source>')`.
- **Fastify must keep its `stream:` destination** in `app.ts`.
- **Only `recordImported` may carry a foreign timestamp**; our own records are stamped when they happen.
- **Every usage read is logged with the trigger that caused it**, and an unknown cause is admitted, never guessed.
- **`data` holds a third-party payload verbatim** — never tidied.

## The records

`{t, lvl, src, pid, msg, data?, err?}`.

- `t` is local ISO **with offset** — still sortable and `Date.parse`-able, but readable without doing timezone arithmetic by hand.
- `pid` is on every record: two instances sharing a day's file should be impossible with one port, and this is what makes it obvious when it is not. The version appears only in the `started` message, which the pid ties the rest of the lines to.
- `createLogger('<source>')` gives `debug` / `info` / `warn` / `error`; **the source and the level are fields, not a convention inside the message text**. `console.*` is still captured (source `console`) purely as a net for stray output, ours or a dependency's.
- **Fastify must keep its `stream:` destination** (`app.ts`): pino writes straight to file descriptor 1 and bypasses any `console` capture, so without that stream a 500 or a failed `listen()` leaves NOTHING in the log — the one thing the log exists for.
- Records can also be **imported** from a log we did not write: `recordImported` takes an explicit timestamp so the update helper's lines keep theirs (see [AI_DISTRIBUTION.md](AI_DISTRIBUTION.md)). Nothing else may use it.
- `logger.ts` owns the fatal hooks (`uncaughtException` / `unhandledRejection` → `FATAL` + exit 1), the signal records and the synchronous `exit` record — by exit time a stream can no longer flush, so that one uses `appendFileSync`. It is also where `onShutdown()` lives, the single place every exit path already passes through.

## Logging a usage read

**Every usage read is logged with the `UsageTrigger` that caused it** — `widget-{mount,activity,interval,focus,reset,settings,retry,auto-reload}`, `manual-refresh`, `auto-reload-check`, `auto-reload-verify`, plus bare `widget`. Which one asked is not reconstructable afterwards otherwise: the failures that broke the auto-reload were the scheduler's while the widget's reads were fine.

Levels: success is `info` with the 5-hour figures in the message; a transient failure is `warn`; a credentials problem is `error`, because only that one needs the user to act. Reusing figures we already had and joining an in-flight read are `debug` and say **"nothing was asked"** in those words — they cost Anthropic nothing, and at `info` they would drown the reads that did.

- **The trigger names the mechanism; a `ReadCause` names what actually happened**, in parentheses after it. `widget-activity` gets the sessions Claude answered in (`project · "title"`, resolved server-side from the ids the browser sends, with the full list in `data`) — with several sessions running, "Claude answered" alone identifies nothing. Bare `widget` gets the honest one: **"the browser did not report a cause"**. Every known cause is labelled at its source, so that line means the cause is genuinely unknown rather than merely unwritten. Label new triggers at their source rather than letting them fall through to it.
- **The browser labels its own cause** (`?reason=`, `markUsageRead` before each invalidation), because the server cannot tell "Claude just answered" from "a tab regained focus" — that is the whole value of the line. The route accepts `widget-*` only, so a request cannot pose as one of the server's triggers.
- **The idle poll, the focus refetch and the reconnect refetch are therefore explicit in `UsageWidget`, NOT `refetchInterval` / `refetchOnWindowFocus` / `refetchOnReconnect`**: those fire from inside TanStack where nothing can label them. Do not "simplify" them back — and note `refetchOnReconnect` defaults to **true**, so it must be switched off on that query, not merely left alone. A retry after a failed read is labelled `widget-retry` (`markUsageReadFailed` in `client.ts`), so TanStack's `retry` cannot masquerade as a fresh cause.
- **Bare `widget` is a bug detector, not a supported case.** With every trigger labelled at its source, the only ways left to produce one are a request that never came from the app (curl, the URL pasted in a tab) and a future `invalidateQueries(['usage'])` written without a `markUsageRead` beside it — which is exactly how the mount, the retry and the auto-reload's "Send it now" used to land there. If one shows up in the log, find what is not labelling itself. Do NOT make it guess (inherit the previous cause, assume "mount"): a plausible-looking wrong cause is worse than an admitted unknown, and an unexplained read once being impossible to account for is the whole reason this logging exists.
- `msg` is for reading (local time, app convention); `data` holds the payload **verbatim** as Anthropic sent it, UTC and always-null dollar fields included. The endpoint is undocumented and can change shape, and a log that tidied it would hide exactly that.

The read policy itself — who may ask, how often, what a failure means — is in [AI_RUNNING_CLAUDE.md](AI_RUNNING_CLAUDE.md).

## Retention, reading back, and the viewer

- Retention is `logRetentionDays` (default 14), pruned at startup, on every settings save and at the midnight rollover. A single day is also capped at 16 MB: a warning firing in a loop must not be able to fill the disk.
- **"Delete all logs" closes the stream *before* deleting**, then lets the next record reopen it — otherwise today's file is locked on Windows and "clear" would silently keep it.
- `logReader` caches what it parsed per day and, when a file has only grown, reads only the appended bytes. Those offsets are **byte** offsets: the first non-ASCII character in a message would desynchronise character counts. An unparseable line becomes a visible `warn` record rather than being skipped — a truncated file should show its damage.
- The viewer lives at `/logs`, reachable from Settings and deliberately NOT in the main nav: it is diagnostics, not a feature of the tool.

## Verify

[AI_TESTING.md](AI_TESTING.md) — check 14 (logs), and check 7 for the imported update-helper half.
