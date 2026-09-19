/**
 * Reading a recorded git invocation.
 *
 * Every command carries the same eleven flags — `--no-pager`,
 * `core.quotepath=false`, the credential lockdown and the rest — because they
 * are not optional and the runner puts them on unconditionally. Shown in full
 * on every row they would bury the subcommand under two lines of boilerplate,
 * which is the opposite of what the panel is for. So a collapsed row starts at
 * the subcommand and opening one shows the argv exactly as it ran.
 *
 * **What is folded away carries no count, and that is the one exception to the
 * panel's rule about saying what it hid.** It said otherwise for a while and
 * returned a number nobody drew. A count is owed where the amount VARIES and
 * the reader cannot infer it — the entries the ring dropped, the output that
 * was truncated, both of which are reported — and this prefix is the same
 * eleven flags on every row of every repository for the life of the process.
 * A `(+11)` on all of them would be noise that says nothing the chevron beside
 * it does not.
 */
function condenseArgv(argv: string[]): string[] {
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    // `-c key=value` is two tokens; every other leading flag is one.
    if (token === '-c') {
      i += 2;
      continue;
    }
    if (token.startsWith('-')) {
      i += 1;
      continue;
    }
    break; // the subcommand
  }
  return argv.slice(i);
}

/** `git status --porcelain=v2 …`, the way a person would type it. */
export function commandLine(argv: string[]): string {
  return `git ${condenseArgv(argv).join(' ')}`;
}

/** The whole thing, ready to paste into a terminal sitting anywhere. */
export function pasteableCommand(argv: string[], cwd: string): string {
  return `cd "${cwd}"; git ${argv.join(' ')}`;
}
