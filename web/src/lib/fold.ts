/** Case- and diacritic-insensitive folding (mirror of the server's search fold). */
export function foldText(text: string): string {
  let out = '';
  for (const ch of text) {
    out += ch.normalize('NFD').charAt(0).toLowerCase();
  }
  return out;
}
