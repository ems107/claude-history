// What the app puts on the clipboard as HTML.
//
// Left to itself, Chrome serialises a selection with its COMPUTED style written
// onto every element: the theme's text colour, the bubble's background, the
// font, the size. Pasted into a mail on a white page, that is dark bars behind
// every paragraph — and the prose's own colour is `oklch()`, which Gmail does
// not understand and drops, so what is left is dark grey text on those dark
// bars, while the headings and the code (plain hex) stay white. Unreadable,
// and wrong anywhere else too: the page the paste lands on has a theme of its
// own, and ours has no business in it.
//
// So the HTML is written here, from the DOM, by one rule: **the STRUCTURE
// travels and the look stays behind**. Headings, emphasis, lists, tables, code
// and links go as the elements they are, and the destination draws them in its
// own colours and fonts. The only inline styles written are the ones that carry
// meaning and no colour — monospace for code, the borders and alignment of a
// table — and no colour of any kind is ever written, not even a border's: one
// with none follows the text colour of wherever it lands.

/** Elements that never paste: scripts and styles, and the controls and pictures of the UI. */
const DROP = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'svg',
  'canvas',
  'video',
  'audio',
  'iframe',
  'object',
  'embed',
  'button',
  'textarea',
  'select',
]);

/** Elements that paste as themselves. Anything else is unwrapped, or becomes a `div` if it is a block. */
const KEEP = new Set([
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'ins',
  'sub',
  'sup',
  'code',
  'kbd',
  'samp',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'a',
  'img',
  'div',
]);

/** Elements written with no closing tag. */
const VOID = new Set(['br', 'hr', 'img']);

/** Inline formatting a selection can sit wholly inside — a few words of a code span still paste as code. */
const INLINE_CONTEXT = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'sub', 'sup', 'code', 'kbd', 'samp', 'a']);

/** The parts of a table that are meaningless without one around them. */
const TABLE_PARTS = new Set(['thead', 'tbody', 'tfoot', 'tr']);

/** Containers a selection may span several children of, and that must wrap them to mean anything. */
const SELF_CONTEXT = new Set(['ul', 'ol', 'dl', 'table', 'blockquote']);

/**
 * Consolas first because it is what Office and Windows have; a stack that
 * opened with `ui-monospace` would be taken by Word as a font name it does not
 * know.
 */
const MONO = "font-family:Consolas,'Courier New',monospace";

/** The only inline styles ever written, by tag. None of them is a colour. */
const NEUTRAL_STYLE: Record<string, string> = {
  pre: `${MONO};white-space:pre-wrap`,
  code: MONO,
  kbd: MONO,
  samp: MONO,
  table: 'border-collapse:collapse',
  th: 'border:1px solid;padding:4px 8px',
  td: 'border:1px solid;padding:4px 8px',
};

/** What the walk knows about where it is, handed down from parent to child. */
interface Context {
  /** Inside a `<pre>` the text is verbatim already; elsewhere it may need help. */
  inPre: boolean;
  /**
   * Whether text here can be selected at all. Worked out by the walk rather
   * than read off each node, because `user-select: auto` defers to the parent
   * and only Blink reports the inherited answer in the computed style.
   */
  selectable: boolean;
}

