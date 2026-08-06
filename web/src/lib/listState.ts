// Remembers the list page state (filters/search in the URL + scroll offset)
// across navigation into a session and back.

const KEY_PARAMS = 'ch:listParams';
const KEY_SCROLL = 'ch:listScroll';

export function saveListParams(search: string): void {
  sessionStorage.setItem(KEY_PARAMS, search);
}

export function listUrl(): string {
  const params = sessionStorage.getItem(KEY_PARAMS);
  return params ? `/?${params}` : '/';
}

export function saveListScroll(top: number): void {
  sessionStorage.setItem(KEY_SCROLL, String(Math.round(top)));
}

export function savedListScroll(): number {
  return Number(sessionStorage.getItem(KEY_SCROLL) ?? 0);
}
