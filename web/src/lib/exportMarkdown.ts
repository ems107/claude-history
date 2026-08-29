import type { ContentBlock, MessageItem, SessionDetail } from '@claude-history/shared';
import { parseAskUserQuestion } from '../components/viewer/AnsweredQuestion.tsx';
import { parseSentFiles } from './sentFiles.ts';
import { parseFindings } from './findings.ts';
import { formatDateTime, shortModel } from './format.ts';
import { parsePlan, parsePlanFeedback } from './plans.ts';
import { systemLabel } from './systemLines.ts';

export interface ExportOptions {
  includeTools: boolean;
  includeThinking: boolean;
  includeSystem: boolean;
  /** Embed attachments as data URIs — self-contained, but one long line each. */
  includeImages: boolean;
}

/** Fence arbitrary content safely: use more backticks than the content contains. */
function fence(text: string, lang = ''): string {
  const ticks = /`{3,}/.exec(text) ? '`'.repeat(Math.max(...[...text.matchAll(/`{3,}/g)].map((m) => m[0].length)) + 1) : '```';
  return `${ticks}${lang}\n${text}\n${ticks}`;
}

function itemHeader(item: MessageItem): string {
  const time = item.timestamp ? ` — ${formatDateTime(item.timestamp)}` : '';
  if (item.role === 'user') return `## 👤 User${time}`;
  const model = item.model ? ` (${shortModel(item.model)})` : '';
  return `## 🤖 Assistant${model}${time}`;
}

