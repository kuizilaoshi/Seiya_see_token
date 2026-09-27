const assert = require('assert');
const {
  createLoadingSnapshot,
  createOfficialFailureSnapshot,
  createOfficialSnapshot,
  mergeProjectSnapshot
} = require('../src/quotaState');
const { selectStandardRateLimit } = require('../src/codexRateLimits');

const projectSnapshot = {
  sessionsDir: 'C:\\Users\\test\\.codex\\sessions',
  scannedFiles: 3,
  projectStats: { checkedFiles: 1 },
  projects: [{ name: 'ProjectA', tokens: 1200 }],
  // A local-log quota must never be trusted by quotaState.
  total: { usedPercent: 69, remainingPercent: 31 },
  source: 'local-codex-session-logs'
};

const official = {
  timestamp: '2026-08-10T08:00:00.000Z',
  usedPercent: 92,
  remainingPercent: 8,
  windowMinutes: 10080,
  resetsAt: 1786838741,
  limitId: 'codex',
  limitName: null,
  planType: 'prolite',
  credits: null
};

function main() {
  const loading = createLoadingSnapshot();
  assert.strictEqual(loading.status, 'loading');
  assert.strictEqual(loading.hasData, false);
  assert.strictEqual(loading.total, null);

  const current = createOfficialSnapshot(official, projectSnapshot);
  assert.strictEqual(current.source, 'codex-app-server');
  assert.strictEqual(current.total.remainingPercent, 8);
  assert.strictEqual(current.total.usedPercent, 92);
  assert.deepStrictEqual(current.projects, projectSnapshot.projects);

  const firstFailure = createOfficialFailureSnapshot(
    new Error('official timeout'),
    projectSnapshot,
    projectSnapshot
  );
  assert.strictEqual(firstFailure.status, 'unavailable');
  assert.strictEqual(firstFailure.hasData, false);
  assert.strictEqual(firstFailure.total, null);
  assert.deepStrictEqual(firstFailure.projects, projectSnapshot.projects);

  const stale = createOfficialFailureSnapshot(new Error('official timeout'), current, projectSnapshot);
  assert.strictEqual(stale.status, 'stale');
  assert.strictEqual(stale.source, 'codex-app-server');
  assert.strictEqual(stale.total.remainingPercent, 8);
  assert.strictEqual(stale.dataUpdatedAt, official.timestamp);

  const recovered = createOfficialSnapshot({
    ...official,
    timestamp: '2026-08-10T08:01:00.000Z',
    usedPercent: 93,
    remainingPercent: 7
  }, projectSnapshot);
  assert.strictEqual(recovered.total.remainingPercent, 7);

  const exhausted = createOfficialSnapshot({
    ...official,
    usedPercent: 100,
    remainingPercent: 0
  }, projectSnapshot);
  assert.strictEqual(exhausted.hasData, true);
  assert.strictEqual(exhausted.total.remainingPercent, 0);
  const staleExhausted = createOfficialFailureSnapshot(
    new Error('official timeout'),
    exhausted,
    projectSnapshot
  );
  assert.strictEqual(staleExhausted.hasData, true);
  assert.strictEqual(staleExhausted.status, 'stale');
  assert.strictEqual(staleExhausted.total.remainingPercent, 0);

  const projectsChanged = mergeProjectSnapshot(current, {
    ...projectSnapshot,
    projects: [{ name: 'ProjectB', tokens: 2000 }]
  });
  assert.strictEqual(projectsChanged.total.remainingPercent, 8);
  assert.strictEqual(projectsChanged.source, 'codex-app-server');
  assert.strictEqual(projectsChanged.projects[0].name, 'ProjectB');

  const selected = selectStandardRateLimit({
    rateLimits: { limitId: 'codex_bengalfox', primary: { usedPercent: 0 } },
    rateLimitsByLimitId: {
      codex_bengalfox: {
        limitId: 'codex_bengalfox',
        limitName: 'GPT-5.3-Codex-Spark',
        primary: { usedPercent: 0 }
      },
      codex: {
        limitId: 'codex',
        planType: 'prolite',
        primary: { usedPercent: 92, windowDurationMins: 10080, resetsAt: 1786838741 }
      }
    }
  });
  assert.strictEqual(selected.limitId, 'codex');
  assert.strictEqual(selected.remainingPercent, 8);

  console.log('quotaState tests passed');
}

main();
