/**
 * Reading a recorded git invocation.
 *
 * Every command carries the same eleven flags — `--no-pager`,
 * `core.quotepath=false`, the credential lockdown and the rest — because they
 * are not optional and the runner puts them on unconditionally. Shown in full
 * on every row they would bury the subcommand under two lines of boilerplate,
 * which is the opposite of what the panel is for. So a collapsed row shows the
 * command from its subcommand onwards and SAYS how many flags it folded away,
 * and expanding shows the argv exactly as it ran. Nothing is ever hidden
 * without a number next to it.
 */
export function condenseArgv(argv: string[]): { shown: string[]; hidden: number } {
  let i = 0;
  let hidden = 0;
  while (i < argv.length) {
    const token = argv[i];
    // `-c key=value` is two tokens; every other leading flag is one.
    if (token === '-c') {
      i += 2;
      hidden += 2;
      continue;
    }
    if (token.startsWith('-')) {
      i += 1;
      hidden += 1;
      continue;
    }
    break; // the subcommand
  }
  return { shown: argv.slice(i), hidden };
}

/** `git status --porcelain=v2 …`, the way a person would type it. */
export function commandLine(argv: string[]): string {
  return `git ${condenseArgv(argv).shown.join(' ')}`;
}

/** The whole thing, ready to paste into a terminal sitting anywhere. */
export function pasteableCommand(argv: string[], cwd: string): string {
  return `cd "${cwd}"; git ${argv.join(' ')}`;
}
