import type { SessionDetail, SessionSummary } from '@claude-history/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocalOnly } from '../../api/useLocal.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { downloadMarkdown, type ExportOptions } from '../../lib/exportMarkdown.ts';
import { usePopover } from '../../lib/popover.ts';
import { toggleClass } from './controlClass.ts';

/**
 * What can be DONE with a session, as opposed to how it is read: rename it, pin
 * it, export it, open the folder it lives in, open it in VS Code, pick it up in
 * a terminal, copy the command that would.
 *
 * All of it behind one `⋯`, which is what took nine buttons out of a row that
 * had eighteen. Nothing here is a mode and nothing here is consulted while
 * reading — every one of them is a thing you decide to do and then do once.
 */
function useSessionActions(session: SessionSummary) {
  const [copied, setCopied] = useState(false);
  const [state, setState] = useState<'idle' | 'launching' | 'ok' | 'error'>('idle');
  const [error, setError] = useState('');
  // Three of them open a window on the machine the server runs on, so from
  // another one they are dead. The server refuses them too (409) — this is the
  // half that says why before the click.
  const folder = useLocalOnly('openFolder');
  const vscode = useLocalOnly('openVsCode');
  const terminal = useLocalOnly('resumeTerminal');

  // PowerShell-friendly (the machine's default shell); works in cmd too if
  // pasted as two commands.
  const command = `cd "${session.projectPath}"; claude --resume ${session.id}`;

  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setState('error');
    setTimeout(() => setState('idle'), 4000);
  };

  const copy = () => {
    void copyPlain(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const launch = () => {
    setState('launching');
    fetch(`/api/sessions/${session.id}/resume`, { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${r.status}`);
        }
        setState('ok');
        setTimeout(() => setState('idle'), 2000);
      })
      .catch(fail);
  };

  // The reply is read rather than dropped: this endpoint can answer 409 (from
  // another machine it opens nothing) and 500 (no VS Code on PATH), and a
  // button that swallows both looks like it worked.
  const openTarget = (target: 'explorer' | 'vscode') => {
    fetch(`/api/sessions/${session.id}/open?target=${target}`, { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${r.status}`);
        }
      })
      .catch(fail);
  };

  /**
   * Resuming a session something else already holds gives the transcript two
   * writers, which is what leaves the duplicated uuids the parser has to undo.
   * The server refuses it (409) and that is the authority; this only says so
   * before the click, because an action that launches nothing and explains
   * afterwards is the worse version.
   */
  const holder = session.live;

  return {
    command,
    copied,
    copy,
    folder: {
      disabled: folder.disabled,
      reason: folder.reason ?? `Open ${session.projectPath} in Explorer`,
      run: () => openTarget('explorer'),
    },
    vscode: {
      disabled: vscode.disabled,
      reason: vscode.reason ?? `Open ${session.projectPath} in VS Code`,
      run: () => openTarget('vscode'),
    },
    resume: {
      disabled: state === 'launching' || holder !== null || terminal.disabled,
      reason:
        state === 'error'
          ? error
          : (terminal.reason ??
            (holder
              ? `This session is already open (pid ${String(holder.pid)}) — close it there first`
              : `Open a terminal in ${session.projectPath} and resume this session`)),
      // The label says which of the five states it is in rather than waiting to
      // be hovered: inside a menu, the words are all there is.
      label:
        state === 'launching'
          ? 'Launching…'
          : state === 'ok'
            ? 'Launched ✓'
            : state === 'error'
              ? 'Failed ✕'
              : holder
                ? 'Already open elsewhere'
                : 'Resume in terminal',
      run: launch,
    },
  };
}

const icon = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: 'size-3.5 shrink-0',
};

function PencilIcon() {
  return (
    <svg {...icon}>
      <path d="M11.1 2.6a1.6 1.6 0 0 1 2.3 2.3L5.7 12.5l-3.1.8.8-3.1Z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg {...icon}>
      <path d="M1.9 4.4A1.3 1.3 0 0 1 3.2 3.1h2.5L7 4.6h5.8a1.3 1.3 0 0 1 1.3 1.3v6a1.3 1.3 0 0 1-1.3 1.3H3.2a1.3 1.3 0 0 1-1.3-1.3V4.4Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg {...icon}>
      <rect x="5.6" y="5.6" width="8" height="8" rx="1.4" />
      <path d="M10.4 2.4H3.1a.7.7 0 0 0-.7.7v7.3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg {...icon}>
      <path d="M8 2.5v7.5" />
      <path d="M5 7 8 10 11 7" />
      <path d="M2.8 12.8h10.4" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className="size-3.5 shrink-0">
      <circle cx="3.2" cy="8" r="1.15" />
      <circle cx="8" cy="8" r="1.15" />
      <circle cx="12.8" cy="8" r="1.15" />
    </svg>
  );
}

