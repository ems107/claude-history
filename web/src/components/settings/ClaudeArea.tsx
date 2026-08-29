import {
  ACTIVE_SESSIONS_MAX,
  ACTIVE_SESSIONS_MIN,
  CHAT_IDLE_TIMEOUT_MINUTES,
  CLAUDE_MODELS,
  DEFAULT_SETTINGS,
  MIN_USAGE_INTERVAL_SECONDS,
  MIN_USAGE_RATE_LIMIT_SECONDS,
} from '@claude-history/shared';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { useActiveSessions } from '../../api/useActiveSessions.ts';
import { useLocalOnly } from '../../api/useLocal.ts';
import { actionClass } from '../controlClass.ts';
import { AutoReloadStatus } from './AutoReloadStatus.tsx';
import { useSettingsPage } from './context.ts';
import {
  Explain,
  GroupCard,
  NumberField,
  RadioField,
  SelectField,
  Subgroup,
  TextField,
  ToggleField,
} from './controls.tsx';

/**
 * Everything that reads your subscription or runs Claude Code on this machine.
 *
 * These were three separate sections in three different places on the old page,
 * two of which had to refer to each other in prose to be understood ("unlike the
 * usage widget above"). They are one subject: the 5-hour window — what reads it,
 * what starts it, and what spends it.
 *
 * All three groups are FEATURES, so all three carry a `master`: one switch above
 * a rule, and everything under it inert but readable while it is off.
 */
