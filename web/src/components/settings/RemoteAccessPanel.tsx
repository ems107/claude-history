import type { ActiveConnection } from '@claude-history/shared';
import { BIND_REASONS, MIN_PASSWORD_LENGTH } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocalOnly } from '../../api/useLocal.ts';
import { useActiveSessionsGuard } from '../ActiveSessionsDialog.tsx';
import { actionClass } from '../controlClass.ts';
import { useSettingsPage } from './context.ts';
import { Anchored } from './controls.tsx';

const inputClass =
  'w-44 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 disabled:opacity-40 focus:border-[var(--text-dim)] focus:outline-none';

/**
 * Turning remote access on, and the three things that have to be true for it to
 * work: credentials, a hole in the firewall, and a server that has listened on
 * the network since the hole existed.
 *
 * The first two can only be done here, at the machine — the credentials because
 * being here IS the recovery story for a forgotten password, and the firewall
 * because Windows puts its administrator prompt on this desktop. So the panel
 * greys itself out over the network rather than pretending otherwise.
 *
 * The third is why this panel now reports rather than promises. The switch used
 * to be the whole story; it is not, because a server that opens a listening
 * socket on the network with no rule to permit it makes Windows raise its "allow
 * this app?" dialog — on every update, since the `node.exe` path changes each
 * time. So the bind is decided at startup from what the firewall already allows
 * (`server/src/core/bind.ts`), and the switch is a wish until a restart grants
 * it. Saying so is the panel's job: the alternative is a switch that reads "on"
 * beside a port nothing can reach.
 */
