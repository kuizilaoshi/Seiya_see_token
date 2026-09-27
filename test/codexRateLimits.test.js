const assert = require('assert');
const { EventEmitter } = require('events');
const {
  createCodexRateLimitsClient,
  DEFAULT_REQUEST_TIMEOUT_MS
} = require('../src/codexRateLimits');

const createFakeAppServer = (usedPercent = 7) => {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter();
  child.stdout = stdout;
  child.stderr = stderr;
  child.killed = false;
  child.kill = () => { child.killed = true; };
  child.stdin = {
    writable: true,
    write: (line) => {
      const request = JSON.parse(line);
      if (request.id === undefined) return;
      const result = request.method === 'account/rateLimits/read'
        ? {
            rateLimitsByLimitId: {
              codex: {
                limitId: 'codex',
                planType: 'prolite',
                primary: {
                  usedPercent,
                  windowDurationMins: 10080,
                  resetsAt: 1787018265
                }
              }
            }
          }
        : {};
      queueMicrotask(() => stdout.emit('data', `${JSON.stringify({ id: request.id, result })}\n`));
    }
  };
  return child;
};

async function main() {
  const scheduledDelays = [];
  const client = createCodexRateLimitsClient({
    codexCliPath: process.execPath,
    spawnProcess: () => createFakeAppServer(7),
    setTimer: (_callback, delay) => {
      scheduledDelays.push(delay);
      return Symbol('timer');
    },
    clearTimer: () => {}
  });

  const result = await client.readStandardRateLimit();
  client.close();

  assert.strictEqual(DEFAULT_REQUEST_TIMEOUT_MS, 30000);
  assert.deepStrictEqual(scheduledDelays, [30000, 30000]);
  assert.strictEqual(result.usedPercent, 7);
  assert.strictEqual(result.remainingPercent, 93);

  let spawnCount = 0;
  const changingUsage = [4, 7];
  const freshClient = createCodexRateLimitsClient({
    codexCliPath: process.execPath,
    spawnProcess: () => createFakeAppServer(changingUsage[spawnCount++]),
    setTimer: () => Symbol('timer'),
    clearTimer: () => {}
  });
  const oldSnapshot = await freshClient.readStandardRateLimit();
  const newSnapshot = await freshClient.readStandardRateLimit();
  freshClient.close();
  assert.strictEqual(oldSnapshot.remainingPercent, 96);
  assert.strictEqual(newSnapshot.remainingPercent, 93);
  assert.strictEqual(spawnCount, 2);
  console.log('codexRateLimits tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
