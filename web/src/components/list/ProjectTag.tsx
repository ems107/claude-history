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
      className={`inline-flex max-w-48 shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${onClick ? 'cursor-pointer hover:brightness-125' : ''}`}
      style={{ borderColor: color, color }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{name}</span>
    </span>
  );
}
