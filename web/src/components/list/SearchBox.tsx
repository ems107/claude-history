import { useEffect, useRef, useState } from 'react';

export function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const [text, setText] = useState(value);
  const latest = useRef(value);
  latest.current = value;

  // External changes (URL navigation) reset the input.
  useEffect(() => setText(value), [value]);

  useEffect(() => {
    if (text === latest.current) return;
    const t = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(t);
  }, [text, onChange]);

  return (
    <div className="relative max-w-md min-w-48 flex-1">
      <input
        id="global-search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search all conversations…  ( / )"
        className="w-full rounded border border-[var(--border)] bg-[var(--bg-raised)] py-1 pr-7 pl-2.5 text-sm placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)] focus:outline-none"
      />
      {text && (
        <button
          type="button"
          onClick={() => {
            setText('');
            onChange('');
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer text-[var(--text-dim)] hover:text-[var(--text)]"
          title="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );
}
