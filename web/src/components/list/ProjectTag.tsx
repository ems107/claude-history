export function ProjectTag({
  name,
  path,
  color,
  onClick,
}: {
  name: string;
  path: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <span
      title={path}
      onClick={onClick}
      className={`inline-flex min-w-0 shrink items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${onClick ? 'cursor-pointer hover:brightness-125' : ''}`}
      style={{ borderColor: color, color }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {/* No width cap, and it still reads in full wherever there is room: the
          row's title is what gives way first, since it has its own tooltip and
          the tag does not. But `shrink-0` was a promise the layout cannot keep —
          in a session header squeezed to 320 px by a column beside it, an
          unshrinkable tag pushed `Find`, `View ▾` and `⋯` off the end of their
          own box. The tag has `title={path}` too, so a truncated one is still
          answerable. */}
      <span className="truncate">{name}</span>
    </span>
  );
}
