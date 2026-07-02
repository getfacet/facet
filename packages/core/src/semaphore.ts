/**
 * Caps how many tasks run at once, admitting waiters in FIFO order.
 *
 * Used to bound cross-visitor concurrency (e.g. in the bridge) without
 * reordering any single visitor's serialized work. Up to `limit` tasks run
 * concurrently; the rest queue and start in the order they were submitted. A
 * task's slot is freed when it settles — resolve OR reject, even a synchronous
 * throw — so a crashing task frees its slot and never wedges the queue.
 * Complements `createSerialQueue`: that orders one key's tasks, this caps the
 * total in flight.
 *
 * `active` counts slots that are taken, including one reserved for a waiter that
 * has been woken but not yet started. When a task settles with a waiter queued,
 * the slot is HANDED OFF (`active` unchanged) rather than freed and re-taken —
 * so no task submitted in the wake gap can queue-jump or push concurrency past
 * `limit`. The invariant `active <= limit` holds at every microtask boundary.
 */
export function createSemaphore(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`createSemaphore: limit must be an integer >= 1, got ${limit}`);
  }
  let active = 0;
  const waiters: Array<() => void> = [];

  // A running task settled: hand its slot to the next waiter if one is queued
  // (slot transfers, `active` unchanged), else free the slot.
  const release = (): void => {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  };

  // Runs `task` in a slot already accounted in `active`; frees or hands off that
  // slot when the task settles. A synchronous throw is turned into a rejection
  // (and releases the slot) so it never escapes this Promise-typed path.
  const run = <T>(task: () => Promise<T>): Promise<T> => {
    let started: Promise<T>;
    try {
      started = task();
    } catch (err) {
      release();
      return Promise.reject(err);
    }
    return started.then(
      (value) => {
        release();
        return value;
      },
      (err: unknown) => {
        release();
        throw err;
      },
    );
  };

  return <T>(task: () => Promise<T>): Promise<T> => {
    // Only take a fresh slot when nothing is queued ahead of us; otherwise a
    // submission in a release→wake gap would jump the FIFO queue.
    if (waiters.length === 0 && active < limit) {
      active += 1;
      return run(task);
    }
    // Queue: our slot arrives via `release()` handing it off, so `run` must not
    // re-take one (it does not — the slot is already accounted in `active`).
    return new Promise<void>((resolve) => waiters.push(resolve)).then(() => run(task));
  };
}