export function ClaudeArea() {
  const { settings: s, save } = useSettingsPage();
  // Only to SAY how many are running, beside the cap. Nothing here is disabled
  // from it: the server is what refuses, and its refusal is the dialog.
  const { data: active } = useActiveSessions();
  const browse = useLocalOnly('pickFolder');
  const [browsing, setBrowsing] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const usageOff = !s.usageWidget;
  const reloadOff = !s.autoReloadEnabled;

  /** The Windows folder browser, on the server's own desktop. */
  const browseForFolder = () => {
    setBrowsing(true);
    setPickError(null);
    api
      .pickFolder(s.autoReloadCwd || undefined)
      // null is Cancel, and leaves what is saved alone.
      .then((picked) => picked && save({ autoReloadCwd: picked }))
      .catch((e: unknown) => setPickError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBrowsing(false));
  };

  return (
    <>
      <GroupCard
        id="usage"
        master="usageWidget"
        masterHint="Reads the token Claude Code already stored — never refreshed, never modified — and asks Anthropic for the same figures /usage shows."
        offNote="The widget is hidden and nothing below is read, so this app asks Anthropic nothing at all."
      >
        <NumberField
          field="usageMinIntervalSeconds"
          before="Ask Anthropic at most once every"
          after={`seconds (minimum ${MIN_USAGE_INTERVAL_SECONDS})`}
          min={MIN_USAGE_INTERVAL_SECONDS}
          max={3600}
          step={5}
          disabled={usageOff}
          note="The floor for every trigger below and for the 5-hour auto-start, which all share one reading."
        />
        <NumberField
          field="usageRateLimitBackoffSeconds"
          before="After a rate limit (HTTP 429), wait"
          after={`seconds (minimum ${MIN_USAGE_RATE_LIMIT_SECONDS})`}
          min={MIN_USAGE_RATE_LIMIT_SECONDS}
          max={7200}
          step={60}
          disabled={usageOff}
          note="Takes the floor above over for as long as it lasts, and silences every trigger."
        />

        {/* Each trigger is a switch, and the ones with a number carry it inline:
            a cadence you cannot see next to its own switch is a setting you have
            to go looking for. */}
        <Subgroup title="Re-read the figures:">
          <ToggleField
            field="usageOnActivity"
            disabled={usageOff}
            hint="The only local event that means tokens were just spent."
          />
          <ToggleField
            field="usageOnInterval"
            disabled={usageOff}
            hint="Catches usage burnt somewhere else — another machine, the web app, your phone."
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
            hint="Fires on every tab switch and every unminimize — far more often than it sounds."
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
            hint="Nothing else announces a window dropping back to 0%."
          />
        </Subgroup>

        <Explain label="What the two waits really do, and the reads with no switch">
          <p>
            Anything asking sooner than the floor is given the figures already in hand, at no cost. A{' '}
            <span className="text-[var(--text)]">429</span> is Anthropic saying outright that we ask too often, so it
            replaces the floor for as long as it lasts. <span className="text-[var(--text)]">Refresh</span>, in the
            usage popover, is the one read that ignores both and always asks.
          </p>
          <p>
            <span className="text-[var(--text)]">When Claude answers</span> means an assistant reply being written.
            Your own prompts, tool results and the bookkeeping lines rewritten every turn are ignored — they move the
            file, not the figures.
          </p>
          <p>
            Two more read on their own and have no switch, because neither can be an unwanted read:{' '}
            <span className="text-[var(--text)]">opening the page</span>, and{' '}
            <span className="text-[var(--text)]">getting your connection back</span> after being offline.
          </p>
          <p>
            If a read fails, the last figures stay on screen marked as old (amber border) instead of the widget going
            blank. Every read is written to the log with what caused it.
          </p>
        </Explain>
      </GroupCard>

      <GroupCard
        id="auto-reload"
        master="autoReloadEnabled"
        masterHint="A window only starts when something is sent, so an idle night pushes the next reset into the middle of your day."
        offNote="Nothing is read and nothing is sent. Windows start whenever you happen to send the first prompt."
      >
        <SelectField
          field="autoReloadModel"
          before="Model"
          options={CLAUDE_MODELS}
          disabled={reloadOff}
          after={<span className="text-[var(--text-dim)]">the cheapest is enough — the reply is thrown away</span>}
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
          hint={pickError ?? 'Claude Code needs a real working directory; a throwaway folder is the right one.'}
          after={
            <button
              type="button"
              className={actionClass}
              disabled={reloadOff || browsing || browse.disabled}
              title={browse.reason ?? 'Opens the Windows folder browser on this machine'}
              onClick={browseForFolder}
            >
              {browsing ? 'Browsing…' : 'Browse…'}
            </button>
          }
        />
        <ToggleField
          field="autoReloadHideSessions"
          disabled={reloadOff}
          hint="Leaves that folder out of the list, the filters, the counts, search, the stats and the prompts page."
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
              stays in your history: nothing here ever deletes anything from your Claude data. That is what{' '}
              <em>Hide that folder's sessions</em> is for.
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

      <GroupCard
        id="chat"
        master="chatEnabled"
        masterHint="Continue a conversation without leaving the app. Nothing is spawned until you press a button or type a prompt."
        offNote="No composer and no terminal appear at the foot of a session. Nothing else changes: every conversation still reads exactly as it did."
      >
        <RadioField
          field="chatMode"
          name="chat-mode"
          disabled={!s.chatEnabled}
          options={[
            {
              value: 'terminal',
              label: 'An embedded terminal running the Claude Code CLI',
              hint: 'The real CLI, drawn in the page — everything the terminal can do and nothing the app adds. It keeps running while you read other sessions.',
            },
            {
              value: 'composer',
              label: 'A composer at the foot of the conversation (experimental)',
              hint: 'A box you type into — questions as buttons, plans commented passage by passage, model and effort beside Send. All of it drawn by this app, which is what makes it the experimental one.',
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
          note="Both doors counted together. Lowering it never closes anything; it refuses the next one to ask."
        />

        <Explain label="What is not set here, and what locks while Claude is running">
          <p>
            The model and effort are not set here: the composer starts each session from whatever that conversation was
            last answered with, and you change them per session there; a terminal is asked inside the CLI, with{' '}
            <span className="text-[var(--text)]">/model</span>. The composer runs tools under Claude Code's{' '}
            <span className="text-[var(--text)]">auto</span> permission mode, so it only stops when it genuinely needs
            you — and then it asks in the conversation, above the box. Your MCP servers are loaded as usual either way,
            so the first prompt of a session takes a moment longer than the ones after it. A terminal is never closed by
            a timer and survives closing the tab: it belongs to the server, so you come back to it still running.
          </p>
          <p>
            An idle composer process closes itself after{' '}
            <span className="text-[var(--text)]">{CHAT_IDLE_TIMEOUT_MINUTES} minutes</span>, and that number is not a
            preference. Claude's prompt cache lives for an hour, and a CLI that restarts while it is still warm has to
            rewrite the whole prompt often enough to matter — so a shorter timeout would cost you money rather than save
            it, and once the hour is up there is nothing left to lose.
          </p>
          <p>
            While the app is running Claude, the two settings above are <span className="text-[var(--text)]">locked</span>
            {' '}— and so are stopping the server, restarting it, installing an update, clearing the cache and restoring a
            copy of your data. Each of those would end a session that is still holding its transcript, so each of them
            says how many are running, which they are, and offers to close them for you.
          </p>
        </Explain>
      </GroupCard>
    </>
  );
}
