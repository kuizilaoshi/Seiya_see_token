function createUsageRefreshController(options = {}) {
  const readSnapshot = options.readSnapshot;
  const onSnapshot = options.onSnapshot || (() => {});
  const onError = options.onError || ((error) => { throw error; });
  if (typeof readSnapshot !== 'function') throw new TypeError('readSnapshot must be a function');

  let latestSnapshot = null;
  let inFlight = null;
  let refreshQueued = false;
  let forceQueued = false;
  let revision = 0;

  async function runLoop() {
    do {
      const force = forceQueued;
      refreshQueued = false;
      forceQueued = false;
      let snapshot;
      try {
        snapshot = await readSnapshot({ force, previous: latestSnapshot });
      } catch (error) {
        snapshot = await onError(error, { force, previous: latestSnapshot });
      }
      revision += 1;
      latestSnapshot = { ...snapshot, refreshRevision: revision };
      await onSnapshot(latestSnapshot, { force, revision });
    } while (refreshQueued);
    return latestSnapshot;
  }

  function refresh(request = {}) {
    refreshQueued = true;
    if (request.force) forceQueued = true;
    if (!inFlight) {
      inFlight = runLoop().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  return {
    refresh,
    getLatest: () => latestSnapshot,
    getRevision: () => revision,
    isRefreshing: () => Boolean(inFlight)
  };
}

module.exports = { createUsageRefreshController };
