/**
 * Branch names are a path, and a flat list throws that away.
 *
 * `edgar/DES-32683`, `edgar/DES-32700`, `release/1.23`, `main` is four rows of
 * equal weight where a person sees "mine, mine, a release, and main". A clone
 * that has been worked in for a year has sixty of them and the list stops being
 * readable at all — which on a phone happens at about twelve.
 *
 * So the slash is treated as what git's own refs already treat it as: a folder.
 * Pure, and its own module, because it is the one piece of the refs panel worth
 * getting exactly right and the one piece that can be reasoned about without a
 * repository — `RefSidebar` is 700 lines of buttons around it.
 *
 * **A folder with a single folder inside it is merged with it**, so
 * `feature/api/retry` alone does not cost two rows of chevrons to reach one
 * branch; it is drawn as `feature/api`. The same thing VS Code calls compact
 * folders, and for the same reason.
 *
 * Order is preserved throughout — whatever order the caller handed the names in
 * is the order the leaves come back in, and a folder takes the position of its
 * first member. The server already sorts branches the way this panel wants
 * them, and re-sorting here would be a second opinion about it.
 */

export interface RefLeaf<T> {
  kind: 'leaf';
  /** The last segment: what the row says. */
  name: string;
  /** The whole name, which is what git is given. */
  path: string;
  item: T;
}

export interface RefFolder<T> {
  kind: 'folder';
  /** The segment (or merged segments) this row shows. */
  name: string;
  /** Everything up to and including it — the key its fold state is kept under. */
  path: string;
  children: RefNode<T>[];
  /** How many leaves are under it, however deep. */
  count: number;
}

export type RefNode<T> = RefLeaf<T> | RefFolder<T>;

interface Building<T> {
  name: string;
  path: string;
  /** A name can be BOTH a branch and a prefix: `feat` beside `feat/x`. */
  item: T | null;
  children: Map<string, Building<T>>;
}

function make<T>(name: string, path: string): Building<T> {
  return { name, path, item: null, children: new Map() };
}

export function groupRefs<T>(items: readonly T[], nameOf: (item: T) => string): RefNode<T>[] {
  const root = make<T>('', '');
  for (const item of items) {
    const full = nameOf(item);
    const segments = full.split('/').filter((s) => s !== '');
    if (segments.length === 0) continue;
    let node = root;
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix === '' ? segment : `${prefix}/${segment}`;
      let child = node.children.get(segment);
      if (!child) {
        child = make<T>(segment, prefix);
        node.children.set(segment, child);
      }
      node = child;
    }
    // Two refs cannot share a name, so the last one in wins and there is no
    // such thing as losing one here.
    node.item = item;
  }
  return emit(root);
}

function emit<T>(node: Building<T>): RefNode<T>[] {
  const out: RefNode<T>[] = [];
  for (const child of node.children.values()) {
    // A ref sitting where a folder also is (`feat` and `feat/x`): the ref is a
    // row of its own, above the folder of the same name.
    if (child.item !== null) {
      out.push({ kind: 'leaf', name: child.name, path: child.path, item: child.item });
    }
    if (child.children.size === 0) continue;
    out.push(fold(child));
  }
  return out;
}

/**
 * A folder, with any single-child chain under it merged into its name — and, if
 * what is left is one branch, no folder at all.
 *
 * A chevron you have to open to find a single row is a row that costs two taps
 * and says nothing: `release/1.23`, alone, is one branch and is drawn as one.
 * It becomes a folder the moment a second `release/…` turns up, which is the
 * moment the grouping starts earning its line.
 */
function fold<T>(node: Building<T>): RefNode<T> {
  let name = node.name;
  let current = node;
  while (current.item === null && current.children.size === 1) {
    const only = [...current.children.values()][0];
    // The one child is a leaf, or is a ref that also has refs under it
    // (`a/b` beside `a/b/c`). Either way it owes the reader a row of its own,
    // so the chain ends here.
    if (only.children.size === 0 || only.item !== null) break;
    name = `${name}/${only.name}`;
    current = only;
  }
  const children = emit(current);
  const only = children[0];
  if (children.length === 1 && only.kind === 'leaf') {
    return { kind: 'leaf', name: `${name}/${only.name}`, path: only.path, item: only.item };
  }
  return {
    kind: 'folder',
    name,
    // The DEEPEST path, so a merged folder's fold state cannot collide with the
    // state of the folder it swallowed.
    path: current.path,
    children,
    count: countLeaves(children),
  };
}

function countLeaves<T>(nodes: RefNode<T>[]): number {
  let total = 0;
  for (const node of nodes) total += node.kind === 'leaf' ? 1 : node.count;
  return total;
}
