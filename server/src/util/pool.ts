/**
 * Run `work` over `items`, `limit` at a time, answering in the input's order.
 *
 * It grew up in `gitRepos.ts`, where fifty repositories probed serially is a
 * second of nothing happening; it moved out when a second caller wanted it for
 * the same reason — one `git merge-base` per branch, which on Windows is one
 * process spawn per branch and is where the time actually goes.
 *
 * The results array is indexed rather than pushed, so an answer keeps its
 * item's position however the work interleaves. Nothing here catches: a
 * rejection propagates, and every caller so far hands in work that cannot
 * reject because git's own failures come back as results.
 */
export async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await work(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}
