import type { ClaudeSettingSource } from '@claude-history/shared';
import { Fragment } from 'react';
import { api } from '../../api/client.ts';
import { useHideLocalOnly, useLocalOnly } from '../../api/useLocal.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { actionClass } from '../controlClass.ts';

/**
 * The parts every panel about one of Claude Code's own settings shares: the
 * files it was read from and what each says, the line to add, and the two
 * buttons. Claude Code's settings are read here and never written, so each of
 * these panels says what is in force and hands over the line rather than
 * flipping anything.
 */

/** What one file says, worded and coloured. `offTone` is the colour of an explicit `false`. */
function sourceValue(s: ClaudeSettingSource, offTone: string): { text: string; tone: string } {
  if (s.unreadable) return { text: s.unreadable, tone: 'text-red-400' };
  if (s.on !== null) return { text: s.on ? 'on' : 'off', tone: s.on ? 'text-emerald-400' : offTone };
  if (!s.exists) return { text: 'not there', tone: '' };
  return { text: 'does not set it', tone: '' };
}

function Rows({ sources, label, offTone, envVar }: {
  sources: ClaudeSettingSource[];
  label: (s: ClaudeSettingSource) => string;
  offTone: string;
  envVar?: string;
}) {
  return (
    <div className="grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] text-[var(--text-dim)]">
      {sources.map((s) => {
        const value = sourceValue(s, offTone);
        return (
          <Fragment key={s.path}>
            <span className="opacity-60">{label(s)}</span>
            <span className="break-all">{s.path}</span>
            <span>
              <span className={value.tone}>{value.text}</span>
              {envVar && s.env !== null && (
                <span className="text-amber-400">
                  {' '}
                  · env {envVar}={s.env}
                </span>
              )}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/** The managed policy and the user file, in the order Claude Code reads them. */
export function SettingSourceRows({ sources, offTone = 'text-amber-400', envVar }: {
  sources: ClaudeSettingSource[];
  offTone?: string;
  envVar?: string;
}) {
  return (
    <div className="border-t border-[var(--border)] pt-3">
      <Rows sources={sources} label={(s) => (s.scope === 'policy' ? 'policy' : 'user')} offTone={offTone} envVar={envVar} />
    </div>
  );
}

/** Projects whose own settings files set it, with what that means said above them. */
export function ProjectOverrideRows({ overrides, children, offTone = 'text-amber-400', envVar }: {
  overrides: ClaudeSettingSource[];
  children: React.ReactNode;
  offTone?: string;
  envVar?: string;
}) {
  if (overrides.length === 0) return null;
  return (
    <div className="space-y-1 border-t border-[var(--border)] pt-3">
      <p className="text-amber-400">{children}</p>
      <Rows sources={overrides} label={(s) => s.project?.name ?? s.scope} offTone={offTone} envVar={envVar} />
    </div>
  );
}

/** The line to add, with a button that copies it. */
export function CopyLine({ line, onNote }: { line: string; onNote: (note: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-[12px] text-[var(--text)]">
        {line}
      </code>
      <button
        type="button"
        className={actionClass}
        onClick={() =>
          void copyPlain(line).then(
            () => onNote('Copied — paste it inside the braces, with a comma after the line before it.'),
            (err: unknown) => onNote(`Could not copy: ${err instanceof Error ? err.message : String(err)}`),
          )
        }
      >
        Copy the line
      </button>
    </div>
  );
}

/** Refresh, and opening the folder the file is in. */
export function SettingButtons({ isFetching, onRefresh, note }: {
  isFetching: boolean;
  onRefresh: () => void;
  note: string | null;
}) {
  const claudeFolder = useLocalOnly('openClaudeFolder');
  const hideLocal = useHideLocalOnly();
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <button type="button" className={actionClass} onClick={onRefresh} disabled={isFetching}>
        {isFetching ? 'Reading…' : 'Refresh'}
      </button>
      {!hideLocal && (
        <button
          type="button"
          className={actionClass}
          onClick={() => void api.openClaudeSettingsFolder()}
          disabled={claudeFolder.disabled}
          title={claudeFolder.reason ?? undefined}
        >
          Open the folder
        </button>
      )}
      {note && <span className="text-[11px] text-[var(--text-dim)]">{note}</span>}
    </div>
  );
}
