import { createContext, type ReactNode, type RefObject, useContext, useRef, useState } from 'react';
import ReactMarkdown, { type Components, defaultUrlTransform, type UrlTransform } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { copyPlain } from '../../lib/clipboard.ts';
import { parseFileRef, rangeFromLabel } from '../../lib/fileRefs.ts';
import { useFileRefs } from './FileRefContext.ts';
import { FileLink } from './FileRefLink.tsx';
import 'highlight.js/styles/github-dark.css';

/**
 * react-markdown blanks any href whose protocol it does not recognise, and on
 * this machine that is most of the file paths Claude writes: `C:\Users\…` parses
 * as protocol `c:` and `app.ts:12` as protocol `app.ts:`, so both arrived as
 * href="" and a click reloaded the page. A file reference goes through
 * untouched; everything else still runs the default, which is what keeps
 * `javascript:` blanked.
 *
 * Only an `<a href>`. An `<img src="C:\…">` is not a link anybody follows and
 * has no business being resurrected into a request.
 */
const urlTransform: UrlTransform = (url, key, node) =>
  key === 'href' && node.tagName === 'a' && parseFileRef(url) ? url : defaultUrlTransform(url);

/**
 * Set by the `pre` override, read by the `code` one. A fenced block has already
 * been turned into a tree of spans by rehype-highlight and must be left alone;
 * this says so exactly, where guessing from a className would not.
 */
const InPre = createContext(false);

/**
 * Whether a fenced block wears a bar. Off by default, and turned on for the
 * assistant's own messages alone (`Turn`) — the same contract `StarContext`
 * states: no provider, no button. A plan, a subagent's report, a compaction
 * summary and the release notes all render through here too, and none of them
 * asked for one.
 */
const CodeBar = createContext(false);

/** How long the button says it worked, as everywhere else in the app. */
const FLASH_MS = 1500;

/**
 * The language a fence was written in, as remark left it on the `<code>`
 * (`language-ts`). rehype-highlight adds `hljs` and the `hljs-*` token classes
 * beside it and no language of its own — detection is off — so an unlabelled
 * fence has none, and the bar then carries only its button.
 */
function fenceLanguage(node: unknown): string | null {
  const children = (node as { children?: unknown[] } | undefined)?.children ?? [];
  for (const child of children) {
    const el = child as { tagName?: string; properties?: { className?: unknown } };
    if (el.tagName !== 'code') continue;
    const classes = Array.isArray(el.properties?.className) ? el.properties.className : [];
    for (const cls of classes) {
      if (typeof cls === 'string' && cls.startsWith('language-')) return cls.slice('language-'.length);
    }
  }
  return null;
}

/**
 * The bar over a fenced block in an answer: what it is written in, and the
 * button that copies it.
 *
 * Fixed rather than revealed on hover, which is the one thing a code block can
 * afford that a message header cannot: it never covers the first line, and it
 * is found without knowing to look for it.
 *
 * Three things about it are load-bearing:
 *
 * - **`data-chrome`**, because this sits inside `[data-bubble-body]` — a
 *   marking box. The find bar counts in the transcript and paints in the DOM,
 *   so a word of ours in there would be marked, counted and stepped onto
 *   (`lib/highlight.ts`), and the formatted copy would paste it into Word.
 * - **Outside the `<pre>`**, so the block's `textContent` is the code and
 *   nothing else, and so the bar does not slide away when a long line scrolls.
 *   The rounding is the wrapper's for the same reason — see `.code-block` in
 *   styles.css — so nothing here has to know what the plugin rounded to.
 * - **The strip is as tall as what is written in it.** It sits inside prose,
 *   whose line-height is a ratio, so the row stood 30px tall for a 10px label
 *   until the size and `leading-none` were put on the row itself.
 * - **Both labels are always drawn**, and a class chooses. `TurnList`'s
 *   `MutationObserver` watches `childList` and `characterData` but not
 *   attributes, so swapping the class costs nothing where swapping the text
 *   would repaint every mark in the conversation, twice, per click.
 */
