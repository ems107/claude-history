# Remote access

**Load this when:** you touch the bind address, authentication, the local/remote split, or any button that acts on the machine the server runs on.

## Invariants

- **Nothing this app does on its own may make Windows ask for permission.** The only Windows dialog in its whole life is the UAC of the firewall button in Settings, pressed on purpose. Everything else waits.
- **The wide bind is earned, not assumed.** A release listens on the network only when the switch is on, credentials exist, and the firewall ALREADY permits the port — decided in `core/bind.ts` before `listen()`, re-decided on every start, never from a remembered verdict. A dev instance is always loopback. `--host` skips the lot, and is the only thing that may still raise the dialog.
- **A firewall read that FAILED must never be reported as a firewall that permits nothing.** A denial and an absence are different facts and lead to different buttons; conflating them is what pinned this server to loopback for weeks beside a rule that existed six times over. `probe.error` → `firewall-unreadable` → `ruleExists: null`, and the same rule holds for the blocking-rule scan.
- **The bind cannot change while the process runs**, so switching remote access on or off is a wish until a restart grants it. `POST /api/server/restart` is that restart, and it is local-only.
- **The wide bind and the session check are ONE feature** — never widen one without the other.
- **Local means the socket, never a header.** `isLocalRequest` reads `request.socket.remoteAddress`; `X-Forwarded-For` and `Host` are written by the caller and are ignored on purpose. **This app must not be put behind a reverse proxy** — every request would arrive from loopback and the authentication would vanish silently.
- **A local request never authenticates.** No password, no cookie, exactly as before this existed.
- **A remote request gets nothing until it signs in** — not the session list, not the version, not the paths. Only `/api/auth/*` and the static bundle answer first.
- **Credentials can only be SET locally**, and setting them never asks for the old one.
- **A `userdata.json` restore replaces the credentials and the switch like everything else** — no exceptions, including the ones that would be convenient.
- **The switch cannot be on without credentials** (clamped in `setSettings`, not just hidden in the UI).
- **Anything that opens a window on the server's desktop answers 409 when remote.** Silent success is the failure mode this prevents.

## The trust model

One line runs through all of it: **being at the machine is the root of trust.** Whoever is sitting there can already open a terminal and run anything, so a password would protect nothing and would lock the owner out of their own tool the day they forgot it. Everything below follows from that.

| | Local (`127.0.0.0/8`, `::1`) | Remote |
| --- | --- | --- |
| Reading, searching, the composer, the embedded terminal | yes, no password | yes, after signing in |
| Setting the username and password | yes, and no old password is asked for | **no** — 409 |
| Explorer / VS Code / terminal / firewall | yes | **no** — 409 |
| Stopping the server, uninstalling | yes | **no** — 409 |
| Applying an update | yes | **yes**, with a confirmation |

Applying an update is the one restart allowed from another machine: it puts itself back. Stopping does not, so it is refused — a stop from a phone ends the connection and leaves nothing that can start it again.

**What a signed-in session can do is everything.** The composer runs Claude in the project's directory with tools auto-approved, and `routes/files.ts` reads any path a transcript names ([Architecture](AI_ARCHITECTURE.md#security-and-containment)). That is the intended design — the whole point is full access — but it is why the password is the only thing between the LAN and this machine, and why the switch is off by default.

**The embedded terminal is allowed remotely, and it is `claude.exe` with no shell around it precisely so that it can be.** It runs the same CLI, in the same folder, as the same user, with the same tools auto-approved — so a signed-in browser gains nothing it did not already have through the composer. A shell underneath would have been strictly more than anything else this app offers, and that is the whole reason there is not one ([Running Claude](AI_RUNNING_CLAUDE.md)). "Resume in terminal" stays local-only for the reason everything on that list is: it opens a window on the server's own desktop, which is a different thing entirely.

One detail of the socket belongs here rather than there: **the upgrade is a GET, so the same-origin question is asked in the route and not by the global hook**, which exempts GET on purpose because a plain-HTTP page sends neither header on an ordinary one. A browser always sends `Origin` on a WebSocket upgrade, so there its absence is meaningful and `isSameOrigin` gives the right answer.

## The Windows dialog, and why the bind is gated on it

This is the mechanism the whole bind decision exists for, verified on a real machine, and it is worth knowing exactly:

