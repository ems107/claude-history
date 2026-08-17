/**
 * Reading the file paths Claude writes into an answer.
 *
 * The forms are not hypothetical — these are the ones this corpus actually
 * holds: markdown links whose href is `rel/path.ext:LINE` (70) or
 * `rel/path.ext#L12-L20` (28), backticked paths with a separator or a line
 * number (1,716), and Windows absolute paths (92). The hrefs arrive
 * percent-encoded and the link TEXT is usually not the path
 * (`[:905](frmActualizador.frm:905)`), so everything here reads the reference,
 * never the label.
 *
 * Pure and string-only on purpose: the index arithmetic and the parsing rules
 * are checkable without a browser, the way `matchSpans` is.
 */

/** Which file a link points at, and where in it. */
export interface FileRef {
  /** The reference as written, percent-decoded. Sent to the server verbatim. */
  path: string;
  /** 1-based, from `:12`, `:12:5`, `#L12` or `#L12-L20`. */
  line?: number;
  /** Only from a range (`#L12-L20`). */
  endLine?: number;
  /** From `:12:5`. Shown, never scrolled to. */
  column?: number;
  /** A relative one is resolved against the session's LAUNCH cwd, which can be wrong. */
  kind: 'absolute' | 'relative';
}

export interface FileRefOptions {
  /**
   * Demand evidence that this is a file at all.
   *
   * A markdown link is not strict: the author wrote `[x](y)` and asserted that
   * `y` is a file, so a bare `package.json` counts. A backticked span is
   * strict, because a code span is where everything else in a technical answer
   * also lives — and the three that got through before this existed say what
   * it is for: `text/html` (a MIME type), `GET /api/retention` (a route) and
   * every bare `settings.json` that belongs to some other project.
   *
   * Strict therefore asks for a directory or a drive AND for either a real
   * extension or a line number. That keeps `web/src/lib/folding.ts` and
   * `parser.ts:42` and drops the rest.
   */
  strict?: boolean;
}

/** Which file the viewer panel is showing. Beside `agent`, `msg` and `tool`. */
export const FILE_PARAM = 'file';

/** `http:`, `mailto:`, `data:`, `javascript:` — anything with a real protocol. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const DRIVE_RE = /^[A-Za-z]:[\\/]/;
const UNC_RE = /^\\\\[^\\/]/;
const HASH_SUFFIX = /#L(\d{1,7})(?:-L?(\d{1,7}))?$/i;
const COLON_SUFFIX = /:(\d{1,7})(?::(\d{1,7}))?$/;
/**
 * A stem plus a LETTER-first extension. The letter is what keeps `v1.3.2` and
 * `2.1.222` — version numbers, which this corpus is full of — from reading as
 * files with an extension of `2` and `222`.
 */
const EXT_RE = /\.([A-Za-z][A-Za-z0-9_+-]{0,9})$/;

/**
 * Extensions a bare name is allowed to carry. Deliberately a list rather than
 * "anything after a dot": without it `api.anthropic.com` and `claude.ai` become
 * files, and they are written far more often than any bare filename is clicked.
 */
const KNOWN_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonl', 'md', 'mdx', 'css', 'scss', 'less',
  'html', 'htm', 'py', 'rb', 'rs', 'go', 'java', 'kt', 'cs', 'c', 'h', 'cpp', 'hpp', 'swift',
  'sh', 'bash', 'zsh', 'ps1', 'psm1', 'psd1', 'vbs', 'bat', 'cmd', 'sql', 'yml', 'yaml', 'toml',
  'ini', 'cfg', 'conf', 'env', 'txt', 'log', 'xml', 'csv', 'tsv', 'lock', 'vue', 'svelte', 'php',
  'bas', 'frm', 'cls', 'vbp', 'vbw', 'ctl', 'dsr', 'resx', 'csproj', 'sln', 'props', 'targets',
  'gradle', 'dockerfile', 'gitignore', 'editorconfig', 'npmrc', 'nvmrc', 'prettierrc',
  // Images. They earn a place here only because the panel can now draw one: a
  // link to a picture that answered "binary — cannot be shown" was a worse
  // reply than plain text, which is why they were kept out until it could.
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg',
]);

