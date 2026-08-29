export function ProjectTag({
  name,
  path,
  color,
  onClick,
  shrink = false,
}: {
  name: string;
  path: string;
  color: string;
  onClick?: () => void;
  /**
   * Let it give way when the row runs out of room, instead of holding its full
   * width and pushing everything after it out.
   *
   * Off by default, because in a LIST it must not: a row there is a project name
   * and a title, and the title is the one that gives way — it has its own
   * tooltip and, unlike the tag, it repeats down the page in a hundred
   * variations. Measured with it on by default: at 900 px three tags in
   * twenty-five were being cut where nothing had been cut before.
   *
   * The session header is the one place that asks for it, and asks for a
   * reason: a column beside it can squeeze it to 320 px, where an unshrinkable
   * tag pushed `Find`, `View ▾` and `⋯` off the end of their own box.
   */
  shrink?: boolean;
}) {
  return (
    <span
      title={path}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${
        shrink ? 'min-w-0 shrink' : 'shrink-0'
      } ${onClick ? 'cursor-pointer hover:brightness-125' : ''}`}
      style={{ borderColor: color, color }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {/* No width cap: a long project name must read in full — the row's title
          is what gives way, since it has its own tooltip and the tag does not.
          Where the caller has asked it to give way it truncates rather than
          overflowing, and `title={path}` is on the tag itself, so a cut one is
          still answerable. */}
      <span className={shrink ? 'truncate' : 'whitespace-nowrap'}>{name}</span>
    </span>
  );
}
