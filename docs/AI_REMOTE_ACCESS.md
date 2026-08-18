# Remote access

**Load this when:** you touch the bind address, authentication, the local/remote split, or any button that acts on the machine the server runs on.

## Invariants

- **A release binds `0.0.0.0`; a dev instance binds `127.0.0.1`.** The wide bind and the session check are ONE feature — never widen one without the other.
- **Local means the socket, never a header.** `isLocalRequest` reads `request.socket.remoteAddress`; `X-Forwarded-For` and `Host` are written by the caller and are ignored on purpose. **This app must not be put behind a reverse proxy** — every request would arrive from loopback and the authentication would vanish silently.
- **A local request never authenticates.** No password, no cookie, exactly as before this existed.
- **A remote request gets nothing until it signs in** — not the session list, not the version, not the paths. Only `/api/auth/*` and the static bundle answer first.
- **Credentials can only be SET locally**, and setting them never asks for the old one.
- **The switch cannot be on without credentials** (clamped in `setSettings`, not just hidden in the UI).
- **Anything that opens a window on the server's desktop answers 409 when remote.** Silent success is the failure mode this prevents.

## The trust model

One line runs through all of it: **being at the machine is the root of trust.** Whoever is sitting there can already open a terminal and run anything, so a password would protect nothing and would lock the owner out of their own tool the day they forgot it. Everything below follows from that.

| | Local (`127.0.0.0/8`, `::1`) | Remote |
| --- | --- | --- |
| Reading, searching, the composer | yes, no password | yes, after signing in |
| Setting the username and password | yes, and no old password is asked for | **no** — 409 |
| Explorer / VS Code / terminal / firewall | yes | **no** — 409 |
| Stopping the server, uninstalling | yes | **no** — 409 |
| Applying an update | yes | **yes**, with a confirmation |

Applying an update is the one restart allowed from another machine: it puts itself back. Stopping does not, so it is refused — a stop from a phone ends the connection and leaves nothing that can start it again.

**What a signed-in session can do is everything.** The composer runs Claude in the project's directory with tools auto-approved, and `routes/files.ts` reads any path a transcript names ([Architecture](AI_ARCHITECTURE.md#security-and-containment)). That is the intended design — the whole point is full access — but it is why the password is the only thing between the LAN and this machine, and why the switch is off by default.

## Why the bind is always wide

A release listens on every interface even with `remoteAccessEnabled` off. That looks backwards and is not:

- A refused **connection** is a browser error page. A refused **request** is a page that can say "remote access is off, and here is where to turn it on" — which is the only useful thing to tell someone who just typed the address on their laptop.
- The switch then costs nothing to flip: no re-listen, no restart, no socket to rebuild while requests are in flight.

The port answering "off" to the whole network leaks nothing: `GET /api/auth/status` is four booleans, and every other route is refused before it runs.

## The pieces

| File | What it owns |
| --- | --- |
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

### The reason text has one home

A local-only button is greyed out with a tooltip, and the endpoint behind it answers 409 with the **same sentence** — both read `LOCAL_ONLY_ACTIONS` from `shared/`. The button is the explanation; the 409 is the guarantee. Neither is optional: a handler that forgets the check answers `{ok: true}` and opens a window nobody is looking at.

## HTTP, and the one thing it breaks

There is no HTTPS: this is a personal tool on a home LAN or inside a WireGuard tunnel, and certificates for an IP address cost more than they buy here. The password does cross the LAN in clear, which is the accepted trade and the reason this is not for any other kind of network.

**`navigator.clipboard` is `[SecureContext]`, and a secure context is HTTPS or localhost — nothing else.** Served from `http://192.168.x.x` the object is `undefined`, not merely restricted, so every copy button throws a `TypeError`. `web/src/lib/clipboard.ts` falls back to the `copy` event plus `execCommand`, which is deprecated but not gated, and **keeps the HTML+text pair** so copying with formatting still pastes into Word and Jira. Nothing in this app reads the clipboard; that half of the API is what got the whole namespace put behind secure contexts.

Everything else survives plain HTTP: `localStorage`, SSE (`/api/events` has a 25 s heartbeat, which is also what keeps a NAT from dropping the connection), images, and the `.md` export, whose attachments are data URIs and need no path on the viewer's machine.

## The firewall rule

Windows blocks the port inbound by default, the install is per user with **no elevation at all** (`installer/launch.vbs`), and the server therefore cannot touch the firewall itself. So Settings offers a button that elevates through UAC — which puts its dialog on **this machine's** desktop, and is why the endpoint is local-only rather than merely privileged.

The rule is `-Profile Private` and **not** `-RemoteAddress LocalSubnet`. WireGuard clients routed in by the router arrive with a source address from the tunnel's subnet, not the LAN's, so scoping by local subnet would lock out precisely the case this was built for. The profile covers both and still leaves `Public` shut, which is the coffee-shop case.

Reading the rule needs no elevation, so the panel can show its state; it also shows the machine's own addresses, so the URL to type on the other computer does not have to be hunted down.

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 30 to 34. They can be run without a second machine: connecting to this machine's own LAN address is a remote socket, so the whole path is real.