> **Windows Defender Firewall raises "Do you want to allow public and private networks to access this app?" when a program opens a listening socket on anything but loopback and no rule decides the matter.**

Three inputs, all of them true on a stock Windows, and all read through the firewall's COM API — see [below](#why-the-rules-are-read-through-com) for why the obvious cmdlets are not used:

| Input | Read from | Default |
| --- | --- | --- |
| Unsolicited inbound traffic is blocked | `HNetCfg.FwPolicy2` → `DefaultInboundAction(profile)` | `0`, i.e. *block* (what the cmdlets spell `NotConfigured`) |
| A block becomes a dialog instead of silence | `HNetCfg.FwPolicy2` → `NotificationsDisabled(profile)` | `False`, i.e. it asks |
| Nothing decides about this port | `HNetCfg.FwPolicy2` → `Rules` | no rule |

Four consequences, each of which shaped a decision here:

- **It fires at `listen()`, not on the first connection.** So it appears while the app starts, with nobody having gone near a browser.
- **It asks about a PROGRAM, identified by its image path** — and the firewall records that path with junctions already resolved. Our `node.exe` lives at `versions\vX.Y.Z\node\node.exe`, so **every update is a new program and a new dialog**. Answering it does not help: "Allow" writes program-scoped rules nailed to that same path, and the next version is a stranger again.
- **"Cancel" is not a no.** It writes Block rules, also per path, which pile up one pair per version — and an explicit Block beats an Allow, so they quietly defeat the port rule this feature creates. Finding and removing them is `blockingRules` / `removeBlockingRules`.
- **Loopback never asks.** Loopback traffic is not filtered as unsolicited inbound at all, which is why none of this existed before remote access.

Hence the gate in [`core/bind.ts`](../server/src/core/bind.ts):

```
network ⇔ --host given
        ∨ ( not a dev instance ∧ remoteAccessEnabled ∧ credentials
            ∧ ( an enabled inbound Allow rule covers TCP <port> on the active profile
              ∨ DefaultInboundAction is Allow there ) )
```

Read it as **"is the traffic already permitted?"**, which is stronger than "would the dialog appear?" and simpler to be sure of: a Block rule also stops the dialog, and binding wide behind one would mean listening for nothing. What that costs, and why it is the right trade:

- **A rule must be a PORT rule to survive updates.** Ours is (`-LocalPort`, no `-Program`), which is why one UAC approval covers every future version. A rule carrying a program only counts if it names the `node.exe` we are actually running — `reason: 'rule-other-program'` says so, and warns that it dies at the next update.
- **The profile has to match the network we are on now.** A Private rule on a Public network would raise the dialog, so it is not enough for the rule to exist.
- **Windows classifies a network some seconds after logon**, and the scheduled task starts at logon. So the probe waits (`NETWORK_WAIT_SECONDS`) rather than reading "no networks" and locking the server to loopback every morning. `index.build()` running first buys most of that grace anyway.
- **Unreadable means loopback — and must SAY it is unreadable.** A PowerShell that times out decides nothing, and the safe nothing is this machine only. The half that is easy to forget is the reporting: `firewall-unreadable` and `ruleExists: null` exist so that "we could not look" never wears the clothes of "there is no rule", which is a sentence the user would act on by creating a rule they already have.
- **The reasons have one home**: `BIND_REASONS` in `shared/src/api.ts` is both the sentence in the panel and the middle of the line the server logs at startup.
- **There are TWO reasons, and mixing them up is a lie the panel tells.** `bindReason` is why this process bound the way it did *when it started*, and it never changes; `currentReason` is what stands in the way *now*, from the live switch and a fresh probe. Shown once as one thing, the panel said "no firewall rule allows this port" seconds after the user had created one — the port had been opened after the socket was bound. So: the startup reason belongs to the log and to "what a restart would change", the current one to anything a person reads, and when only the restart is left the panel says that instead of naming an obstacle at all. Both come from `localReason` in `core/bind.ts`, which is shared with the route precisely so the two can never disagree about the order they are checked in.

What is lost, deliberately: with the switch off, nothing listens, so a browser on the LAN gets a refused connection instead of the page that used to explain where to turn remote access on. That page was the whole argument for the permanent wide bind. It still appears in the window between switching remote access off and restarting, which is the one moment it says something true.

The port answering "off" to the whole network leaks nothing: `GET /api/auth/status` is four booleans, and every other route is refused before it runs.

