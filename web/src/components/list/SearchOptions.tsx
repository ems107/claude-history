import {
  DEFAULT_TUNING,
  type SearchTuning,
  tuningChanges,
  WHERE_OPTIONS,
} from '../../lib/searchTuning.ts';

/**
 * The match rule is one choice of three rather than a mode toggle plus a scope
 * toggle: the scope only means anything for several words, and a visible control
 * that does nothing in the current mode is its own kind of lie.
 */
const MATCH_OPTIONS: Array<{ id: string; label: string; hint: string; tuning: Partial<SearchTuning> }> = [
  {
    id: 'phrase',
    label: 'Phrase',
    hint: 'the words in this exact order',
    tuning: { mode: 'phrase' },
  },
  {
    id: 'message',
    label: 'All words, in the same message',
    hint: 'any order, but they must meet in one message',
    tuning: { mode: 'words', scope: 'message' },
  },
  {
    id: 'session',
    label: 'All words, anywhere in the session',
    hint: 'a wider net — they may sit turns apart',
    tuning: { mode: 'words', scope: 'session' },
  },
];

function currentChoice(tuning: SearchTuning): string {
  if (tuning.mode === 'phrase') return 'phrase';
  return tuning.scope === 'session' ? 'session' : 'message';
}

export function SearchOptions({
  tuning,
  onChange,
}: {
  tuning: SearchTuning;
  onChange: (tuning: SearchTuning) => void;
}) {
  const choice = currentChoice(tuning);
  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-raised)]/40 px-4 py-2.5 text-xs">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-2">
        <div>
          <div className="mb-1 text-[var(--text-dim)]">Match</div>
          {MATCH_OPTIONS.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-baseline gap-2 rounded px-1 py-0.5 select-none hover:bg-[var(--bg-hover)]"
            >
              <input
                type="radio"
                name="search-match"
                checked={choice === option.id}
                onChange={() => onChange({ ...tuning, ...option.tuning })}
                className="accent-[var(--accent)]"
              />
              <span>{option.label}</span>
              <span className="text-[var(--text-dim)]">— {option.hint}</span>
            </label>
          ))}
          {/*
            Only the loose modes split the query into terms, so only they can be
            told to keep some of them together. In Phrase mode the quotes would
            be searched for as characters, which is the opposite of what this
            says — hence shown here, under the modes it belongs to, and only
            while one of them is on.
          */}
          {tuning.mode === 'words' && (
            <div className="pl-6 text-[var(--text-dim)]">
              Quote to keep words together: <code>&quot;exact phrase&quot; word</code>
            </div>
          )}
          <label className="mt-1.5 flex cursor-pointer items-baseline gap-2 rounded px-1 py-0.5 select-none hover:bg-[var(--bg-hover)]">
            <input
              type="checkbox"
              checked={tuning.wholeWord}
              onChange={(e) => onChange({ ...tuning, wholeWord: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            <span>Whole words only</span>
            <span className="text-[var(--text-dim)]">— “log” matches log, but not dialog</span>
          </label>
        </div>
        <div>
          <div className="mb-1 text-[var(--text-dim)]">Where</div>
          {WHERE_OPTIONS.map(([value, label]) => (
            <label
              key={value}
              className="flex cursor-pointer items-baseline gap-2 rounded px-1 py-0.5 select-none hover:bg-[var(--bg-hover)]"
            >
              <input
                type="radio"
                name="search-where"
                checked={tuning.where === value}
                onChange={() => onChange({ ...tuning, where: value })}
                className="accent-[var(--accent)]"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>
      {tuningChanges(tuning) > 0 && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_TUNING)}
          className="mt-1.5 cursor-pointer text-[var(--text-dim)] underline decoration-dotted hover:text-[var(--text)]"
        >
          Back to a plain search
        </button>
      )}
    </div>
  );
}
