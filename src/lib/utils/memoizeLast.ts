/**
 * `compute` for one caller, keeping its last answer: a call whose
 * arguments are each the same value as at the last call (`===`) gives
 * that answer again without working it out.
 *
 * Svelte 4 counts an object prop as changed at every update, so a
 * component that works a value out of one does that work at each update
 * of the prop: an index task's progress, the anchor line after a scroll.
 * With this, the work runs only for updates that change its inputs, and
 * an unchanged answer is the same object.
 */
export function memoizeLast<Args extends readonly unknown[], Result>(
  compute: (...args: Args) => Result,
): (...args: Args) => Result {
  let last: { args: Args; result: Result } | null = null;
  return (...args: Args): Result => {
    if (last !== null && isSameArguments(last.args, args)) return last.result;
    const result = compute(...args);
    last = { args, result };
    return result;
  };
}

function isSameArguments(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
