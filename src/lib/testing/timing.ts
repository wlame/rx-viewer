/** The fewest milliseconds `run` took in `times` runs: a cost check that a busy machine slows less. */
export function fastestOf(times: number, run: () => void): number {
  let fastest = Infinity;
  for (let i = 0; i < times; i++) {
    const started = performance.now();
    run();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}
