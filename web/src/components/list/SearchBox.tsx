import { useEffect, useRef, useState } from 'react';

export function SearchBox({
  value,
  onChange,
  // The phone's bar has no room for the desktop's "370 of 400 sessions", and an
  // empty box is exactly when there is room to read it.
  placeholder = 'Search all conversations…  ( / )',
}: {
  value: string;
  onChange: (q: string) => void;
  placeholder?: string;
}) {
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
    // `min-w-48` is a floor for a row that has room to give; on a phone it is
    // 192 of the 328 available and the reason nothing else fits beside it.
    <div className="relative max-w-md min-w-48 flex-1 max-md:min-w-0">
      <input
        id="global-search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-[var(--border)] bg-[var(--bg-raised)] py-1 pr-7 pl-2.5 text-sm placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)] focus:outline-none max-md:min-h-9"
      />
      {text && (
        <button
          type="button"
          onClick={() => {
            setText('');
            onChange('');
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer px-1 text-[var(--text-dim)] hover:text-[var(--text)] max-md:px-2 max-md:text-lg"
          title="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );
}
