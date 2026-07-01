/**
 * Runs tasks serially PER KEY while letting different keys run in parallel.
 *
 * Used to serialize a single visitor's events (so their messages don't race on
 * the same session/page) while keeping different visitors concurrent. Each key
 * keeps a "tail" promise; a new task chains onto it. A rejected task doesn't
 * break the chain — the next task still runs. Drained keys are dropped so the
 * map doesn't grow unbounded.
 */
export function createSerialQueue<T>(): (key: string, task: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return (key, task) => {
    const prev = tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    tails.set(key, next);
    const cleanup = (): void => {
      if (tails.get(key) === next) tails.delete(key);
    };
    // then(cleanup, cleanup) settles either way without re-propagating a rejection.
    void next.then(cleanup, cleanup);
    return next;
  };
}
