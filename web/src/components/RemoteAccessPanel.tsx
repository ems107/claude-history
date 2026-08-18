import type { AppSettings } from '@claude-history/shared';
import { MIN_PASSWORD_LENGTH } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.ts';
import { useLocalOnly } from '../api/useLocal.ts';

const btn =
  'cursor-pointer rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:cursor-default disabled:opacity-40';
const inputClass =
  'w-44 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 disabled:opacity-40 focus:border-[var(--text-dim)] focus:outline-none';

/**
 * Turning remote access on, and the two things that have to be true for it to
 * work: credentials, and a hole in the firewall.
 *
 * Both of those can only be done here, at the machine — the credentials because
 * being here IS the recovery story for a forgotten password, and the firewall
 * because Windows puts its administrator prompt on this desktop. So the panel
 * greys itself out over the network rather than pretending otherwise.
 */
export function RemoteAccessPanel({
  settings,
  save,
  dev,
}: {
  settings: AppSettings;
  save: (patch: Partial<AppSettings>) => void;
  dev: boolean;
}) {
  const queryClient = useQueryClient();
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

  const rule = firewall.data;
  const publicProfile = rule?.activeProfiles.includes('Public') ?? false;

  return (
    <>
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

      {(formOpen || configured) && !credentials.disabled && (
        <div className="space-y-2 rounded border border-[var(--border)] p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[var(--text-dim)]">{configured && !formOpen ? 'Signing in uses' : 'Set'}</span>
            {configured && !formOpen ? (
              <>
                <span className="font-mono">a username and password</span>
                <button type="button" className={btn} onClick={() => setSettingUp(true)}>
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
                  className={btn}
                  disabled={busy !== null || !username.trim() || password.length < MIN_PASSWORD_LENGTH}
                  onClick={submitCredentials}
                >
                  {busy === 'credentials' ? 'Saving…' : 'Save'}
                </button>
                {settingUp && configured && (
                  <button type="button" className={btn} onClick={() => setSettingUp(false)}>
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
        </div>
      )}

      {settings.remoteAccessEnabled && (
        <div className="space-y-2 text-[11px] leading-relaxed text-[var(--text-dim)]">
          {rule?.addresses.length ? (
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

      {!firewallOnly.disabled && settings.remoteAccessEnabled && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[var(--text-dim)]">
            Windows Firewall:{' '}
            {rule === undefined
              ? 'reading…'
              : rule.ruleExists === null
                ? 'could not be read'
                : rule.ruleExists
                  ? `port ${String(rule.port)} is open on private networks`
                  : `port ${String(rule.port)} is closed — no machine can reach this one`}
          </span>
          <button
            type="button"
            className={btn}
            disabled={busy !== null || rule === undefined || rule.ruleExists === null}
            title={firewallOnly.reason ?? 'Windows will ask for administrator approval'}
            onClick={() => {
              const allow = !rule?.ruleExists;
              setBusy('firewall');
              setError(null);
              api
                .setFirewallRule(allow)
                .then(() => setNote(allow ? 'The port is open on private networks.' : 'The rule was removed.'))
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => {
                  setBusy(null);
                  void queryClient.invalidateQueries({ queryKey: ['firewall'] });
                });
            }}
          >
            {busy === 'firewall' ? 'Waiting for Windows…' : rule?.ruleExists ? 'Close the port' : 'Open the port'}
          </button>
          {publicProfile && (
            <span className="text-amber-400">
              This machine is on a network Windows calls Public, where the rule does not apply. Set that connection to
              Private, or nothing will get through.
            </span>
          )}
        </div>
      )}

      {configured && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {remote && (
            <button
              type="button"
              className={btn}
              onClick={() => {
                void api.logout().then(() => queryClient.invalidateQueries({ queryKey: ['auth'] }));
              }}
            >
              Sign out
            </button>
          )}
          <button
            type="button"
            className={btn}
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
        </div>
      )}

      {note && <p className="text-[11px] text-[var(--text-dim)]">{note}</p>}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </>
  );
}