/**
 * The extensions the panel draws as a picture rather than as text.
 *
 * `svg` is NOT one of them, and that is the same line the server draws in its
 * own allowlist: an SVG is a document that can carry script, and it is far more
 * useful read as the XML it is. `LANGUAGES` below already highlights one.
 */
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);

/** Whether this path names an image the app can show. The one home for that question. */
export function isImagePath(path: string): boolean {
  const ext = EXT_RE.exec(refBasename(path))?.[1].toLowerCase();
  return !!ext && IMAGE_EXT.has(ext);
}

/**
 * A reference, or null when the string is not one.
 *
 * Order matters twice. The drive letter is tested BEFORE the scheme, or
 * `C:\Users\...` is thrown away as "protocol `c:`" — which is exactly the
 * react-markdown behaviour that made these links unusable. And the line suffix
 * is cut from the RAW string before decoding, because `:6648` and `#L59-L60`
 * are always plain ASCII while the path around them is percent-encoded: decode
 * first and a `%23` inside a real filename becomes an anchor nobody wrote.
 */
export function parseFileRef(raw: string, opts: FileRefOptions = {}): FileRef | null {
  const strict = opts.strict ?? false;
  const input = raw.trim();
  if (!input || /[\n\r\0]/.test(input)) return null;
  // A fragment or a query on its own points inside this page, not at a file.
  if (input.startsWith('#') || input.startsWith('?')) return null;

  // The separators arrive percent-encoded from the markdown→hast step
  // (`C:%5CUsers%5C…`), and an encoded drive letter is no longer a drive
  // letter: `C:%5C` reads as protocol `c:` and the path is thrown away. Only
  // this test needs to see through it — the path itself is decoded below.
  const probe = input.replace(/%5C/gi, '\\').replace(/%2F/gi, '/');
  const windowsAbs = DRIVE_RE.test(probe) || UNC_RE.test(probe);

  let rest = input;
  let line: number | undefined;
  let endLine: number | undefined;
  let column: number | undefined;
  const hash = HASH_SUFFIX.exec(rest);
  if (hash) {
    rest = rest.slice(0, hash.index);
    line = Number(hash[1]);
    if (hash[2]) endLine = Number(hash[2]);
  } else {
    const colon = COLON_SUFFIX.exec(rest);
    // `index > 0` leaves `C:\src` its drive: an empty stem is not a path.
    if (colon && colon.index > 0) {
      rest = rest.slice(0, colon.index);
      line = Number(colon[1]);
      if (colon[2]) column = Number(colon[2]);
    }
  }
  if (!rest) return null;
  // The scheme test comes AFTER the suffix, or `app.ts:12` dies as "protocol
  // `app.ts:`" — which is precisely the react-markdown behaviour this exists to
  // undo. By here a port (`https://x.com:8080`) has been cut off too, so what is
  // left still shows its protocol.
  if (!windowsAbs && SCHEME_RE.test(rest)) return null;

  let path = rest;
  try {
    path = decodeURIComponent(rest);
  } catch {
    // A lone `%` is not an escape sequence — keep what was written.
  }

  const absolute = DRIVE_RE.test(path) || UNC_RE.test(path);
  const posixRoot = path.startsWith('/');
  const hasSeparator = /[\\/]/.test(path);
  const last = path.split(/[\\/]/).pop() ?? '';
  // A trailing separator names a folder, and the panel is for files.
  if (!last) return null;

  // A root-relative href on this machine is far more often one of this app's
  // own routes (`/logs`, `/settings`) than a POSIX path, so it has to look like
  // a file to count. No absolute href exists in the corpus, so this costs
  // nothing and protects every link in the nav.
  if (posixRoot && !EXT_RE.test(last)) return null;

  if (!absolute && !posixRoot && !hasSeparator) {
    // A bare name is the weakest signal there is: no directory, and often no
    // line either. It counts only outside strict mode, and only with an
    // extension that names a kind of file.
    if (strict) return null;
    const ext = EXT_RE.exec(last)?.[1].toLowerCase();
    if (!ext || !KNOWN_EXT.has(ext)) return null;
  }

  // Strict mode wants a real filename at the end of the path, or a line number
  // standing in for one. A separator alone proves nothing: `text/html` is a
  // MIME type, `GET /api/retention` a route, and both were becoming links.
  if (strict && line === undefined && !EXT_RE.test(last)) return null;

  return { path, line, endLine, column, kind: absolute || posixRoot ? 'absolute' : 'relative' };
}