### Why the rules are read through COM

**The NetSecurity cmdlets cannot read firewall rules without elevation, and this app never runs elevated.** Verified on a stock workgroup machine (Windows 10 19045, admin user with the ordinary filtered token, no group policy, Defender only), under both `powershell.exe` 5.1 — the host `util/firewall.ts` spawns — and `pwsh` 7:

| Unelevated | Answer |
| --- | --- |
| `Get-NetFirewallRule`, `Get-NetFirewallApplicationFilter` | **`CimException: Access is denied.`** |
| `Get-NetFirewallProfile`, `Get-NetConnectionProfile` | work |
| `HKLM\…\FirewallPolicy\FirewallRules` (the hive behind the cmdlets) | reads fine, 2473 values |
| `netsh advfirewall firewall show rule` | works, but the field names are **localised** |
| `HNetCfg.FwPolicy2` → `Rules` | **works**, same 2473 rules, ~0.1 s |

Elevated writes through that same module have always worked, so it is an elevation requirement on the `root/StandardCimv2` rule classes alone — not a broken firewall, and not something this app can ask the user to change.

**It is not every machine, which is the trap.** A second machine (Windows 11 Enterprise LTSC 2024, build 26100, workgroup, admin user with the ordinary filtered token) answers `Get-NetFirewallRule` and `Get-NetFirewallApplicationFilter` **unelevated, without complaint**, 502 rules each. So the denial is a property of the machine, not of Windows, and the cmdlet path is not reliably broken — it is reliably *unreliable*, which is worse: it works on the machine you test on and fails on the user's. COM reads correctly on both, which is the whole argument for it. Nothing here should ever be reintroduced on the strength of "the cmdlets work for me".

What that cost is the part worth keeping: the denial was swallowed by `-ErrorAction SilentlyContinue`, which made it **indistinguishable from "there is no rule"**. `evaluateFirewall` answered `no-rule`, `decideBind` chose loopback on every single start, and the panel invited the user to open a port that was already open — six times, leaving six identical rules and a feature that could not work on that machine at all. Hence the invariant above, and the general lesson: **a read that cannot fail loudly will fail quietly, as an empty answer that looks like an answer.**

So `COM_HELPERS` in `util/firewall.ts` reads the rules through `INetFwPolicy2` and **emits the strings the cmdlets used to emit**, deliberately: the mapping and the pure `evaluateFirewall` never learn that the source changed, so the shapes they were built against stay the contract. Three things to know before touching it:

- **`LocalPorts` is one string, and not always a number.** Real values on a stock machine: `7433`, `80,443`, `5000-5020`, the service keywords `RPC,` and `RPC-EPMap,` (trailing comma included), the wildcard `*` on 769 rules, and `$null` on every rule that is neither TCP nor UDP. **`*` and `$null` must become `Any`** — `portCovered` does not know the wildcard, so an every-port rule would otherwise read as `rule-wrong-port`. The keywords survive as words, match no number, and so cover nothing, which is the conservative answer and the same one the cmdlets gave.
- **`Profiles` is a bitmask** (1 Domain, 2 Private, 4 Public, `0x7FFFFFFF` all) and an unknown mask is emitted as a number on purpose, because a mask we do not understand must never be the thing that opens the door. `ApplicationName` is **null** for a port rule where the cmdlet said the word `Any`; both spellings are still dropped, because emptiness must have one meaning. `Enabled` is emitted as a **string** and `notify` as a **boolean**: swap either and `.toLowerCase()` throws inside the parse, turning a perfectly readable firewall into `firewall-unreadable`.
- **Late-bound COM has no `get_X()` accessors.** `$fw.get_DefaultInboundAction(2)` throws "does not contain a method named"; the parameterised property is called as `$fw.DefaultInboundAction(2)`.
- **Build the JSON with `@(...)`, never with `$(... else { @() })`.** In Windows PowerShell 5.1 — which is what `powershell.exe` is, and this module spawns no other — a `$(...)` whose branch emits nothing does not produce `$null`. It produces `[AutomationNull]::Value`: a singleton that compares equal to `$null`, prints as nothing, and which **`ConvertTo-Json` renders as `{}`**. An empty JSON *object* where the reader expects an absence, so `asArray` wraps it and `String()` turns it into the entirely path-shaped `[object Object]`. That is how `programs` — empty on every port rule, which is the only kind this app creates — arrived naming one program that was not ours, `evaluateFirewall` answered `rule-other-program`, and the bind went to loopback with a perfect rule sitting in the firewall. Under `pwsh` 7 the identical expression serializes as `null` and the bug is invisible, which is exactly how it survived being read twice. The array subexpression has no such edge, and a **literal** `$null` assigned to a hashtable key is fine in both shells — it is only the empty branch that lies.

