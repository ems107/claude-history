import type { ActiveConnection } from '@claude-history/shared';
import { BIND_REASONS, MAX_USERNAME_LENGTH, MIN_PASSWORD_LENGTH } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useState } from 'react';
import { api } from '../../api/client.ts';
import { useHideLocalOnly, useLocalOnly } from '../../api/useLocal.ts';
import { useActiveSessionsGuard } from '../ActiveSessionsDialog.tsx';
import { actionClass } from '../controlClass.ts';
import { useSettingsPage } from './context.ts';
import { Anchored, hintClass, inputClass, Switch } from './controls.tsx';

/** The shared box, at the width three credentials fields want. */
const credentialClass = `w-44 ${inputClass} max-md:min-h-11`;

/** What the disabled Save button points a screen reader at. */
const RULE_ID = 'act-credentials-rule';

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
  const { settings, save } = useSettingsPage();
  const queryClient = useQueryClient();
  const guard = useActiveSessionsGuard();
  const auth = useQuery({ queryKey: ['auth'], queryFn: api.authStatus });
  const credentials = useLocalOnly('credentials');
  const firewallOnly = useLocalOnly('firewall');
  // Setting the password and opening the firewall port are both things that
  // can only be done AT the machine — the second raises a UAC prompt on its
  // desktop — so from a phone they are two dead controls and a paragraph.
  const hideLocal = useHideLocalOnly();
  // Only asked for where it can be acted on, and it shells out to PowerShell:
  // no reason to pay for it in every remote tab. A dev instance asks like any
  // other now — it has a port and a rule of its own, and this panel is where
  // both are looked at.
  const firewall = useQuery({ queryKey: ['firewall'], queryFn: api.firewall, enabled: !firewallOnly.disabled });

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

  /**
   * What still stands between these three boxes and a saved credential, or null
   * when nothing does.
   *
   * It exists because *this panel was reported as a broken checkbox*, and the
   * report was fair: a seven-character password left **Save** grey, the rule
   * that made it grey was written down nowhere but a placeholder that vanished
   * as soon as anything was typed, and the switch above sat unmoved through
   * every click. A disabled button is a refusal, and a refusal that will not
   * say what it wants is indistinguishable from a dead control.
   *
   * So one sentence does both jobs — it disables the button and it is printed
   * under it — and the rules it checks are the server's own
   * ([validateCredentials](../../../../server/src/core/auth.ts)) rather than a
   * second copy free to drift from them. The username's ceiling is absent on
   * purpose: the box carries it as `maxLength`, so it cannot be reached.
   */
  const missing: string | null = (() => {
    if (!username.trim()) return 'a username';
    if (password.length < MIN_PASSWORD_LENGTH) {
      const short = MIN_PASSWORD_LENGTH - password.length;
      return password.length === 0
        ? `a password of ${String(MIN_PASSWORD_LENGTH)} characters or more`
        : `${String(short)} more character${short === 1 ? '' : 's'} in the password — ${String(
            MIN_PASSWORD_LENGTH,
          )} is the minimum`;
    }
    if (!repeat) return 'the password typed again in the third box';
    if (repeat !== password) return 'the two passwords to match — the second box is different';
    return null;
  })();

  const submitCredentials = () => {
    // The braces for the two belts: the button is disabled and the Enter key
    // is guarded, and neither is a reason for this to trust its caller.
    if (missing !== null || busy !== null) return;
    setError(null);
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

  /** Has anybody typed in any of the three boxes yet? */
  const typed = username !== '' || password !== '' || repeat !== '';

  /**
   * Enter, in any of the three boxes, is the gesture a form this shape is
   * expected to answer — and this one is not a `<form>`, so it has to be said
   * out loud. Guarded by the same sentence as the button: a keystroke may not
   * do what a click is refused.
   */
  const onCredentialKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submitCredentials();
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
      {/* The same switch every other feature on this page wears — this one is a
          feature master too, and the fact that its `toggle` does more than save
          (it opens the credentials form when there are none) is a reason for it
          to look MORE like the others, not less. */}
      <Anchored id="set-remoteAccessEnabled" className="border-b border-[var(--border)] pb-3">
        {hideLocal ? (
          // A phone reading this page IS the remote access it describes, and
          // there is nothing here it can change: the switch, the password and
          // the firewall are all decided at the machine. So it says what the
          // state is and where it is changed, instead of drawing a switch that
          // can only refuse ([useHideLocalOnly]).
          <p className="text-[11px] leading-relaxed text-[var(--text-dim)]">
            Remote access is <span className="text-[var(--text)]">on</span> — it is how you are reading this. The
            switch, the username and password, and the firewall rule are all set on the machine claude-history runs
            on.
          </p>
        ) : (
          <div className={`flex items-start gap-2.5 ${credentials.disabled ? 'opacity-70' : ''}`}>
            <Switch
              checked={settings.remoteAccessEnabled}
              disabled={credentials.disabled}
              onChange={(v) => toggle(v)}
            />
            <span>
              Let other machines on this network use claude-history
              <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--text-dim)]">
                {credentials.disabled
                  ? credentials.reason
                  : configured
                    ? 'They have to sign in first. Anything on this machine keeps working with no password, as it always has.'
                    : // Said BEFORE the first click, which is the one moment it
                      // is needed: the switch cannot go on without credentials,
                      // so clicking it opens the form and leaves the switch
                      // where it was. Unexplained, that is a dead control.
                      'They have to sign in first, so this needs a username and password before it can be on — clicking asks for them, and the switch follows as soon as they are saved.'}
              </span>
            </span>
          </div>
        )}
      </Anchored>

      {(formOpen || configured) && !credentials.disabled && (
        <Anchored id="act-credentials" className="space-y-2 border border-[var(--border)] p-2">
          {configured && !formOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[var(--text-dim)]">Signing in uses</span>
              <span className="font-mono">a username and password</span>
              <button type="button" className={actionClass} onClick={() => setSettingUp(true)}>
                Change them
              </button>
            </div>
          ) : (
            <>
              {/* What the box is for — and, the first time, what the switch
                  above is waiting for. It stays visibly off while these three
                  boxes are being filled in, and that is precisely how it was
                  reported as broken: clicked, nothing moved, nothing said why. */}
              <p className={hintClass}>
                Any username, and a password of {MIN_PASSWORD_LENGTH} characters or more.{' '}
                {configured
                  ? 'Whatever is signed in stays signed in — signing those out is a button of its own, below.'
                  : 'Remote access cannot be on before they exist, which is why the switch above is still off — it turns itself on as soon as they are saved.'}
              </p>
              {/* `items-end` so the button keeps the boxes' own baseline now
                  that each of them carries a name above it. */}
              <div className="flex flex-wrap items-end gap-2">
                {/* Names ABOVE the boxes rather than placeholders inside them. A
                    placeholder is gone the moment anything is typed — it takes
                    the field's name away with it, and it was the only place the
                    password's one rule was ever written down. */}
                <label className="block">
                  <span className="mb-1 block">Username</span>
                  <input
                    className={credentialClass}
                    value={username}
                    maxLength={MAX_USERNAME_LENGTH}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={onCredentialKey}
                    autoComplete="username"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block">Password</span>
                  <input
                    className={credentialClass}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={onCredentialKey}
                    autoComplete="new-password"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block">Repeat the password</span>
                  <input
                    className={credentialClass}
                    type="password"
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                    onKeyDown={onCredentialKey}
                    autoComplete="new-password"
                  />
                </label>
                <button
                  type="button"
                  className={actionClass}
                  aria-describedby={missing === null ? undefined : RULE_ID}
                  disabled={busy !== null || missing !== null}
                  onClick={submitCredentials}
                >
                  Save
                </button>
                {busy === 'credentials' && (
                  <span className="mb-1 inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent text-[var(--text-dim)]" />
                )}
                {settingUp && configured && (
                  <button type="button" className={actionClass} onClick={() => setSettingUp(false)}>
                    Cancel
                  </button>
                )}
              </div>
              {/* What a grey button owes whoever is looking at it. Amber only
                  once something has been typed: on a form nobody has touched
                  yet the same sentence is an instruction, not a complaint, and
                  a box that opens already warning about a mistake nobody has
                  made reads as broken in its own way. */}
              {missing !== null && (
                <p id={RULE_ID} className={typed ? 'text-[11px] leading-relaxed text-amber-400' : hintClass}>
                  Save is waiting for {missing}.
                </p>
              )}
            </>
          )}
          <p className={hintClass}>
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
