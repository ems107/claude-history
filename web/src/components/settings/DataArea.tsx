import { Link } from 'react-router';
import { BackupsPanel } from './BackupsPanel.tsx';
import { Anchored, GroupCard } from './controls.tsx';
import { RetentionPanel } from './RetentionPanel.tsx';

/**
 * The two things that decide what survives, and the one file that holds
 * everything this app itself knows.
 *
 * They belong together because the question underneath all three is the same —
 * what is kept, and by whom. `backups` is ours and we can put it back;
 * `claude-retention` is Claude Code's and we only ever read it; `prices` lives
 * in the same file as the first and is edited somewhere else entirely, which is
 * exactly the sort of thing a page like this exists to say out loud.
 */
export function DataArea() {
  return (
    <>
      <GroupCard id="backups">
        <BackupsPanel />
      </GroupCard>

      {/* Not moved here, and the reason is worth the three lines it costs.
          The editor is a five-column table of every model, and it needs the list
          of models your sessions actually used — which only the stats aggregate
          knows. It also sits beside the costs it produces, which is where you
          notice a price is wrong. So it stays, and this says where it went. */}
      <GroupCard id="prices">
        <Anchored id="info-prices">
          <p className="max-w-prose">
            Your price table lives in the same file as everything above, and a restore replaces it along with the rest.
            It is edited on the{' '}
            <Link to="/stats" className="text-[var(--accent)] hover:underline">
              Stats page
            </Link>
            , beside the costs it produces and the list of models your sessions actually used.
          </p>
        </Anchored>
      </GroupCard>

      {/* Claude Code's setting, not ours — shown and explained, never written. */}
      <GroupCard id="claude-retention">
        <RetentionPanel />
      </GroupCard>
    </>
  );
}
