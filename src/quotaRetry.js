const createQuotaRetryScheduler = (options = {}) => {
  const retry = options.retry;
  const delaysMs = options.delaysMs || [5000, 15000];
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  if (typeof retry !== 'function') throw new TypeError('retry must be a function');

  let timer = null;
  let delayIndex = 0;
  let stopped = false;

  const cancelPending = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const scheduleAfterFailure = () => {
    if (stopped || timer !== null || delayIndex >= delaysMs.length) return false;
    const delay = delaysMs[delayIndex];
    delayIndex += 1;
    timer = setTimer(() => {
      timer = null;
      Promise.resolve(retry()).catch(() => {
        // The quota controller converts request failures into explicit UI state.
      });
    }, delay);
    return true;
  };

  const restartCycle = () => {
    stopped = false;
    cancelPending();
    delayIndex = 0;
  };

  const markSuccess = () => {
    cancelPending();
    delayIndex = 0;
  };

  const stop = () => {
    stopped = true;
    cancelPending();
  };

  return {
    cancel: cancelPending,
    hasPending: () => timer !== null,
    markSuccess,
    restartCycle,
    scheduleAfterFailure,
    stop
  };
};

module.exports = { createQuotaRetryScheduler };
