import type { MessageItem, SessionDetail } from '@claude-history/shared';
import { formatDateTime, shortModel } from './format.ts';

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

  for (const turn of detail.turns) {
    for (const item of turn.items) {
      if (item.role === 'system') {
        if (!opts.includeSystem) continue;
        const first = item.blocks[0];
        // A /context run and a compaction carry figures, not text — one line each
        // rather than the empty quote they used to export as.
        if (first?.kind === 'context') {
          const s = first.snapshot;
          const window = s.limitTokens === null ? '' : ` of ${s.limitTokens.toLocaleString()}`;
          const pct = s.reportedPct === null ? '' : ` (${s.reportedPct}%)`;
          out.push(
            `> ⚙️ **/context:** ${s.reportedTokens?.toLocaleString() ?? '—'}${window} tokens${pct} — ` +
              s.categories.map((c) => `${c.label} ${c.tokens.toLocaleString()}`).join(' · '),
            '',
          );
          continue;
        }
        if (first?.kind === 'compact') {
          const b = first.boundary;
          out.push(
            `> ⚙️ **Conversation compacted**${b.trigger ? ` (${b.trigger})` : ''}: ` +
              `${b.preTokens?.toLocaleString() ?? '—'} → ${b.postTokens?.toLocaleString() ?? '—'} tokens`,
            '',
          );
          continue;
        }
        const text = first?.kind === 'text' ? first.text : '';
        out.push(`> ⚙️ **${item.systemSubtype ?? 'system'}:** ${text.replace(/\n/g, ' ').slice(0, 500)}`, '');
        continue;
      }

      let headerWritten = false;
      const writeHeader = () => {
        if (!headerWritten) {
          out.push(itemHeader(item), '');
          headerWritten = true;
        }
      };

      for (const block of item.blocks) {
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
            if (!opts.includeTools) break;
            writeHeader();
            const summary = `🔧 <b>${block.toolName}</b>${block.inputSummary ? ` — <code>${block.inputSummary.slice(0, 120).replace(/</g, '&lt;')}</code>` : ''}`;
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
