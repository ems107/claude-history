import { createContext, useContext } from 'react';
import type { FileRef } from '../../lib/fileRefs.ts';

/**
 * What a file link needs to know, provided once per session view.
 *
 * It is a context rather than a prop because the links are inside markdown:
 * `onOpenAgent` already travels six components deep by hand, and a link buried
 * in Claude's prose is further down still. The other half of the reason is what
 * being absent means — outside a session view (the release notes in
 * UpdateButton) there is no session to resolve against, and every link there
 * stays exactly the plain `<a>` react-markdown drew before any of this.
 */
export interface FileRefContextValue {
  sessionId: string;
  /**
   * The session's LAUNCH cwd: what a relative reference is resolved against,
   * and what the panel names when one is not found. Empty while the detail
   * query is still in flight.
   */
  projectPath: string;
  /** A real URL, so copy-link, middle-click and ctrl+click do the obvious thing. */
  hrefFor(ref: FileRef): string;
  /** A plain left click: no navigation, just the panel. */
  openFile(ref: FileRef): void;
}

export const FileRefContext = createContext<FileRefContextValue | null>(null);

export function useFileRefs(): FileRefContextValue | null {
  return useContext(FileRefContext);
}