interface Walk {
  /** Only what intersects it is written, and its two boundary text nodes are cut. */
  range: Range | null;
  /**
   * Leave out what the reader could not have selected. The bar over a code
   * block is `select-none` precisely so a drag across it does not pick up
   * "typescript ⧉ Copy", and the plain-text flavour already leaves it out.
   */
  selectableOnly: boolean;
  /** Besides what is never rendered, what the caller wants left out, subtree and all. */
  skip: (el: Element) => boolean;
  out: string[];
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

/** `white-space` values that keep the writer's line breaks — a prompt, a plan note. */
function preserves(whiteSpace: string): boolean {
  return whiteSpace.startsWith('pre') || whiteSpace === 'break-spaces';
}

/**
 * A text node's HTML. Where the page keeps line breaks through CSS (a prompt is
 * a `whitespace-pre-wrap` span, not a `<pre>`), they are written as `<br>` and
 * runs of spaces as `&nbsp;` — which every destination honours, where a
 * `white-space` style is dropped by half of them and the prompt would arrive as
 * one paragraph.
 */
function textHtml(text: string, preserve: boolean): string {
  const escaped = escapeText(text);
  if (!preserve) return escaped;
  return escaped
    .replace(/\r\n?/g, '\n')
    .replace(/ {2,}/g, (run) => ` ${'&nbsp;'.repeat(run.length - 1)}`)
    .replace(/(^|\n) /g, '$1&nbsp;')
    .replace(/\n/g, '<br>');
}

/**
 * A link into this app goes nowhere from somebody else's mail: a file reference
 * opens a panel here, a subagent link a page here. Those keep their text and
 * lose the link; anything else keeps its address, made absolute.
 */
function portableHref(a: HTMLAnchorElement): string | null {
  if (a.hasAttribute('data-file-ref')) return null;
  try {
    const url = new URL(a.href);
    if (url.origin === window.location.origin) return null;
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * An image travels when it can be fetched from wherever it lands: inline data,
 * or a public address. One served by this app (`/api/files/image`) is a broken
 * picture anywhere but here, and is left out.
 */
function portableSrc(img: HTMLImageElement): string | null {
  const src = img.currentSrc || img.src;
  if (src.startsWith('data:image/')) return src;
  try {
    const url = new URL(src);
    if (url.origin === window.location.origin) return null;
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function isInline(style: CSSStyleDeclaration): boolean {
  return style.display.startsWith('inline') || style.display === 'contents';
}

/**
 * The opening and closing tags an element pastes as, or null when it is
 * unwrapped (its content kept, the element itself dropped).
 */
function tagsFor(el: Element, style: CSSStyleDeclaration): { name: string; open: string; close: string } | null {
  const tag = el.localName;
  let name: string;
  if (KEEP.has(tag)) name = tag;
  else if (isInline(style)) return null;
  else name = 'div';

  const attrs: string[] = [];
  if (name === 'a') {
    const href = portableHref(el as HTMLAnchorElement);
    if (!href) return null;
    attrs.push(`href="${escapeAttr(href)}"`);
  } else if (name === 'img') {
    const img = el as HTMLImageElement;
    const src = portableSrc(img);
    if (!src) return null;
    attrs.push(`src="${escapeAttr(src)}"`);
    if (img.alt) attrs.push(`alt="${escapeAttr(img.alt)}"`);
    // The size it is drawn at, not its natural one: a screenshot attachment
    // would otherwise paste 2,000 pixels wide into a mail.
    const width = Math.round(img.getBoundingClientRect().width);
    if (width > 0) attrs.push(`width="${width}"`);
  } else if (name === 'ol') {
    const start = (el as HTMLOListElement).start;
    if (start !== 1) attrs.push(`start="${start}"`);
  } else if (name === 'th' || name === 'td') {
    const cell = el as HTMLTableCellElement;
    if (cell.colSpan > 1) attrs.push(`colspan="${cell.colSpan}"`);
    if (cell.rowSpan > 1) attrs.push(`rowspan="${cell.rowSpan}"`);
  }

  let css = NEUTRAL_STYLE[name] ?? '';
  if (name === 'th' || name === 'td') {
    // A column's alignment is the table's meaning (numbers to the right). A
    // header's is always spelled out, because a destination's own `th` default
    // is centred and ours is not.
    const align = style.textAlign === 'start' ? 'left' : style.textAlign === 'end' ? 'right' : style.textAlign;
    if (name === 'th' || align !== 'left') css += `;text-align:${align}`;
  }
  if (css) attrs.push(`style="${escapeAttr(css)}"`);

  const open = `<${name}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
  return { name, open, close: VOID.has(name) ? '' : `</${name}>` };
}

function userSelect(style: CSSStyleDeclaration): string {
  return style.getPropertyValue('user-select') || style.getPropertyValue('-webkit-user-select') || 'auto';
}

/** `selectable` one level down: `none` turns it off, `auto` keeps the parent's, anything else turns it on. */
function selectableIn(style: CSSStyleDeclaration, parent: boolean): boolean {
  const value = userSelect(style);
  return value === 'none' ? false : value === 'auto' ? parent : true;
}

/** Whether text directly inside `el` can be selected, asked from the top down. */
function selectableAt(el: Element): boolean {
  const chain: Element[] = [];
  for (let at: Element | null = el; at; at = at.parentElement) chain.unshift(at);
  return chain.reduce((selectable, at) => selectableIn(getComputedStyle(at), selectable), true);
}

function walkChildren(parent: Node, w: Walk, ctx: Context, preserve: boolean): void {
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (w.range && !w.range.intersectsNode(child)) continue;
    walkNode(child, w, ctx, preserve);
  }
}

function walkNode(node: Node, w: Walk, ctx: Context, preserve: boolean): void {
  if (node.nodeType === Node.TEXT_NODE) {
    if (w.selectableOnly && !ctx.selectable) return;
    let text = (node as Text).data;
    if (w.range) {
      const end = node === w.range.endContainer ? w.range.endOffset : text.length;
      const start = node === w.range.startContainer ? w.range.startOffset : 0;
      text = text.slice(start, end);
    }
    if (text) w.out.push(textHtml(text, preserve));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.localName;
  if (DROP.has(tag)) return;

  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return;
  if (w.skip(el)) return;
  const inner: Context = { inPre: ctx.inPre || tag === 'pre', selectable: selectableIn(style, ctx.selectable) };
  // Elements with no text of their own answer the question a text node would.
  const unselectable = w.selectableOnly && !inner.selectable;

  // A GFM task list draws real checkboxes, and their state is the item's meaning.
  if (tag === 'input') {
    const input = el as HTMLInputElement;
    if (input.type === 'checkbox' && !unselectable) w.out.push(input.checked ? '☑ ' : '☐ ');
    return;
  }
  if (unselectable && VOID.has(tag)) return;

  const tags = tagsFor(el, style);
  if (VOID.has(tag)) {
    if (tags) w.out.push(tags.open);
    return;
  }
  const start = w.out.length;
  if (tags) w.out.push(tags.open);
  const before = w.out.length;
  walkChildren(el, w, inner, !inner.inPre && preserves(style.whiteSpace));
  if (!tags) return;
  // An element that wrote nothing is dropped — layout with nothing in it (a
  // spacer, a row whose buttons were hidden), a box of unselectable text, and
  // the paragraph a triple-click ends at the very start of. Left in, each is an
  // empty paragraph in Word. The exception is a cell that was empty to begin
  // with: the table is still its shape.
  const emptyCell = (tags.name === 'td' || tags.name === 'th') && !el.textContent;
  if (w.out.length === before && !emptyCell) w.out.length = start;
  else w.out.push(tags.close);
}

/** Everything inside `node`, minus what `skip` names: the formatted copy of a whole message. */
export function nodeHtml(node: Element, skip: (el: Element) => boolean): string {
  const w: Walk = { range: null, selectableOnly: false, skip, out: [] };
  const inPre = node.closest('pre') !== null;
  walkChildren(node, w, { inPre, selectable: true }, !inPre && preserves(getComputedStyle(node).whiteSpace));
  return w.out.join('');
}

/**
 * What a selection range pastes as.
 *
 * The walk starts at the range's common ancestor, so the elements AROUND the
 * selection have to be put back by hand, or a few words inside a code span
 * paste as plain words and three rows of a table as loose cells:
 *
 * - rows (or a body) of a table climb to the table itself;
 * - a list, a table or a quote the range spans several children of is the
 *   ancestor itself, and wraps them;
 * - the inline formatting the whole range sits inside — code, emphasis, a
 *   link, and the `<pre>` above a code block's `<code>` — wraps it, up to the
 *   first other block.
 */
export function rangeHtml(range: Range): string {
  const common = range.commonAncestorContainer;
  const root = common.nodeType === Node.ELEMENT_NODE ? (common as Element) : common.parentElement;
  if (!root) return '';

  const inPre = root.closest('pre') !== null;
  const w: Walk = { range, selectableOnly: true, skip: () => false, out: [] };
  walkChildren(root, w, { inPre, selectable: selectableAt(root) }, !inPre && preserves(getComputedStyle(root).whiteSpace));
  let html = w.out.join('');
  if (!html) return '';

  const wrap = (el: Element) => {
    const tags = tagsFor(el, getComputedStyle(el));
    if (tags) html = tags.open + html + tags.close;
  };

  let el: Element | null = root;
  if (TABLE_PARTS.has(root.localName)) {
    while (el && el.localName !== 'table') {
      wrap(el);
      el = el.parentElement;
    }
    if (el) {
      wrap(el);
      el = el.parentElement;
    }
  } else if (SELF_CONTEXT.has(root.localName)) {
    wrap(root);
    el = root.parentElement;
  }
  while (el && el !== document.body) {
    const tag = el.localName;
    if (INLINE_CONTEXT.has(tag) || tag === 'pre') wrap(el);
    else if (!isInline(getComputedStyle(el))) break;
    el = el.parentElement;
  }
  return html;
}
