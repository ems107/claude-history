/**
 * A control is working — drawn without the control moving a pixel.
 *
 * Every button in this tab used to answer a click by becoming a different
 * button: `Fetch` swapped its label for `…`, `Push` became `Pushing…`, and the
 * three beside them shuffled along to make room. That is a toolbar that jumps
 * under the hand that just used it, and it is also the least informative answer
 * available — it says something is happening and nothing about what, how long,
 * or how to stop it. Those three belong in `GitActivity`, which has the room
 * for them; the button's whole job is to stay exactly where it was.
 *
 * So: absolutely positioned inside the control, 2 px along the bottom edge, no
 * participation in layout. The caller only has to be `relative` — which every
 * `actionClass` control already is not, so the one place this is used adds it
 * deliberately.
 */
export function BusyBar() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-b-[3px]"
    >
      <span className="busy-bar block h-full w-1/3 bg-[var(--accent)]" />
    </span>
  );
}