/** A system item: a /context run and a compaction carry figures, not text. */
function systemLines(item: MessageItem): string[] {
  const first = item.blocks[0];
  if (first?.kind === 'context') {
    const s = first.snapshot;
    const window = s.limitTokens === null ? '' : ` of ${s.limitTokens.toLocaleString()}`;
    const pct = s.reportedPct === null ? '' : ` (${s.reportedPct}%)`;
    return [
      `> ⚙️ **/context:** ${s.reportedTokens?.toLocaleString() ?? '—'}${window} tokens${pct} — ` +
        s.categories.map((c) => `${c.label} ${c.tokens.toLocaleString()}`).join(' · '),
      '',
    ];
  }
  if (first?.kind === 'compact') {
    const b = first.boundary;
    return [
      `> ⚙️ **Conversation compacted**${b.trigger ? ` (${b.trigger})` : ''}: ` +
        `${b.preTokens?.toLocaleString() ?? '—'} → ${b.postTokens?.toLocaleString() ?? '—'} tokens`,
      '',
    ];
  }
  // Not chrome: without it the reply above just ends mid-sentence for no stated
  // reason. Which is why the caller exports this one whatever the system option
  // says.
  if (first?.kind === 'interrupt') {
    return [`> ⏹ **Interrupted** — the user stopped Claude ${first.forToolUse ? 'at a tool call' : 'mid-answer'}.`, ''];
  }
  if (first?.kind === 'plan-mode') {
    const label = {
      enter: 'Entered plan mode',
      reentry: 'Back in plan mode',
      exit: 'Left plan mode',
      reference: 'The plan was carried through a compaction',
    }[first.event];
    const out = [`> 📝 **${label}**${first.planFilePath ? ` — \`${first.planFilePath}\`` : ''}`, ''];
    // The copy re-injected around a compaction is the plan itself, so it is
    // exported as the markdown it is rather than as a note that it existed.
    if (first.planContent) {
      out.push('<details>', '<summary>📝 The plan</summary>', '', first.planContent, '', '</details>', '');
    }
    return out;
  }
  const text = first?.kind === 'text' ? first.text : '';
  // The same name the chip shows — an export that called it `away_summary`
  // while the page called it a recap would be a second answer to one question.
  return [`> ⚙️ **${systemLabel(item.systemSubtype)}:** ${text.replace(/\n/g, ' ').slice(0, 500)}`, ''];
}

/**
 * One message as markdown. Shared by the session export and the per-message
 * copy button, which is the whole point: the two used to be able to disagree
 * about what a message even contains.
 *
 * `blocks` is passed separately because the caller may hold a filtered view of
 * them (the viewer hides thinking, and renders tool runs outside the bubble).
 */
function contentLines(
  item: MessageItem,
  blocks: readonly ContentBlock[],
  opts: ExportOptions,
  withHeader: boolean,
): string[] {
  const out: string[] = [];
  let headerWritten = !withHeader;
  const writeHeader = () => {
    if (!headerWritten) {
      out.push(itemHeader(item), '');
      headerWritten = true;
    }
  };

  for (const block of blocks) {
    switch (block.kind) {
      case 'text':
        writeHeader();
        out.push(block.text, '');
        break;
      case 'command':
        writeHeader();
        out.push(`\`❯ ${block.text}\``, '');
        break;
      case 'thinking':
        if (!opts.includeThinking) break;
        writeHeader();
        out.push('<details>', '<summary>💭 Thinking</summary>', '', block.text, '', '</details>', '');
        break;
      case 'tool': {
        // A plan is prose, and a plan run through `JSON.stringify` is prose
        // with every newline escaped — i.e. the one block of an export nobody
        // can read. It is exported as the markdown it is, whatever the tool
        // options say: it is not tool traffic, it is the decision.
        const plan = parsePlan(block);
        if (plan) {
          writeHeader();
          const verdict =
            plan.status === 'approved' ? '✔ approved' : plan.status === 'rejected' ? '✖ not approved' : 'awaiting an answer';
          out.push(`> 📝 **Plan — ${verdict}**${plan.filePath ? ` — \`${plan.filePath}\`` : ''}`, '');
          if (plan.text) out.push('<details>', '<summary>📝 The plan</summary>', '', plan.text, '', '</details>', '');
          if (plan.feedback) {
            // Same two halves the card draws, for the reason `parsePlan` is pure:
            // flattened to one line, a plan sent back with comments exported as an
            // unreadable run of `[Re: "…"]` brackets.
            const { note, comments } = parsePlanFeedback(plan.feedback);
            if (note) out.push(`> **The user said:** ${note.replace(/\n/g, ' ')}`, '');
            for (const c of comments) {
              const where = c.heading ? ` — under *${c.heading}*` : '';
              out.push(`> - “${c.quote}”${where}: **${c.text.replace(/\n/g, ' ')}**`);
            }
            if (comments.length > 0) out.push('');
          }
          break;
        }
        // Same reason as the plan above: an answered question is a turn of the
        // conversation, not tool traffic, and stringifying it buries the one
        // line worth reading under the JSON of everything that was offered —
        // several KB of it once the options carry drawings.
        const asked = parseAskUserQuestion(block);
        if (asked) {
          writeHeader();
          out.push(`> ❓ **Assistant asked${asked.declined ? ' — declined' : ''}**`, '');
          for (const q of asked.questions) {
            out.push(`> **${q.header || 'Question'}** — ${q.question.replace(/\n/g, ' ')}`, '');
            for (const o of q.options) {
              const taken = q.picked.includes(o.label);
              out.push(`> - ${taken ? '**●' : '○'} ${o.label}${taken ? '**' : ''}`);
              // The drawing goes in a fence of its own: it is the thing that was
              // compared, and a blockquote would collapse its whitespace away.
              if (o.preview) out.push('', fence(o.preview), '');
            }
            if (q.typed) out.push(`> - **✎ ${q.typed}** (typed ${q.picked.length > 0 ? 'as well' : 'instead'})`);
            if (q.notes) out.push(`> - ✎ *${q.notes.replace(/\n/g, ' ')}*`);
            out.push('');
          }
          if (asked.response) out.push(`> **The user replied:** ${asked.response.replace(/\n/g, ' ')}`, '');
          break;
        }
        // And the third for the same reason: files handed to the user are the
        // delivery, not the plumbing that carried it. Unlike an attached image
        // there is nothing to embed — `SendUserFile` keeps no bytes anywhere in
        // the payload — so the export names the files and says where they are,
        // rather than implying it contains them.
        const sent = parseSentFiles(block);
        if (sent) {
          writeHeader();
          out.push(
            `> 📎 **Assistant sent ${String(sent.files.length)} file${sent.files.length === 1 ? '' : 's'}**${
              sent.failed ? ' — the delivery failed' : ''
            }`,
            '',
          );
          if (sent.caption) out.push(`> ${sent.caption.replace(/\n/g, ' ')}`, '');
          for (const f of sent.files) {
            const detail = [f.mediaType, f.sizeBytes === null ? null : `${String(Math.round(f.sizeBytes / 1024))} KB`]
              .filter((d): d is string => !!d)
              .join(' · ');
            out.push(`> - \`${f.path}\`${detail ? ` — ${detail}` : ''}`);
          }
          out.push('', '> *The files themselves are on disk, not in this export.*', '');
          break;
        }
        // And the fourth: what a review found is the review. `ReportFindings`
        // is the only place the findings exist — the tool tells the model not
        // to print them as text as well — so an export that dropped this
        // exported a code review as a line saying a tool was called.
        const found = parseFindings(block);
        if (found) {
          writeHeader();
          const title = `🔎 Code review — ${String(found.findings.length)} finding${
            found.findings.length === 1 ? '' : 's'
          }${found.rejected ? ' — rejected, never reported' : ''}${found.level ? ` — ${found.level} effort` : ''}`;
          const rows: string[] = [];
          if (found.findings.length === 0) {
            rows.push('> *Nothing survived verification — the review found nothing to report.*', '');
          }
          // Numbered because the order is the ranking: the tool sorts them
          // most-severe first and carries no severity to sort on afterwards.
          for (const [n, f] of found.findings.entries()) {
            const where = f.line === null ? f.file : `${f.file}:${String(f.line)}`;
            const tags = [f.category, f.verdict?.toLowerCase(), f.outcome?.replace(/_/g, ' ')]
              .filter((t): t is string => !!t)
              .join(' · ');
            rows.push(`> ${String(n + 1)}. \`${where}\`${tags ? ` — *${tags}*` : ''}`);
            if (f.shortSummary) rows.push(`>    **${f.shortSummary.replace(/\n/g, ' ')}**`);
            if (f.summary) rows.push(`>    ${f.summary.replace(/\n/g, ' ')}`);
            if (f.failureScenario) rows.push(`>    *Failure scenario:* ${f.failureScenario.replace(/\n/g, ' ')}`);
            rows.push('>');
          }
          // A rejected report goes behind a `<details>`, which is this format's
          // version of the fold the card gives it: the model retries with almost
          // the same list, and two open ones in a row read as twice as many
          // findings as the review actually made.
          if (found.rejected) {
            out.push('<details>', `<summary>${title}</summary>`, '', ...rows, '', '</details>', '');
          } else {
            out.push(`> **${title}**`, '', ...rows, '');
          }
          break;
        }
        if (!opts.includeTools) break;
        writeHeader();
        // Same two voices as the collapsed header in the app, same order: the
        // sentence that says why, then the command that says what.
        const intent = block.intent ? ` — ${block.intent.replace(/</g, '&lt;')}` : '';
        const ran = block.inputSummary ? ` — <code>${block.inputSummary.slice(0, 120).replace(/</g, '&lt;')}</code>` : '';
        const summary = `🔧 <b>${block.toolName}</b>${intent}${ran}`;
        out.push('<details>', `<summary>${summary}</summary>`, '');
        if (block.input !== null && block.input !== undefined) {
          out.push('**Input**', '', fence(JSON.stringify(block.input, null, 2), 'json'), '');
        }
        if (block.result) {
          out.push(
            `**Result${block.result.isError ? ' (error)' : ''}${block.result.truncated ? ' (truncated)' : ''}**`,
            '',
            fence(block.result.text),
            '',
          );
        }
        out.push('</details>', '');
        break;
      }
      case 'image':
        writeHeader();
        if (!block.data) {
          out.push('*🖼 image attachment (no image data in the transcript)*', '');
        } else if (opts.includeImages) {
          out.push(`![Attachment](data:${block.mediaType ?? 'image/png'};base64,${block.data})`, '');
        } else {
          out.push('*🖼 image attachment (not included in this export)*', '');
        }
        break;
    }
  }
  return out;
}