function Section({ label }: { label: string }) {
  return (
    <div className="mt-1 mb-0.5 px-1.5 text-[10px] font-semibold tracking-wider text-[var(--text-dim)]/60 uppercase">
      {label}
    </div>
  );
}

function Item({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: import('react').ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className="flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:text-[var(--text-dim)]/55 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/**
 * Everything you can do with this session, behind one `⋯`.
 *
 * Export keeps its four options, on a second page of the same menu rather than
 * in a popover of its own: they are the same gesture — say what goes in the
 * file, then download it.
 *
 * Renaming and pinning are here rather than as glyphs that appear beside the
 * title on hover. What appears on hover is invisible until the pointer happens
 * to be in the right place, and both of these are things you go looking for.
 * The pinned STATE is still visible without hovering anything: it is the ★
 * badge beside the title, which is where a state belongs.
 */
export function SessionMenu({
  detail,
  draft,
  onRename,
}: {
  detail: SessionDetail;
  draft?: boolean;
  /** Starts the title editor, which the header draws where the title is. */
  onRename: () => void;
}) {
  const pop = usePopover<HTMLDivElement>();
  const a = useSessionActions(detail.summary);
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [opts, setOpts] = useState<ExportOptions>({
    includeTools: true,
    includeThinking: false,
    includeSystem: false,
    includeImages: true,
  });
  const s = detail.summary;

  const check = (key: keyof ExportOptions, label: string) => (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs select-none hover:bg-[var(--bg-hover)]">
      <input
        type="checkbox"
        checked={opts[key]}
        onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })}
        className="accent-[var(--accent)]"
      />
      {label}
    </label>
  );

  const pin = () => {
    void api.pinSession(s.id, !s.pinned).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['session', s.id] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    });
  };

  return (
    <div ref={pop.ref} className="relative inline-block">
      <button
        type="button"
        onClick={pop.toggle}
        className={toggleClass(pop.open)}
        title="What can be done with this session"
        aria-label="Session actions"
      >
        <DotsIcon />
      </button>
      {pop.open && (
        <div className="absolute right-0 z-30 mt-1 w-60 rounded border border-[var(--border)] bg-[var(--bg-raised)] p-2 shadow-xl">
          {exporting ? (
            <>
              <Section label="What goes in the file" />
              {check('includeTools', 'Tool calls')}
              {check('includeThinking', 'Thinking')}
              {check('includeSystem', 'System messages')}
              {check('includeImages', 'Embedded images')}
              <button
                type="button"
                onClick={() => {
                  downloadMarkdown(detail, opts);
                  setExporting(false);
                  pop.close();
                }}
                className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded border border-[var(--accent-dim)] px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10"
              >
                <DownloadIcon />
                Download .md
              </button>
            </>
          ) : (
            <>
              <Section label="This session" />
              {/* Both act on an id the index has never heard of while the
                  session is only a reservation: the endpoints answer 404. */}
              {!draft && (
                <>
                  <Item
                    onClick={() => {
                      pop.close();
                      onRename();
                    }}
                    title="Rename locally (stored in this tool only; never writes to ~/.claude)"
                  >
                    <PencilIcon />
                    Rename locally
                  </Item>
                  <Item onClick={pin} title={s.pinned ? 'Unpin (stored locally)' : 'Pin (stored locally)'}>
                    <span aria-hidden className="w-3.5 shrink-0 text-center text-sm text-amber-400">
                      {s.pinned ? '★' : '☆'}
                    </span>
                    {s.pinned ? 'Unpin' : 'Pin'}
                  </Item>
                </>
              )}
              <Item onClick={() => setExporting(true)} title="Export this conversation as a Markdown file">
                <DownloadIcon />
                Export as Markdown…
              </Item>
              {!draft && (
                <>
                  <div className="my-1.5 -mx-2 h-px bg-[var(--border)]" />
                  <Section label="Open on this machine" />
                  <Item onClick={a.folder.run} disabled={a.folder.disabled} title={a.folder.reason}>
                    <FolderIcon />
                    Project folder
                  </Item>
                  <Item onClick={a.vscode.run} disabled={a.vscode.disabled} title={a.vscode.reason}>
                    <span aria-hidden className="w-3.5 shrink-0 text-center font-mono text-[11px]">
                      {'{}'}
                    </span>
                    VS Code
                  </Item>
                  <Item onClick={a.resume.run} disabled={a.resume.disabled} title={a.resume.reason}>
                    {/* Same ❯ the "cli" entrypoint chip uses. */}
                    <span aria-hidden className="w-3.5 shrink-0 text-center text-xs">
                      ❯
                    </span>
                    {a.resume.label}
                  </Item>
                  {/* Live from anywhere, including another machine, where it is
                      the only one of these that still does something useful. */}
                  <Item onClick={a.copy} title={a.command}>
                    <CopyIcon />
                    {a.copied ? 'Copied ✓' : 'Copy resume command'}
                  </Item>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