`Get-NetConnectionProfile`'s `DefaultInboundAction` can say `NotConfigured`, which is not a word COM knows: `$fw.DefaultInboundAction($pt)` resolves the effective policy and answers `0` (Block) or `1` (Allow). That is the more useful answer here — the bind cares what Windows will *do*, not whether an administrator wrote it down — and it is why the mapping tests for `-eq 1` rather than for the word.

One known limit, stated rather than papered over: **COM sees the local store only**, so a rule deployed by group policy would be invisible to it. Ours is always created locally, so that does not bite — but it is why this is not a claim of equivalence with the cmdlets.

`Get-NetConnectionProfile` deliberately stays a cmdlet. It needs no elevation, it is the input to the `NETWORK_WAIT_SECONDS` loop, and it names each network, which the panel needs in order to say anything true about a machine that is on Private and Public at the same time. `CurrentProfileTypes` looks like a substitute and is not: it cannot express "Windows has not classified anything yet", so the wait loop would exit at once and the verdict would be `rule-other-profile` every morning.

## Restarting, because a socket cannot be re-addressed

`listen()` happens once, so the switch and the bind can only agree at startup. `POST /api/server/restart` closes that gap, and it is the same detour the updater takes: the server runs inside the `claude-history` scheduled task, Task Scheduler kills that task's whole process tree when it ends, and the task's only trigger is at-logon — so a helper spawned from here would die with us and nothing would be left to start anything. `update-helper.ps1 -RestartOnly` is registered as a one-shot task, waits for our pid to go, starts the app task and health-checks what comes back. It logs to the same `update.log`, so `updateLogImport` folds it into our own log with everything else.

Refused (409) mid-update and mid-composer-answer, for the reasons `/api/server/stop` is. Local-only, and this is the one place where "it comes back on its own" is not enough: it can come back listening on loopback alone — exactly what a restart after switching the feature OFF is for — which from another machine is a door closing with the key on the inside. `/api/update/apply` stays remote-allowed because it always comes back reachable.

The panel only offers the button when a restart would change something: the network is wanted and now permitted, or no longer wanted while the socket is still wide (`restartNeeded`). Wanting it with the port still shut is not a restart problem, and offering one there would waste a restart.

## The pieces

| File | What it owns |
| --- | --- |
| `server/src/core/bind.ts` | the gate: `decideBind`, and the line it logs |
| `server/src/util/firewall.ts` | talking to the firewall — the probe, the pure `evaluateFirewall`, the elevated writes |
| `shared/src/api.ts` | `BindReason` / `BIND_REASONS`: every way the answer can come out, in words |
| `server/src/util/remote.ts` | `isLocalRequest` — the socket, IPv4-mapped IPv6 included |
| `server/src/core/auth.ts` | scrypt hashing, the signed cookie, the login backoff |
| `server/src/routes/auth.ts` | `/api/auth/*` and `isAuthenticated` |
| `server/src/util/localOnlyRoutes.ts` | which endpoints are local-only |
| `shared/src/localOnly.ts` | **why**, in the words shown to the user |
| `server/src/app.ts` | the three `onRequest` hooks, in order: session → local-only → same-origin |
| `web/src/App.tsx` | `AppGate`: the app, the login, or "remote access is off" |
| `web/src/api/useLocal.ts` | `useIsRemote` / `useLocalOnly` for the UI |

### The session cookie has no server-side store

Deliberately, and the reason is `update/apply`: it restarts the process, and it is allowed from a remote browser. Sessions held in memory would sign the user out in the middle of the one operation that cannot be finished from the machine they are not at. So the cookie is `base64url(payload).hmac(secret)`, the secret lives in `userdata.json`, and nothing has to be remembered.

Two consequences worth knowing: **rotating the secret is "sign out everywhere"** (one line, and reachable remotely on purpose — the moment you need it is the moment a device you no longer hold is still signed in), and **renaming the user invalidates every cookie**, because the payload carries the username and it is compared on every request.