function CodeBarRow({ lang, code }: { lang: string | null; code: RefObject<HTMLPreElement | null> }) {
  const [copied, setCopied] = useState(false);
  return (
    // `select-none`: a drag across a couple of blocks is how a reader takes the
    // code by hand, and it must not pick up "typescript ⧉ Copy" on the way.
    // The click is stopped because the scroller's own handler would move the
    // selected-message ring to whatever this is inside.
    <div
      data-chrome
      className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-black/60 px-2 py-1 text-[10px] leading-none select-none"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="truncate text-[var(--text-dim)]">{lang}</span>
      <button
        type="button"
        className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        title="Copy this code block"
        onClick={() => {
          // What is on screen, which is what the reader is looking at — and a
          // fence always ends in the newline that closed it, which nobody means
          // to paste.
          const text = (code.current?.textContent ?? '').replace(/\n$/, '');
          void copyPlain(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), FLASH_MS);
          });
        }}
      >
        <span className={copied ? 'hidden' : undefined}>⧉ Copy</span>
        <span className={copied ? undefined : 'hidden'}>Copied ✓</span>
      </button>
    </div>
  );
}

/** The text of a node, when it is one plain string and nothing else. */
function plainText(children: ReactNode): string | null {
  if (typeof children === 'string') return children;
  if (Array.isArray(children) && children.length === 1 && typeof children[0] === 'string') return children[0];
  return null;
}

const LINK_CLASS = 'text-sky-400 underline decoration-dotted underline-offset-2 hover:decoration-solid';

const components: Components = {
  a({ node: _node, href, children, ...rest }) {
    const ctx = useFileRefs();
    // The link TEXT is usually not the path (`[:905](frmActualizador.frm:905)`),
    // so the reference is read from the href and the label is left as written.
    // The one thing the label knows that the href does not is the END of a
    // range: `[:1068-1074](…frm:1068)` points at seven lines and links to one.
    const parsed = ctx && href ? parseFileRef(href) : null;
    const label = plainText(children);
    const fileRef = parsed && label ? rangeFromLabel(label, parsed) : parsed;
    // Outside a session view — the release notes in UpdateButton — there is no
    // context and this is byte for byte the anchor react-markdown drew before.
    if (!ctx || !fileRef) {
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      );
    }
    return (
      <FileLink
        ctx={ctx}
        fileRef={fileRef}
        className={LINK_CLASS}
        title={`Open ${fileRef.path}${fileRef.line ? `:${fileRef.line}` : ''}${fileRef.endLine ? `-${fileRef.endLine}` : ''}`}
      >
        {children}
      </FileLink>
    );
  },
  pre({ node, children, ...rest }) {
    // Both hooks run either way: the bar is a branch, not a condition on them.
    const bar = useContext(CodeBar);
    const code = useRef<HTMLPreElement>(null);
    if (!bar) {
      return (
        <InPre value={true}>
          <pre {...rest}>{children}</pre>
        </InPre>
      );
    }
    // `code-block` is a class rather than utilities because what has to be
    // beaten is the typography plugin's own `pre` rule — see styles.css.
    return (
      <InPre value={true}>
        <div className="code-block">
          <CodeBarRow lang={fenceLanguage(node)} code={code} />
          <pre ref={code} {...rest}>
            {children}
          </pre>
        </div>
      </InPre>
    );
  },
  code({ node: _node, className, children, ...rest }) {
    const inPre = useContext(InPre);
    const ctx = useFileRefs();
    const text = inPre ? null : plainText(children);
    /**
     * The whole span is one candidate, never scanned inside. That is what lets
     * `Actualizacion Base de Datos 2.0/sentenciasSQL.bas:6648` — a real shape
     * here — work despite its spaces, and makes a span holding a command fail
     * cleanly instead of being cut up.
     *
     * `strict`: a code span is where everything else in a technical answer
     * lives too. Two thirds of the backticked candidates here are names with no
     * directory (`package.json`, `settings.json`), half of them not in this
     * project at all, and without the rest of the rule `text/html` and
     * `GET /api/retention` became links as well.
     */
    const fileRef = ctx && text ? parseFileRef(text, { strict: true }) : null;
    const code = (
      <code className={className} {...rest}>
        {children}
      </code>
    );
    if (!ctx || !fileRef) return code;
    return (
      <FileLink
        ctx={ctx}
        fileRef={fileRef}
        className="decoration-dotted underline-offset-2 hover:decoration-solid hover:text-sky-400"
        title={`Open ${fileRef.path}${fileRef.line ? `:${fileRef.line}` : ''}`}
      >
        {code}
      </FileLink>
    );
  },
};

export function Markdown({ text, codeBar = false }: { text: string; codeBar?: boolean }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none prose-pre:bg-black/40 prose-pre:text-[13px] prose-code:before:content-none prose-code:after:content-none prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2">
      <CodeBar value={codeBar}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          urlTransform={urlTransform}
          components={components}
        >
          {text}
        </ReactMarkdown>
      </CodeBar>
    </div>
  );
}
