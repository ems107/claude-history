import { createContext, type Dispatch, type SetStateAction, useContext, useEffect, useState } from 'react';

/**
 * Which box a jump is heading for, so the fold in its way can open itself.
 *
 * `ToolBlock` has had this since deep links existed, threaded down as a prop
 * (`targetTool`) through `TurnView` and `ToolGroup`. The others that can hold a
 * hit — a thinking block, an agent's report — keep their open state entirely to
 * themselves, so a match inside one could be counted and never shown. Rather
 * than thread a second, third and fourth prop through the same two components,
 * the destination is published once and read where it is needed.
 *
 * The key is the anchor a jump already speaks in: `msg:<uuid>` for anything
 * inside a message's bubble, `tool:<toolUseId>` for a call.
 */
export interface RevealContextValue {
  key: string | null;
  /**
   * Bumped on every jump ASKED for, even to the destination already set — the
   * same reason `jumpNonce` exists. Without it, stepping onto a box, folding it
   * back by hand and stepping onto it again would do nothing.
   */
  nonce: number;
}

/**
 * Provided by `TurnList`, and only by the conversation's: the subagent drawer
 * renders the same list over a transcript whose uuids this session does not
 * hold, so a key from here would name nothing there. No provider, no revealing —
 * the same contract `StarContext` and `SubagentContext` state.
 */
export const RevealContext = createContext<RevealContextValue | null>(null);

/** Whether a jump is pointing at this box right now. */
export function useRevealed(revealKey: string | null): boolean {
  const reveal = useContext(RevealContext);
  return !!revealKey && reveal?.key === revealKey;
}

/**
 * The destination itself, for the one caller that cannot name its own key: a run
 * of tool calls has no identity of its own, and has to open when the jump is for
 * ANY of the calls inside it — the block cannot open a run it is not mounted in.
 */
export function useRevealTarget(): RevealContextValue {
  return useContext(RevealContext) ?? { key: null, nonce: 0 };
}

/**
 * Open state for a fold that can be a jump's destination: it opens when pointed
 * at, and then LETS GO.
 *
 * Deliberately not `open={targeted || open}`, which is the obvious version and
 * the wrong one — it would make the fold impossible to close again while the
 * link that opened it is still in the URL, or while the find bar is still
 * standing on it.
 *
 * `forced` is the older prop-threaded path (`ToolBlock`'s `targeted`), kept so
 * both routes share one implementation of that contract.
 */
export function useFoldable(
  revealKey: string | null,
  forced = false,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const reveal = useContext(RevealContext);
  const targeted = (!!revealKey && reveal?.key === revealKey) || forced;
  const nonce = reveal?.nonce ?? 0;
  const [open, setOpen] = useState(targeted);
  useEffect(() => {
    if (targeted) setOpen(true);
    // `nonce` is in here, not `open`: asking for the same box twice has to open
    // it twice, and re-running on `open` would fight the reader closing it.
  }, [targeted, nonce]);
  return [open, setOpen];
}