/** What the per-message "copy as Markdown" button puts on the clipboard. */
export function blocksMarkdown(item: MessageItem, blocks: readonly ContentBlock[], opts: ExportOptions): string {
  return contentLines(item, blocks, opts, false).join('\n').trim();
}

export function buildMarkdown(detail: SessionDetail, opts: ExportOptions): string {
  const s = detail.summary;
  const out: string[] = [];

  out.push(`# ${s.title}`, '');
  out.push(`- **Project:** \`${s.projectPath}\``);
  out.push(`- **Session:** \`${s.id}\``);
  out.push(`- **Created:** ${formatDateTime(s.createdAt)} · **Last activity:** ${formatDateTime(s.lastActivityAt)}`);
  if (s.gitBranch) out.push(`- **Branch:** \`${s.gitBranch}\``);
  if (s.model) out.push(`- **Model:** \`${s.model}\``);
  if (s.enrichment) {
    out.push(
      `- **Stats:** ${s.enrichment.userMessageCount} prompts · ${s.enrichment.assistantMessageCount} responses · ${s.enrichment.toolUseCount} tool calls`,
    );
  }
  out.push('', '---', '');

  // A rewound-away turn is exported, but it must say so: read in order it would
  // otherwise look like part of the conversation that stands, which is the exact
  // mistake the viewer's fold exists to prevent.
  // Tracked by branch, not by a flag: two rewinds to the same message leave two
  // branches back to back, and one heading over both would join them.
  let branch: string | null = null;
  for (const turn of detail.turns) {
    const first = turn.items[0]?.discardedBranch ?? null;
    const turnBranch =
      first !== null && turn.items.every((i) => i.discardedBranch === first) ? first : null;
    if (turnBranch !== branch) {
      if (branch !== null) out.push('', '> ⟲ **End of the rewound-away branch.**', '');
      if (turnBranch !== null) {
        out.push('', '> ⟲ **Discarded by a rewind** — below is a branch Claude Code no longer shows.', '');
      }
      branch = turnBranch;
    }
    for (const item of turn.items) {
      if (item.role === 'system') {
        if (opts.includeSystem || item.blocks[0]?.kind === 'interrupt') out.push(...systemLines(item));
        continue;
      }
      out.push(...contentLines(item, item.blocks, opts, true));
    }
  }

  return out.join('\n');
}

export function downloadMarkdown(detail: SessionDetail, opts: ExportOptions): void {
  const markdown = buildMarkdown(detail, opts);
  const safeName = detail.summary.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || detail.summary.id;
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