### A restore can lock you out, and is allowed to

`userdata.json` holds the credentials (`auth`) and `remoteAccessEnabled` beside the renames, pins, stars and prices, and a restore replaces the file wholesale. So **restoring a copy older than this feature revokes every signed-in device and switches remote access off** — every copy taken before it exists carries no `auth` at all — and the panel that restores them is reachable remotely, so it can be done from a machine you are then locked out of.

That is the behaviour, not an oversight. Exempting the two keys was tried and reverted: the confirmation in `BackupsPanel` promises that *everything* in the file is replaced by the copy, and an exception makes the file after a restore not be the copy — which is a worse and more permanent surprise than the lockout. The rule would also have been asymmetric (a copy WITH credentials replaces them, one without does not, so the same copy restores differently from different states) and would have made `remoteAccessEnabled` impossible to switch off through a restore at all.

What pays for it: the `pre-restore` copy taken automatically before every restore, and the fact that credentials are set at the machine anyway — which is where you have to be to undo it.

### The reason text has one home

A local-only button is greyed out with a tooltip, and the endpoint behind it answers 409 with the **same sentence** — both read `LOCAL_ONLY_ACTIONS` from `shared/`. The button is the explanation; the 409 is the guarantee. Neither is optional: a handler that forgets the check answers `{ok: true}` and opens a window nobody is looking at.

## HTTP, and the two things it breaks

There is no HTTPS: this is a personal tool on a home LAN or inside a WireGuard tunnel, and certificates for an IP address cost more than they buy here. The password does cross the LAN in clear, which is the accepted trade and the reason this is not for any other kind of network.

### `Sec-Fetch-*` does not exist here either

Same rule, different victim: **fetch-metadata headers are only sent to potentially trustworthy origins**, which again means HTTPS or localhost. Served from `http://192.168.x.x`, a same-origin GET made by our own page carries **no `Sec-Fetch-Site` and no `Origin`** — browsers omit `Origin` on same-origin GETs, and the other header never comes.

That broke `/api/files/read` the first time the file panel was opened from another machine: `isSameOrigin` read "neither header" as "not a browser" and answered 403 to our own page. So the question is now only asked where the answer means something — **`Origin` rides on every state-changing request**, so its absence on a POST is still meaningful and still refused from off-machine; on a GET it is not.

What that costs, honestly: on a plain-HTTP origin the two file GETs are guarded by the `Origin` check alone. A cross-origin `fetch` still carries it and is still refused, but **an `<img>` sends no `Origin`**, so a foreign page open in a browser that holds a session here could point one at `/api/files/image` and learn from `onload` whether a path exists. It cannot read the pixels — a cross-origin image taints the canvas. It is a narrow leak, it predates remote access (any page could already do this against `127.0.0.1`), and **the fix for it is HTTPS**, not more header checks.

### The clipboard

**`navigator.clipboard` is `[SecureContext]`, and a secure context is HTTPS or localhost — nothing else.** Served from `http://192.168.x.x` the object is `undefined`, not merely restricted, so every copy button throws a `TypeError`. `web/src/lib/clipboard.ts` falls back to the `copy` event plus `execCommand`, which is deprecated but not gated, and **keeps the HTML+text pair** so copying with formatting still pastes into Word and Jira. Nothing in this app reads the clipboard; that half of the API is what got the whole namespace put behind secure contexts.

Everything else survives plain HTTP: `localStorage`, SSE (`/api/events` has a 25 s heartbeat, which is also what keeps a NAT from dropping the connection), images, and the `.md` export, whose attachments are data URIs and need no path on the viewer's machine.

## The firewall rule

Windows blocks the port inbound by default, the install is per user with **no elevation at all** (`installer/launch.vbs`), and the server therefore cannot touch the firewall itself. So Settings offers a button that elevates through UAC — which puts its dialog on **this machine's** desktop, and is why the endpoint is local-only rather than merely privileged.

The rule is `-Profile Private` and **not** `-RemoteAddress LocalSubnet`. WireGuard clients routed in by the router arrive with a source address from the tunnel's subnet, not the LAN's, so scoping by local subnet would lock out precisely the case this was built for. The profile covers both and still leaves `Public` shut, which is the coffee-shop case.

