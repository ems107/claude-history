import {
  ACTIVE_SESSIONS_MAX,
  ACTIVE_SESSIONS_MIN,
  CHAT_IDLE_TIMEOUT_MINUTES,
  CLAUDE_MODELS,
  DEFAULT_SETTINGS,
  MIN_USAGE_INTERVAL_SECONDS,
  MIN_USAGE_RATE_LIMIT_SECONDS,
} from '@claude-history/shared';
import { useActiveSessions } from '../../api/useActiveSessions.ts';
import { AutoReloadStatus } from './AutoReloadStatus.tsx';
import { useSettingsPage } from './context.ts';
import { Explain, GroupCard, NumberField, RadioField, SelectField, Subgroup, TextField, ToggleField } from './controls.tsx';

/**
 * Everything that reads your subscription or runs Claude Code on this machine.
 *
 * These were three separate sections in three different places on the old page,
 * two of which had to refer to each other in prose to be understood ("unlike the
 * usage widget above"). They are one subject: the 5-hour window — what reads it,
 * what starts it, and what spends it.
 */
export function ClaudeArea() {
  const { settings: s } = useSettingsPage();
  // Only to SAY how many are running, beside the cap. Nothing here is disabled
  // from it: the server is what refuses, and its refusal is the dialog.
  const { data: active } = useActiveSessions();
  const usageOff = !s.usageWidget;
  const reloadOff = !s.autoReloadEnabled;

  return (
    <>
      <GroupCard id="usage">
        <ToggleField
          field="usageWidget"
          hint="Reads the OAuth token stored by Claude Code (read-only, never refreshed or modified) and asks Anthropic for the same 5-hour and weekly figures /usage shows."
        />
        <NumberField
          field="usageMinIntervalSeconds"
          before="Ask Anthropic at most once every"
          after={`seconds (minimum ${MIN_USAGE_INTERVAL_SECONDS})`}
          min={MIN_USAGE_INTERVAL_SECONDS}
          max={3600}
          step={5}
          disabled={usageOff}
          note="The floor for every trigger below and for the 5-hour auto-start, which all share one reading. Anything asking sooner is given the figures already in hand, at no cost. The Refresh button is the one exception."
        />
        <NumberField
          field="usageRateLimitBackoffSeconds"
          before="After a rate limit (HTTP 429), wait"
          after={`seconds (minimum ${MIN_USAGE_RATE_LIMIT_SECONDS})`}
          min={MIN_USAGE_RATE_LIMIT_SECONDS}
          max={7200}
          step={60}
          disabled={usageOff}
          note="A 429 is Anthropic saying outright that we ask too often, so it replaces the floor above for as long as it lasts and silences every trigger — again, except Refresh. The last figures stay on screen meanwhile."
        />

        {/* Each trigger is a switch, and the ones with a number carry it inline:
            a cadence you cannot see next to its own switch is a setting you have
            to go looking for. */}
        <Subgroup title="Re-read the figures:">
          <ToggleField
            field="usageOnActivity"
            disabled={usageOff}
            hint="The trigger that matters: an assistant reply being written is the only local event that means tokens were just spent. Your own prompts, tool results and the bookkeeping lines rewritten every turn are ignored — they move the file, not the figures."
          />
          <ToggleField
            field="usageOnInterval"
            disabled={usageOff}
            hint="Its one job is catching usage burnt somewhere else — another machine, the web app, your phone."
          >
            <NumberField
              field="usageIntervalSeconds"
              before="every"
              after="seconds"
              min={MIN_USAGE_INTERVAL_SECONDS}
              max={3600}
              step={15}
              disabled={usageOff || !s.usageOnInterval}
            />
          </ToggleField>
          <ToggleField
            field="usageOnFocus"
            disabled={usageOff}
            hint="Fires on every tab switch and every unminimize, which is far more often than it sounds — hence the tolerance below."
          >
            <NumberField
              field="usageFocusMaxAgeSeconds"
              before="but only if the figures are older than"
              after="seconds (0 = always)"
              min={0}
              max={3600}
              step={15}
              disabled={usageOff || !s.usageOnFocus}
            />
          </ToggleField>
          <ToggleField
            field="usageOnReset"
            disabled={usageOff}
            hint="Nothing here announces a window dropping back to 0%, so without this the widget shows the old percentage until something else asks."
          />
        </Subgroup>

        <Explain label="The reads with no switch, and what happens when one fails">
          <p>
            Two more read on their own and have no switch, because neither can be an unwanted read:{' '}
            <span className="text-[var(--text)]">opening the page</span>, and{' '}
            <span className="text-[var(--text)]">getting your connection back</span> after being offline.
          </p>
          <p>
            <span className="text-[var(--text)]">On demand</span> always works, with the Refresh button inside the usage
            popover — the only read that ignores both waits above, always asking Anthropic.
          </p>
          <p>
            If a read fails, the last figures stay on screen marked as old (amber border) instead of the widget going
            blank. Every read is written to the log with what caused it.
          </p>
        </Explain>
      </GroupCard>

      <GroupCard id="auto-reload">
        <ToggleField
          field="autoReloadEnabled"
          hint="A window only starts when something is sent, so an idle night leaves it unstarted and pushes the next reset into the middle of your day. This sends one throwaway message to start it right away."
        />
        <SelectField
          field="autoReloadModel"
          before="Model"
          options={CLAUDE_MODELS}
          disabled={reloadOff}
          after={<span className="text-[var(--text-dim)]">the cheapest one is enough — the reply is thrown away</span>}
        />
        <TextField
          field="autoReloadMessage"
          label="Message to send"
          placeholder={DEFAULT_SETTINGS.autoReloadMessage}
          disabled={reloadOff}
        />
        <TextField
          field="autoReloadCwd"
          label={
            <>
              Folder to run it in <span className="text-[var(--text-dim)]">(required)</span>
            </>
          }
          placeholder="C:\\some\\folder"
          mono
          disabled={reloadOff}
        />
        <ToggleField
          field="autoReloadHideSessions"
          disabled={reloadOff}
          hint="Everything in the folder above is left out of the session list, the project filters, the counts, search, the stats and the prompts page. Nothing is deleted: the sessions stay on disk and a direct link still opens them."
        />

        <Explain>
          <ul className="ml-4 list-disc space-y-1 marker:text-[var(--text-dim)]/50">
            <li>
              <span className="text-[var(--text)]">It does not poll.</span> Every reading says exactly when the window
              expires, so it sleeps until that moment plus a minute and only then asks again — about five reads a day.
            </li>
            <li>
              <span className="text-[var(--text)]">No browser needed.</span> This one runs in the server, unlike the
              usage widget above, so it keeps working with the app closed — as long as the machine is on and you are
              logged in.
            </li>
            <li>
              <span className="text-[var(--text)]">Each message leaves a real session</span> in the folder above, and it
              stays in your history: nothing here ever deletes anything from your Claude data. That is what the option
              above is for.
            </li>
            <li>
              <span className="text-[var(--text)]">It knows when to stop.</span> A failed reading is never mistaken for
              a free window, there is half an hour between messages whatever happens, and after three failed attempts in
              a row it pauses itself and says why.
            </li>
          </ul>
        </Explain>

        <AutoReloadStatus />
      </GroupCard>

      <GroupCard id="chat">
        <ToggleField
          field="chatEnabled"
          hint="Continue a conversation without leaving the app, in whichever of the two ways you pick below. Either way it runs Claude Code on this machine, in that session's own folder, and the answer appears in the viewer as it is written to the transcript."
        />
        <RadioField
          field="chatMode"
          name="chat-mode"
          disabled={!s.chatEnabled}
          options={[
            {
              value: 'terminal',
              label: 'An embedded terminal running the Claude Code CLI',
              hint: 'The real CLI, drawn in the page where the box would be — resizable by dragging its top edge, and collapsible to a single line when you want the conversation back. Everything the terminal can do and nothing the app adds, and it keeps running while you read other sessions.',
            },
            {
              value: 'composer',
              label: 'A composer at the foot of the conversation (experimental)',
              hint: 'A box you type a prompt into. Questions arrive as buttons, plans can be read full screen and commented passage by passage, and the model, effort and plan mode are pickers beside Send — all of it drawn by this app rather than by Claude Code, which is what makes it the experimental one.',
            },
          ]}
        />
        <NumberField
          field="maxActiveSessions"
          before="Run at most"
          min={ACTIVE_SESSIONS_MIN}
          max={ACTIVE_SESSIONS_MAX}
          after={
            <span>
              sessions at once
              {active && active.sessions.length > 0 && (
                <span className="text-[var(--text)]"> — {active.sessions.length} running right now</span>
              )}
            </span>
          }
        />

        <Explain label="What is not set here, and what locks while Claude is running">
          <p>
            The model and effort are not set here: the composer starts each session from whatever that conversation was
            last answered with, and you change them per session there; a terminal is asked inside the CLI, with{' '}
            <span className="text-[var(--text)]">/model</span>. The composer runs tools under Claude Code's{' '}
            <span className="text-[var(--text)]">auto</span> permission mode, so it only stops when it genuinely needs
            you — and then it asks in the conversation, above the box; a terminal asks exactly as it would anywhere else.
            Your MCP servers are loaded as usual either way, so the first prompt of a session takes a moment longer than
            the ones after it. A terminal is never closed by a timer, and it survives closing the tab: it belongs to the
            server, so you come back to it still running.
          </p>
          <p>
            An idle composer process closes itself after{' '}
            <span className="text-[var(--text)]">{CHAT_IDLE_TIMEOUT_MINUTES} minutes</span>, and that number is not a
            preference. Claude's prompt cache lives for an hour, and a CLI that restarts while it is still warm has to
            rewrite the whole prompt often enough to matter — so a shorter timeout would cost you money rather than save
            it, and once the hour is up there is nothing left to lose. Either mode can also be closed by hand, and that
            asks first only while there is something to lose — a warm cache, or an answer in flight; otherwise it just
            closes.
          </p>
          <p>
            While the app is running Claude, the two settings above are <span className="text-[var(--text)]">locked</span>
            {' '}— and so are stopping the server, restarting it, installing an update, clearing the cache and restoring a
            copy of your data. Each of those would end a session that is still holding its transcript, so each of them
            says how many are running, which they are, and offers to close them for you. The number above is not one of
            them: lowering it never closes anything, it only refuses the next one to ask.
          </p>
        </Explain>
      </GroupCard>
    </>
  );
}
