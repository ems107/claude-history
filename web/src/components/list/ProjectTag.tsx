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
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${onClick ? 'cursor-pointer hover:brightness-125' : ''}`}
      style={{ borderColor: color, color }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {/* No width cap: a long project name must read in full — the row's title
          is what gives way, since it has its own tooltip and the tag does not. */}
      <span className="whitespace-nowrap">{name}</span>
    </span>
  );
}
