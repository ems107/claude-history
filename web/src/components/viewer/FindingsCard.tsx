import { useState } from 'react';
import { parseFileRef } from '../../lib/fileRefs.ts';
import type { Finding, Findings } from '../../lib/findings.ts';
import { Chip } from './Chip.tsx';
import { useFileRefs } from './FileRefContext.ts';
import { FileLink } from './FileRefLink.tsx';
import { FoldHeader } from './FoldHeader.tsx';

/** `_common.ps1:51` — what a reader scans a review by, with the whole path on the hover. */
function Where({ finding }: { finding: Finding }) {
  const ctx = useFileRefs();
  const written = finding.line === null ? finding.file : `${finding.file}:${String(finding.line)}`;
  const name = finding.file.split(/[\\/]/).pop() ?? finding.file;
  const shown = finding.line === null ? name : `${name}:${String(finding.line)}`;
  // The paths a review writes are repo-relative (`scripts/devtools/_common.ps1`),
  // which is exactly what `FileRefContext` resolves against the session's launch
  // cwd — so these open like any other reference, and outside a session they
  // stay the text they were.
  const fileRef = ctx ? parseFileRef(written) : null;
  if (!ctx || !fileRef) {
    return (
      <span className="shrink-0 font-mono text-[11px] text-[var(--text-dim)]" title={written}>
        {shown}
      </span>
    );
  }
  return (
    <FileLink
      ctx={ctx}
      fileRef={fileRef}
      className="shrink-0 cursor-pointer font-mono text-[11px] text-[var(--accent)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
      title={`Open ${written}`}
    >
      {shown}
    </FileLink>
  );
}

/**
 * One finding: its rank, where it is, and what it claims — with the argument
 * folded away.
 *
 * The row is deliberately one line. A finding carries three prose fields and the
 * longest of them is the case for it: the twelve `failure_scenario` of the
 * review in `c483a438` run from 589 to 1,255 characters, and twelve of those
 * open at once is a review nobody scans. So the row shows the compressed label
 * the tool asks for (`short_summary`, capped at 60 characters by its own schema)
 * and keeps the reasoning one click away.
 */
function FindingRow({ finding, rank }: { finding: Finding; rank: number }) {
  const [open, setOpen] = useState(false);
  const label = finding.shortSummary ?? finding.summary;
  const toggle = () => setOpen((v) => !v);
  return (
    <div className="border-t border-[var(--border)]/60 py-1 first:border-t-0">
      {/* The row is TWO headers with the file link between them, not one header
          with a link inside it: `FoldHeader` forbids nesting anything
          interactive, and a click meant for the file would have folded the row
          on its way past. Both halves fold, so the only part of the row that
          does something else is the link itself. */}
      <div className="flex w-full items-center gap-2 text-left text-xs">
        <FoldHeader open={open} onToggle={toggle} className="flex shrink-0 items-center gap-2">
          <span className="text-[var(--text-dim)]">{open ? '▾' : '▸'}</span>
          {/* The order IS the severity — the tool ranks them most-severe first
              and carries no severity field — so the rank is drawn rather than
              guessed into a colour this data cannot support. */}
          <span className="w-4 shrink-0 text-right font-mono text-[10px] text-[var(--text-dim)]">{rank}</span>
          {finding.category && (
            <Chip tone="quiet" title="The kind of finding this is — the review's own `category`.">
              {finding.category}
            </Chip>
          )}
        </FoldHeader>
        <Where finding={finding} />
        <FoldHeader open={open} onToggle={toggle} className="flex min-w-0 flex-1 items-center gap-2">
          {finding.verdict && (
            <Chip tone={finding.verdict === 'CONFIRMED' ? 'warn' : 'quiet'} title="A verify pass reached this verdict.">
              {finding.verdict.toLowerCase()}
            </Chip>
          )}
          {finding.outcome && (
            <Chip tone="quiet" title="What happened to this finding when the fixes were applied.">
              {finding.outcome.replace(/_/g, ' ')}
            </Chip>
          )}
          <span className="min-w-0 flex-1 truncate text-[var(--text)]">{label}</span>
        </FoldHeader>
      </div>
      {open && (
        <div className="mt-1 ml-6 space-y-1.5 text-xs">
          {/* Plain text, not markdown: a finding is a sentence the tool carried,
              and rendering it as markdown would let a stray `#` in a scenario
              become a heading in the middle of a card. */}
          {finding.summary && <div className="whitespace-pre-wrap text-[var(--text)]">{finding.summary}</div>}
          {finding.failureScenario && (
            <div>
              <div className="mb-0.5 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
                Failure scenario
              </div>
              <div className="whitespace-pre-wrap text-[var(--text-dim)]">{finding.failureScenario}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What a code review found, drawn as a part of the conversation rather than as
 * one of the tool calls.
 *
 * `ReportFindings` exists so that a host UI can draw the list — its contract
 * tells the model to report through it and NOT to print the findings as text —
 * so a viewer without a card for it loses the entire product of a review. In
 * `c483a438` that is exactly what the reader hit: the answer beside the call
 * names four of the twelve and points at "el panel de hallazgos de arriba",
 * where there was a collapsed run whose header was 14,348 characters of
 * minified JSON.
 *
 * A REJECTED report is drawn too, and folded. The harness rejects one for a
 * schema slip (a `short_summary` over 60 characters, which is how this corpus's
 * only rejection happened) and the model retries with almost the same list, so
 * the same review appears twice in a row: hiding the first leaves a reader
 * wondering what the error was, and drawing it open makes twelve findings look
 * like twenty-four.
 *
 * The call itself stays in the run behind this, with its raw input, its result
 * and its cost, so a `?tool=` link still lands on exactly that block.
 */
export function FindingsCard({ parsed }: { parsed: Findings }) {
  const count = parsed.findings.length;
  const [open, setOpen] = useState(!parsed.rejected);
  return (
    <div className="my-2 rounded-lg border border-[var(--accent-dim)]/50 bg-[var(--accent)]/5 px-3 py-2">
      <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase">
        <FoldHeader
          open={open}
          onToggle={() => setOpen((v) => !v)}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <span>{open ? '▾' : '▸'}</span>
          <span>
            Code review — {count} finding{count === 1 ? '' : 's'}
          </span>
        </FoldHeader>
        {parsed.level && (
          <Chip tone="quiet" title="The effort the review ran at — its own `level`.">
            {parsed.level}
          </Chip>
        )}
        {parsed.pending && (
          <Chip tone="quiet" title="No result recorded yet: the report was still in flight.">
            still reporting
          </Chip>
        )}
        {parsed.rejected && (
          <Chip tone="warn" title={parsed.rejection ?? 'The harness refused this report.'}>
            rejected — never reported
          </Chip>
        )}
      </div>
      {open && (
        <div className="mt-1.5">
          {count === 0 ? (
            // The honest empty: an empty array is what the tool asks for when
            // nothing survived verification, so this is a review that ran and
            // cleared the diff — not a card with nothing in it.
            <div className="text-xs text-[var(--text-dim)]">
              Nothing survived verification — the review found nothing to report.
            </div>
          ) : (
            parsed.findings.map((f, i) => (
              <FindingRow key={`${f.file}:${String(f.line)}:${String(i)}`} finding={f} rank={i + 1} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