One caveat on that "covers both", found on the development machine: it holds for a tunnel the *router* routes in, because the traffic then arrives on the LAN adapter. A VPN with **its own adapter** gets its own connection profile, and Windows may well classify that one `Public` — ZeroTier does — in which case a `Private` rule does not cover the tunnel at all. Nothing here tries to fix that: widening the rule to `Public` is the coffee-shop hole this deliberately leaves shut, and which networks are Private is the user's call, not ours.

Reading the rule needs no elevation **through the COM API** — through the cmdlets it does, and silently, which is [its own story](#why-the-rules-are-read-through-com) — so the panel can show its state. It also shows the machine's own addresses, so the URL to type on the other computer does not have to be hunted down. Those are ordered rather than dumped: link-local addresses are dropped and the adapters Windows calls Private come first, because on a machine with two Hyper-V switches and a VPN adapter the raw list began with a `169.254.x` address and that is precisely what the panel used to offer.

**Creating the rule is idempotent** (`ensureRule`): the elevated script removes any rule already carrying our name and then creates one, in a single prompt. It used to only create, which was fine until the read broke — the panel then reported the port shut after every success, so the button went on offering to open it and six identical rules accumulated. Re-creating also repairs a rule whose port or profile is wrong, which "create only if missing" could not. Deleting by `DisplayName` is safe there and nowhere else in that file, because that name is one we chose.

Two things the rule gained when the bind started depending on it:

- **Its name carries the port** unless it is 7433 (`ruleNameFor`). The release keeps the bare `claude-history` it always had, so an older rule keeps working; a `preview.ps1` run on 7435 gets `claude-history (port 7435)`. Sharing one name was harmless while the rule was cosmetic — with the bind gated on it, two instances would read each other's answer and open the wrong port. The evaluation checks the port filter as well, so a rule that does not cover this port is not this rule.
- **It can be overridden by a Block**, and the panel now says so instead of leaving the user with an open port and nothing coming through. `DELETE /api/firewall/blocks` deletes by the rule's instance `Name` — never by `DisplayName`, which Windows sets to the program ("Node.js JavaScript Runtime", or plain "node.exe") and would take out every rule any other Node app on the machine ever earned. On the development machine that is not hypothetical: `node.exe` is also the DisplayName of three other Node installs' rules, Allow rules among them.

  **`INetFwRule` exposes no instance id at all**, so the unelevated COM scan cannot produce one — which turned out to be an improvement. The ids are now found *inside* the elevated script, where `Get-NetFirewallApplicationFilter` answers, and what crosses into it is a **scope** (our own exe, our own install root, both derived from `process.execPath`), never the identity of a rule. Nothing a page said — and nothing even our own read decided — can widen what gets deleted. The count in the response comes from looking again afterwards rather than from trusting a list we handed to nobody, and a scan that *failed* answers 409 instead of `removed: 0`: "could not look" is not "nothing to remove". `$fw.Rules.Remove($name)` is the obvious COM alternative and the forbidden one, because there `Name` **is** the DisplayName.

### "Access is denied" from the UAC step is not always a cancelled UAC

`elevate` used to launch `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand <base64>` through `Start-Process -Verb RunAs`. That command line is also, verbatim, the shape of a well-known attack pattern, and **Microsoft Defender's ML heuristics block it on sight** — observed on a stock Windows 11 26100 with nothing but Defender, as `Trojan:Win32/Commando.A!ml`, severity Severe, three times in a row against a command whose entire payload decoded to `Set-NetConnectionProfile -InterfaceAlias 'Ethernet' -NetworkCategory Private`. Defender does not read the base64; it reads the flags.

When it fires, `Start-Process -Verb RunAs` throws **`An error occurred trying to start process … Access is denied.`** — which is exactly what a cancelled UAC prompt looks like, and the panel's wrapper sentence ("Windows has to approve it on this machine") then points the user at a dialog that never appeared. The real message is carried through underneath, so the evidence is in the log; the diagnosis is `Get-MpThreatDetection`, whose `Resources` field holds the offending command line.

One fact keeps the risk in proportion: every rule this app actually creates or deletes went through untouched in that same session, so the heuristic is not a blanket ban on the pattern — it weighs what the process then does, and reconfiguring the network scored where adding a firewall rule did not.

**So `util/firewall.ts` no longer passes `-ExecutionPolicy Bypass`**, in either the read or the elevate. Execution policy governs script *files*; it has never governed `-Command` or `-EncodedCommand`, so the flag bought nothing there while contributing half the signature. The one way that reasoning could have been wrong is module auto-loading — these scripts do reach `Get-NetConnectionProfile` and `New-NetFirewallRule`, which pull in `NetSecurity` and `NetConnection` — so it was measured rather than argued: forced to `-ExecutionPolicy Restricted`, and again to `AllSigned`, the identical encoded payload still reached the COM API and all three cmdlets. `-EncodedCommand` itself is load-bearing and stays; it is what keeps the nested scripts free of quoting bugs.

**Everywhere else in this repo the flag must stay.** `installer/*.ps1`, `update-helper.ps1`, `core/updates.ts` and `routes/settings.ts` all launch PowerShell with `-File`, and a script file is exactly what execution policy exists to refuse.

## Trying it without publishing a release

`.\preview.ps1` — a third instance, port 7435, `%LOCALAPPDATA%\claude-history-preview`, run **without** `--dev-instance` so it is subject to exactly the gate a release is. It exists because `dev.ps1` structurally cannot test this: a dev instance is loopback-only, so there is no remote request to make.

Being subject to the gate means preview binds loopback too until its own rule exists, which is the point when the gate itself is what is being tested. To exercise the remote path without a rule, pass `--host 0.0.0.0` by hand — the one escape hatch, and the one thing that can still make Windows ask.

It writes its own `userdata.json` on first run with the update poll, the usage reads and the auto-reload switched off — a safety measure rather than a preference, since without `--dev-instance` the plain defaults apply and a usage 429 is earned per **account**, not per instance. `-Seed` copies the release's cache and data so it opens warm.

It is not a managed install, so Update, Uninstall and *Open install folder* stay disabled there — those still need a real release.

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 30 to 36. They can be run without a second machine: connecting to this machine's own LAN address is a remote socket, so the whole path is real. 35 is the one that proves the point of all this — the dialog never appearing — and 36 is the restart.

## What is not proven

If the network profile changes while the server is running (home → coffee shop), the socket is already open and no `listen()` happens, so no new dialog is expected — but that has not been provoked and is not claimed as certain. On a Public network with a Private rule the port simply goes silent, which is the wanted behaviour anyway. Were it ever to turn out otherwise, the answer is to CLOSE the wide socket, and closing never asks anything.

**The single-profile case is now proven, and the dialog does not appear.** On a second machine (Windows 11 26100) in the cleanest possible state for the question — **no firewall rule of any kind naming `node.exe`**, one connected network, `Private`, `NotifyOnListen` true and the effective default inbound action Block — `preview.ps1` was taken through the whole of check 35 on a port rule scoped to `Private`. Binding `0.0.0.0` raised **no Windows Security dialog**, and the check does not rest on somebody having watched the screen: a dialog answered either way writes program-scoped rules, and a COM enumeration immediately after the wide bind still found **zero** rules naming that `node.exe`. A port rule that covers the active profile is enough, and nothing is asked.

That also makes `preview.ps1` usable for this after all — on a machine whose `node.exe` carries no rules. The old note said it could not answer the question; that was true of the development machine's fnm binary specifically, not of the script. **Check the binary before trusting either answer**, with the COM one-liner in check 35.

**Several profiles active at once, with a rule for only one of them, is still open.** The gate asks whether the rule covers *some* active profile (`onThisNetwork` uses `.some`), which is right for the machine it was written on. A machine with extra adapters is on more than one profile simultaneously — the development machine reports `Private` for the Wi-Fi and `Public` for a Hyper-V internal switch and a VPN adapter, all three connected — so the gate permits the wide bind while `Public` has no rule for the port. Whether Windows raises its dialog in *that* state is **not known**: it might evaluate the profiles collectively and ask, or notice the Allow that exists and stay quiet. The machine that settled the single-profile case has one adapter and could not reproduce it.

One more thing is known, and it is why this is written down rather than guessed at. The development machine carries a Block pair for `versions\v1.12.0\node\node.exe`, which is what a cancelled dialog leaves — so the dialog has appeared there before, in an older version, on a `node.exe` no rule covered.

If it ever does appear: answer **Allow, private networks only** — never Cancel. Allow leaves program-scoped rules that expire at the next update and harm nothing, since the port rule is what actually carries the feature; Cancel leaves the Block pair that defeats it, one pair per version, and someone then has to find the *Remove them* button.
