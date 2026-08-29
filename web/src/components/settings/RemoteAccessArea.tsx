import { GroupCard } from './controls.tsx';
import { RemoteAccessPanel } from './RemoteAccessPanel.tsx';

/**
 * One group, and it is the panel — which is why this file is four lines.
 *
 * Remote access is a single switch with three conditions hanging off it
 * (credentials, a hole in the firewall, a server that has listened on the
 * network since the hole existed), and those conditions only make sense read in
 * order. Splitting them into groups would have given the rail three entries for
 * one decision.
 */
export function RemoteAccessArea() {
  return (
    <GroupCard id="remote-access">
      <RemoteAccessPanel />
    </GroupCard>
  );
}