export function RemoteAccessPanel() {
  const { settings, save, dev } = useSettingsPage();
  const queryClient = useQueryClient();
  const guard = useActiveSessionsGuard();
  const auth = useQuery({ queryKey: ['auth'], queryFn: api.authStatus });
  const credentials = useLocalOnly('credentials');
  const firewallOnly = useLocalOnly('firewall');
  // Only asked for where it can be acted on, and it shells out to PowerShell:
  // no reason to pay for it in every remote tab.
  const firewall = useQuery({ queryKey: ['firewall'], queryFn: api.firewall, enabled: !firewallOnly.disabled && !dev });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Turning the switch on with no credentials set does not fail — it opens the
  // form and waits, and the save happens once both halves exist. One gesture,
  // and no moment where the switch is on and the door is open.
  const [settingUp, setSettingUp] = useState(false);

  const configured = auth.data?.configured ?? false;
  const remote = auth.data?.remote ?? false;
  const formOpen = settingUp || (!configured && settings.remoteAccessEnabled);

  if (dev) {
    return (
      <p className="text-[11px] leading-relaxed text-[var(--text-dim)]">
        Remote access belongs to the installed release. This dev instance listens on 127.0.0.1 only, so there is nothing
        here to switch on — and nothing it could expose.
      </p>
    );
  }

  const submitCredentials = () => {
    setError(null);
    if (password !== repeat) {
      setError('The two passwords are different.');
      return;
    }
    setBusy('credentials');
    api
      .setCredentials(username.trim(), password)
      .then(() => {
        setPassword('');
        setRepeat('');
        setSettingUp(false);
        setNote(configured ? 'Username and password replaced.' : 'Username and password set.');
        void queryClient.invalidateQueries({ queryKey: ['auth'] });
        // Only now can the switch be saved: the server refuses to turn it on
        // without credentials, which is what makes the order matter.
        if (!settings.remoteAccessEnabled) save({ remoteAccessEnabled: true });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };

  const toggle = (on: boolean) => {
    setNote(null);
    setError(null);
    if (on && !configured) {
      setSettingUp(true);
      return;
    }
    save({ remoteAccessEnabled: on });
  };

  /**
   * Restart, and wait it out here rather than reloading the page.
   *
   * The server comes back in a few seconds — the helper waits for the scheduled
   * task to report Ready before starting it again — and a reload fired into that
   * gap is a browser error page on the one screen that just asked for this.
   */
  const restart = () => {
    if (!confirm('Restart the server now? This page reconnects on its own in a few seconds.')) return;
    restartNow();
  };

  /**
   * The restart itself, without the question. Its own function because the
   * active-sessions dialog runs it again once the sessions are closed, and
   * asking twice for the same restart would be the app arguing with itself.
   */
  const restartNow = () => {
    setNote(null);
    setError(null);
    setBusy('restart');
    void (async () => {
      try {
        await api.restartServer();
        let back = false;
        for (let i = 0; i < 60 && !back; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          back = await api
            .health()
            .then(() => true)
            .catch(() => false);
        }
        setNote(back ? 'The server restarted.' : 'The server was asked to restart but has not answered yet.');
        await queryClient.invalidateQueries();
      } catch (e: unknown) {
        // Refused while the app is running Claude: the dialog lists what to
        // close and restarts once it is closed.
        if (guard.refused(e, restartNow)) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    })();
  };

  /**
   * Create-or-replace (true) or delete (false) the rule, then re-read it. Shared
   * by the two buttons that change it, so neither can forget the awaited re-read.
   */
  const setFirewallRule = (allow: boolean) => {
    setBusy('firewall');
    setError(null);
    void (async () => {
      try {
        await api.setFirewallRule(allow);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        // Awaited on purpose: this re-reads the rule through PowerShell and takes
        // a moment, and clearing `busy` first put the STALE answer back on screen
        // — "closed" beside a live button, seconds after the port was opened.
        await queryClient.invalidateQueries({ queryKey: ['firewall'] });
        setBusy(null);
      }
    })();
  };

  const rule = firewall.data;
  const blocks = rule?.blockingRules ?? [];
  // Which networks are Public, BY NAME, and whether any network is one the rule
  // covers. "This machine is on a network Windows calls Public" was true and
  // useless on a machine that is on Private and Public at the same time — a
  // Hyper-V switch and a VPN adapter are Public, and the sentence read as a
  // verdict on the LAN, which was Private and would have worked.
  const publicConnections = (rule?.activeConnections ?? []).filter((c) => c.category === 'Public');
  const coveredConnections = (rule?.activeConnections ?? []).filter((c) => c.category !== 'Public');
  const nameConnection = (c: ActiveConnection) => (c.name ? `${c.name} on ${c.interfaceAlias}` : c.interfaceAlias);
  // Shown while the switch is on, and also while it is off and the socket from
  // before it was turned off is still open — that second state needs a restart
  // to end, so hiding it would hide the button that ends it.
  const showBind = settings.remoteAccessEnabled || rule?.listening === 'network';

  return (
    <>
      <Anchored id="set-remoteAccessEnabled">
        <label className={`flex items-start gap-2 ${credentials.disabled ? 'opacity-40' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={settings.remoteAccessEnabled}
            disabled={credentials.disabled}
            onChange={(e) => toggle(e.target.checked)}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            Let other machines on this network use claude-history
            <span className="block text-[11px] text-[var(--text-dim)]">
              {credentials.disabled
                ? credentials.reason
                : 'They have to sign in first. Anything on this machine keeps working with no password, as it always has.'}
            </span>
          </span>
        </label>
      </Anchored>

      {(formOpen || configured) && !credentials.disabled && (
        <Anchored id="act-credentials" className="space-y-2 border border-[var(--border)] p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[var(--text-dim)]">{configured && !formOpen ? 'Signing in uses' : 'Set'}</span>
            {configured && !formOpen ? (
              <>
                <span className="font-mono">a username and password</span>
                <button type="button" className={actionClass} onClick={() => setSettingUp(true)}>
                  Change them
                </button>
              </>
            ) : (
              <>
                <input
                  className={inputClass}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  autoComplete="username"
                />
                <input
                  className={inputClass}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={`Password (${MIN_PASSWORD_LENGTH}+)`}
                  autoComplete="new-password"
                />
                <input
                  className={inputClass}
                  type="password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  placeholder="Repeat it"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className={actionClass}
                  disabled={busy !== null || !username.trim() || password.length < MIN_PASSWORD_LENGTH}
                  onClick={submitCredentials}
                >
                  Save
                </button>
                {busy === 'credentials' && (
                  <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent text-[var(--text-dim)]" />
                )}
                {settingUp && configured && (
                  <button type="button" className={actionClass} onClick={() => setSettingUp(false)}>
                    Cancel
                  </button>
                )}
              </>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--text-dim)]">
            No old password is ever asked for: being at this machine is already enough to run anything on it, so it is
            what gets you back in after forgetting one.
          </p>
        </Anchored>
      )}

      {settings.remoteAccessEnabled && (
        <div className="space-y-2 text-[11px] leading-relaxed text-[var(--text-dim)]">
          {/* The URL is only printed once it is a URL that answers. Offering it
              while the server listens on loopback alone would send someone to
              another room to type an address that refuses the connection. */}
          {rule?.listening === 'network' && rule.addresses.length ? (
            <p>
              From another machine, open{' '}
              <span className="font-mono text-[var(--text)]">
                http://{rule.addresses[0]}:{rule.port}
              </span>
              {rule.addresses.length > 1 && <> (or {rule.addresses.slice(1).join(', ')})</>}.
            </p>
          ) : null}
          <p>
            Whoever signs in gets everything this app can do — reading every conversation on this machine, and the
            composer, which runs Claude here with tools approved automatically. Over plain HTTP the password crosses the
            network unencrypted, which is why this belongs on a home network or a VPN and nowhere else.
          </p>
        </div>
      )}

      {!firewallOnly.disabled && showBind && (
        <Anchored id="act-firewall" className="space-y-2 border border-[var(--border)] p-2">
          {settings.remoteAccessEnabled && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[var(--text-dim)]">
                Windows Firewall:{' '}
                {/* The state, and while one is being changed the WAIT — never the
                    old answer with the click already gone, which reads as nothing
                    having happened. It holds until the rule has been re-read, not
                    until the elevated command returns. */}
                {busy === 'firewall' ? (
                  <span className="inline-flex items-center gap-1.5 text-[var(--text)]">
                    <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Waiting for Windows…
                  </span>
                ) : rule === undefined ? (
                  'reading…'
                ) : rule.ruleExists === null ? (
                  // With the reason, which the server has always sent and this
                  // has never shown: "could not be read" alone leaves the one
                  // person who can fix it guessing at what refused.
                  <>
                    could not be read
                    {rule.error && <span className="ml-1 text-amber-400">— {rule.error}</span>}
                  </>
                ) : rule.ruleExists ? (
                  `port ${String(rule.port)} is open on private networks`
                ) : (
                  `port ${String(rule.port)} is closed — no machine can reach this one`
                )}
              </span>
              {/* The label says what the click DOES, never what is happening: a
                  button is a verb, and one that renames itself to a status is both
                  a worse verb and a worse status. Disabled is the honest way to say
                  "not now" — visibly unusable, and it claims nothing. */}
              <button
                type="button"
                className={actionClass}
                disabled={busy !== null || rule === undefined || rule.ruleExists === null}
                title={firewallOnly.reason ?? 'Windows will ask for administrator approval'}
                onClick={() => setFirewallRule(!rule?.ruleExists)}
              >
                {rule?.ruleExists ? 'Close the port' : 'Open the port'}
              </button>
              {/* Duplicates are harmless to the verdict, but they are the visible
                  scar of the read being broken — the panel said "closed" after
                  every success, so the button kept creating another. Offered here
                  because the alternative route back to one rule is closing the
                  port and opening it again: two prompts, and a gap with no rule. */}
              {rule?.ruleExists && rule.ruleCount > 1 && (
                <>
                  <span className="text-amber-400">
                    {rule.ruleCount} identical rules exist for this port; one is enough.
                  </span>
                  <button
                    type="button"
                    className={actionClass}
                    disabled={busy !== null}
                    title={firewallOnly.reason ?? 'Replaces them with a single rule. Windows will ask for approval'}
                    onClick={() => setFirewallRule(true)}
                  >
                    Tidy them up
                  </button>
                </>
              )}
              {publicConnections.length > 0 &&
                (coveredConnections.length === 0 ? (
                  <span className="text-amber-400">
                    This machine is on a network Windows calls Public, where the rule does not apply. Set that
                    connection to Private, or nothing will get through.
                  </span>
                ) : (
                  // Worth saying, but not a warning: the rule covers the network
                  // that carries traffic, and the Public ones staying shut is the
                  // whole point of scoping it to Private.
                  <span className="text-[var(--text-dim)]">
                    Also on {publicConnections.length === 1 ? 'a network' : `${publicConnections.length} networks`}{' '}
                    Windows calls Public ({publicConnections.map(nameConnection).join(', ')}) — anything arriving there
                    stays blocked, which is intended.
                  </span>
                ))}
            </div>
          )}

          {/* What the server is actually doing, which is a different fact from
              what the switch says — and the only one that decides whether
              anything can reach this machine right now. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={rule && rule.wantsNetwork && rule.listening === 'local' ? 'text-amber-400' : 'text-[var(--text-dim)]'}>
              {busy === 'restart' ? (
                <span className="inline-flex items-center gap-1.5 text-[var(--text)]">
                  <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Restarting…
                </span>
              ) : rule === undefined ? (
                'Listening: reading…'
              ) : rule.listening === 'network' ? (
                rule.wantsNetwork
                  ? 'Listening on every interface: other machines can reach this one.'
                  : 'Still listening on every interface until the next restart, and refusing every request that arrives from the network.'
              ) : rule.restartNeeded ? (
                // Nothing is missing any more, so do not name what was missing
                // when this server started: the port was opened after it bound,
                // and repeating the startup reason here read as "there is no
                // rule" seconds after one was created.
                'Nothing is missing now — but where a server listens is settled when it starts, so this one stays on this machine only until it restarts.'
              ) : (
                // The live obstacle, never the startup one.
                `Listening on this machine only, because ${BIND_REASONS[rule.currentReason]}`
              )}
            </span>
            {rule?.restartNeeded && busy !== 'restart' && (
              <button
                type="button"
                className={actionClass}
                disabled={busy !== null}
                title="Where the server listens is decided when it starts, so this is what applies the change."
                onClick={restart}
              >
                Restart the server
              </button>
            )}
          </div>

          {/* The leftovers from answering the Windows dialog with Cancel: one
              pair per version, each nailed to that version's node.exe, and every
              one of them beating the rule above. */}
          {/* A failed look is not a clean firewall, and this is where saying so
              belongs: no list, and nothing to point the button at. */}
          {rule?.blockingRulesError && (
            <p className="text-[11px] leading-relaxed text-amber-400">
              Windows would not say whether anything blocks this app: {rule.blockingRulesError}
            </p>
          )}

          {blocks.length > 0 && (
            <div className="space-y-1 text-[11px] leading-relaxed">
              <p className="text-amber-400">
                {blocks.length === 1 ? 'One rule blocks' : `${String(blocks.length)} rules block`} this app in the
                firewall — what Windows writes when its "allow this app?" dialog is answered with Cancel. A block beats
                the rule above, so nothing gets through on the profiles they name.
              </p>
              <ul className="text-[var(--text-dim)]">
                {blocks.map((b) => (
                  <li
                    key={`${b.displayName}-${b.program}-${b.protocol}`}
                    className="font-mono text-[10px] break-all"
                  >
                    {b.protocol} · {b.profiles.join(', ') || 'no profile'} · {b.program}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={actionClass}
                disabled={busy !== null}
                title={firewallOnly.reason ?? 'Windows will ask for administrator approval'}
                onClick={() => {
                  if (!confirm(`Delete ${String(blocks.length)} blocking rule(s) from the Windows Firewall?`)) return;
                  setBusy('firewall');
                  setError(null);
                  void (async () => {
                    try {
                      const body = await api.removeFirewallBlocks();
                      setNote(`${String(body.removed ?? 0)} blocking rule(s) removed.`);
                    } catch (e: unknown) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      await queryClient.invalidateQueries({ queryKey: ['firewall'] });
                      setBusy(null);
                    }
                  })();
                }}
              >
                Remove them
              </button>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-[var(--text-dim)]">
            Turning this on does not open the port by itself, and that is the point: the server waits until Windows
            already allows it, so installing an update can never make Windows ask you for permission.
          </p>
        </Anchored>
      )}

      {configured && (
        <Anchored id="act-sign-out" className="flex flex-wrap items-center gap-2 pt-1">
          {remote && (
            <button
              type="button"
              className={actionClass}
              onClick={() => {
                void api.logout().then(() => queryClient.invalidateQueries({ queryKey: ['auth'] }));
              }}
            >
              Sign out
            </button>
          )}
          <button
            type="button"
            className={actionClass}
            disabled={busy !== null}
            title="Replaces the signing key, so every device that is signed in has to sign in again — this one included."
            onClick={() => {
              if (!confirm('Sign out every device, including this one if it is remote?')) return;
              setBusy('logout-all');
              api
                .logoutEverywhere()
                .then(() => {
                  setNote('Every signed-in device has been signed out.');
                  void queryClient.invalidateQueries({ queryKey: ['auth'] });
                })
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(null));
            }}
          >
            Sign out everywhere
          </button>
        </Anchored>
      )}

      {note && <p className="text-[11px] text-[var(--text-dim)]">{note}</p>}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </>
  );
}
