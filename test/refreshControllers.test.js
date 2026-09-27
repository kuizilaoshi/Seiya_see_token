const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createUsageRefreshController } = require('../src/usageRefresh');
const { createQuotaRetryScheduler } = require('../src/quotaRetry');
const { createOfficialFailureSnapshot, createOfficialSnapshot } = require('../src/quotaState');

const createFakeTimers = () => {
  let clock = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => clock,
    setTimer: (callback, delay) => {
      const id = nextId++;
      timers.set(id, { callback, due: clock + delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advance: (milliseconds) => {
      clock += milliseconds;
      const due = Array.from(timers.entries())
        .filter(([, timer]) => timer.due <= clock)
        .sort((left, right) => left[1].due - right[1].due);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.callback();
      }
    },
    pendingCount: () => timers.size
  };
};

async function main() {
  let readCount = 0;
  const resolvers = [];
  const committed = [];
  const forceReads = [];
  const controller = createUsageRefreshController({
    readSnapshot: ({ force }) => {
      readCount += 1;
      forceReads.push(force);
      return new Promise((resolve) => resolvers.push(resolve));
    },
    onSnapshot: (snapshot) => committed.push(snapshot.total?.remainingPercent)
  });

  const first = controller.refresh();
  const queued = controller.refresh({ force: true });
  assert.strictEqual(readCount, 1);
  resolvers.shift()({ hasData: true, total: { remainingPercent: 8 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(readCount, 2);
  resolvers.shift()({ hasData: true, total: { remainingPercent: 7 } });
  const results = await Promise.all([first, queued]);
  assert.strictEqual(results[0].total.remainingPercent, 7);
  assert.strictEqual(results[1].total.remainingPercent, 7);
  assert.deepStrictEqual(committed, [8, 7]);
  assert.deepStrictEqual(forceReads, [false, true]);

  const officialValues = [
    { usedPercent: 4, remainingPercent: 96, timestamp: '2026-08-11T05:12:10.000Z' },
    new Error('account/rateLimits/read timed out'),
    { usedPercent: 7, remainingPercent: 93, timestamp: '2026-08-11T07:00:25.000Z' }
  ];
  const recoveryCommits = [];
  const recoveryController = createUsageRefreshController({
    readSnapshot: ({ previous }) => {
      const next = officialValues.shift();
      if (next instanceof Error) return createOfficialFailureSnapshot(next, previous);
      return createOfficialSnapshot({
        ...next,
        windowMinutes: 10080,
        resetsAt: 1787018265,
        limitId: 'codex',
        planType: 'prolite'
      });
    },
    onSnapshot: (snapshot) => recoveryCommits.push({
      status: snapshot.status,
      remaining: snapshot.total?.remainingPercent
    })
  });
  await recoveryController.refresh();
  await recoveryController.refresh();
  const recoveredSnapshot = await recoveryController.refresh({ force: true });
  assert.deepStrictEqual(recoveryCommits, [
    { status: 'current', remaining: 96 },
    { status: 'stale', remaining: 96 },
    { status: 'current', remaining: 93 }
  ]);
  assert.strictEqual(recoveredSnapshot.total.remainingPercent, 93);

  const fake = createFakeTimers();
  let retries = 0;
  const retry = createQuotaRetryScheduler({
    retry: () => { retries += 1; },
    delaysMs: [5000, 15000],
    setTimer: fake.setTimer,
    clearTimer: fake.clearTimer
  });
  retry.scheduleAfterFailure();
  assert.strictEqual(fake.pendingCount(), 1);
  fake.advance(4999);
  assert.strictEqual(retries, 0);
  fake.advance(1);
  assert.strictEqual(retries, 1);
  retry.scheduleAfterFailure();
  fake.advance(14999);
  assert.strictEqual(retries, 1);
  fake.advance(1);
  assert.strictEqual(retries, 2);
  retry.scheduleAfterFailure();
  assert.strictEqual(fake.pendingCount(), 0);
  retry.restartCycle();
  retry.scheduleAfterFailure();
  assert.strictEqual(fake.pendingCount(), 1);
  retry.cancel();
  assert.strictEqual(fake.pendingCount(), 0);

  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.doesNotMatch(mainSource, /localSnapshot\.hasData/);
  assert.doesNotMatch(mainSource, /source:\s*['"]local-codex-session-logs['"]/);
  assert.match(mainSource, /refreshProjects/);
  assert.match(mainSource, /refreshQuota/);
  assert.match(mainSource, /createWatchRefreshScheduler\(\{\s*refresh:\s*refreshProjects,/);
  assert.doesNotMatch(mainSource, /createWatchRefreshScheduler\(\{\s*refresh:\s*refreshQuota,/);

  console.log('refresh controller tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