export function isFileRef(text: string, opts?: FileRefOptions): boolean {
  return parseFileRef(text, opts) !== null;
}

/** `:1068-1074`, `1068-1074`, `frmActualizador.frm:1068-1074`, `L59-L60`. */
const LABEL_RANGE_RE = /(?:^|[:\s]|\bL)(\d{1,7})\s*[-–—]\s*L?(\d{1,7})$/;

/**
 * The end of a range that the link TEXT carries and its destination does not.
 *
 * Claude writes `[:1068-1074](ActualizadorVersion/frmActualizador.frm:1068)` —
 * the sentence points at seven lines and the href holds only the first, so the
 * panel marked one line of a stretch and looked like it had lost the rest.
 *
 * Believed only when the label's own start is the destination's line: that is
 * what makes it the same reference restated, rather than some other number
 * that happens to sit at the end of the words.
 */
export function rangeFromLabel(label: string, ref: FileRef): FileRef {
  if (ref.line === undefined || ref.endLine !== undefined) return ref;
  const m = LABEL_RANGE_RE.exec(label.trim());
  if (!m) return ref;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start !== ref.line || end <= start) return ref;
  return { ...ref, endLine: end };
}

/**
 * The reference as one string, for the URL. It round-trips through
 * `parseFileRef`, which is what lets `?file=` be parsed by the same code that
 * produced it — one parser in both directions.
 */
export function formatFileRef(ref: FileRef): string {
  if (ref.endLine !== undefined) return `${ref.path}#L${ref.line}-L${ref.endLine}`;
  if (ref.line === undefined) return ref.path;
  return ref.column === undefined ? `${ref.path}:${ref.line}` : `${ref.path}:${ref.line}:${ref.column}`;
}

/** Last segment, `/` and `\` alike — these paths mix both. */
export function refBasename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * The highlight.js language for a file, or null to leave it plain.
 *
 * Never `highlightAuto`: it is slow and it guesses, and a file coloured as the
 * wrong language reads worse than one not coloured at all. `bas`/`frm`/`cls`
 * are the VB6 sources that dominate the real link corpus here; `vbnet` is the
 * closest thing the common bundle ships.
 */
const LANGUAGES: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonl: 'json', md: 'markdown', mdx: 'markdown',
  css: 'css', scss: 'scss', less: 'less', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  resx: 'xml', csproj: 'xml', props: 'xml', targets: 'xml', vbp: 'ini',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
  cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', swift: 'swift', php: 'php',
  sh: 'bash', bash: 'bash', zsh: 'bash', bat: 'dos', cmd: 'dos',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini',
  bas: 'vbnet', frm: 'vbnet', cls: 'vbnet', ctl: 'vbnet', vbs: 'vbscript',
  diff: 'diff', patch: 'diff',
};

export function languageForPath(path: string): string | null {
  const ext = EXT_RE.exec(refBasename(path))?.[1].toLowerCase();
  return ext ? (LANGUAGES[ext] ?? null) : null;
}
