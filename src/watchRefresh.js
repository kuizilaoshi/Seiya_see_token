function createWatchRefreshScheduler(options = {}) {
  const refresh = options.refresh;
  const debounceMs = options.debounceMs ?? 900;
  const maxWaitMs = options.maxWaitMs ?? 5000;
  const now = options.now || Date.now;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  if (typeof refresh !== 'function') throw new TypeError('refresh must be a function');

  let timer = null;
  let burstStartedAt = null;
  let stopped = false;

  function flush() {
    if (stopped) return;
    timer = null;
    burstStartedAt = null;
    Promise.resolve(refresh()).catch(() => {
      // The shared refresh controller converts failures into unavailable state.
    });
  }

  function schedule() {
    if (stopped) return;
    const current = now();
    if (burstStartedAt === null) burstStartedAt = current;
    const remainingMaxWait = Math.max(0, maxWaitMs - (current - burstStartedAt));
    const delay = Math.min(debounceMs, remainingMaxWait);
    if (timer !== null) clearTimer(timer);
    timer = setTimer(flush, delay);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
    burstStartedAt = null;
  }

  return { schedule, stop, isStopped: () => stopped, hasPending: () => timer !== null };
}

module.exports = { createWatchRefreshScheduler };
