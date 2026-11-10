/**
 * Reject if `promise` has not settled after `ms`. A request on venue wifi that is
 * "connected but dead" can hang for minutes; the UI needs an answer (error + Retry, or
 * the cached copy) well before that. The underlying request is not cancelled (it may
 * still finish harmlessly); only the wait is bounded.
 *
 * Timers are injected so tests do not need real time.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  makeError: () => Error,
  timers: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (id: unknown) => void;
  } = { setTimeout: (fn, delay) => setTimeout(fn, delay), clearTimeout: (id) => clearTimeout(id as never) },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = timers.setTimeout(() => reject(makeError()), ms);
    promise.then(
      (value) => {
        timers.clearTimeout(id);
        resolve(value);
      },
      (error: unknown) => {
        timers.clearTimeout(id);
        reject(error); // unchanged: callers classify it (SaveError, ApiError, plain objects)
      },
    );
  });
}
