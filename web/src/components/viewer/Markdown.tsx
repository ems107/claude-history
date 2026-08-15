import { createContext, type ReactNode, useContext } from 'react';
import ReactMarkdown, { type Components, defaultUrlTransform, type UrlTransform } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { parseFileRef } from '../../lib/fileRefs.ts';
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

/** The text of a `<code>` span, when it is one plain string and nothing else. */
function codeText(children: ReactNode): string | null {
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
    const fileRef = ctx && href ? parseFileRef(href) : null;
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
        title={`Open ${fileRef.path}${fileRef.line ? `:${fileRef.line}` : ''}`}
      >
        {children}
      </FileLink>
    );
  },
  pre({ node: _node, children, ...rest }) {
    return (
      <InPre value={true}>
        <pre {...rest}>{children}</pre>
      </InPre>
    );
  },
  code({ node: _node, className, children, ...rest }) {
    const inPre = useContext(InPre);
    const ctx = useFileRefs();
    const text = inPre ? null : codeText(children);
    /**
     * The whole span is one candidate, never scanned inside. That is what lets
     * `Actualizacion Base de Datos 2.0/sentenciasSQL.bas:6648` — a real shape
     * here — work despite its spaces, and makes a span holding a command fail
     * cleanly instead of being cut up.
     *
     * `allowBareName: false`: two thirds of the backticked candidates in this
     * corpus are names with no directory (`package.json`, `settings.json`), half
     * of them not in the project at all, and a link the reader cannot judge
     * without clicking is worse than plain text.
     */
    const fileRef = ctx && text ? parseFileRef(text, { allowBareName: false }) : null;
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

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none prose-pre:bg-black/40 prose-pre:text-[13px] prose-code:before:content-none prose-code:after:content-none prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        urlTransform={urlTransform}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
