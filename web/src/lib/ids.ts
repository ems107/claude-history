/**
 * An id minted in the browser, for something this app stores under it.
 *
 * **Not `crypto.randomUUID()`.** That one is `[SecureContext]`, so it is
 * `undefined` the moment a page is opened over plain HTTP from anything that is
 * not `localhost` — which is exactly how a phone or another machine reaches
 * this app ([AI_REMOTE_ACCESS.md](../../../docs/AI_REMOTE_ACCESS.md)). Calling
 * it there is a `TypeError` inside an event handler, and a `TypeError` inside
 * an event handler is a button that silently does nothing: the click was
 * swallowed, the form is still on screen, and there is no message anywhere.
 * That is precisely how this was found — a *Comment* button that did not add a
 * comment, reached from a LAN address.
 *
 * The same trap `navigator.clipboard` sets, and the reason `copyPlain` exists.
 * `lib/tabs.ts` and `ProjectsArea`'s `newGroupId` already dodge it with this
 * shape; they keep their own copies because one is a module constant and the
 * other has to avoid colliding inside a list it can see.
 *
 * The id is never shown and never parsed. It only has to be unlike the others,
 * and to hold nothing a URL path would object to.
 */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
