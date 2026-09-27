const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const {
  clearProjectUsageCache,
  readProjectSnapshot
} = require('../src/projectUsageReader');

const writeSession = (file, rows) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf8');
};

const tokenEvent = ({ timestamp, total, used = 69 }) => ({
  timestamp,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      total_token_usage: { total_tokens: total },
      last_token_usage: { total_tokens: total }
    },
    rate_limits: {
      limit_id: 'codex',
      plan_type: 'prolite',
      primary: {
        used_percent: used,
        window_minutes: 10080,
        resets_at: Math.floor(Date.now() / 1000) + 3600
      }
    }
  }
});

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-project-usage-test-'));
  try {
    const sessionsDir = path.join(temp, 'sessions');
    const file = path.join(sessionsDir, '2026', '08', '10', 'rollout.jsonl');
    const now = Date.now();
    writeSession(file, [
      {
        timestamp: new Date(now - 2000).toISOString(),
        type: 'session_meta',
        payload: { id: 'thread-a', cwd: 'D:\\codex\\ProjectA' }
      },
      tokenEvent({ timestamp: new Date(now - 1000).toISOString(), total: 1200 })
    ]);

    clearProjectUsageCache();
    const snapshot = await readProjectSnapshot({
      sessionsDir,
      quotaWindow: {
        windowMinutes: 10080,
        resetsAt: Math.floor((now + 3600 * 1000) / 1000)
      }
    });
    assert.strictEqual(snapshot.projects.length, 1);
    assert.strictEqual(snapshot.projects[0].name, 'ProjectA');
    assert.strictEqual(snapshot.projects[0].tokens, 1200);
    assert.strictEqual(Object.hasOwn(snapshot, 'total'), false);
    assert.strictEqual(Object.hasOwn(snapshot, 'remainingPercent'), false);

    const withoutOfficialWindow = await readProjectSnapshot({ sessionsDir });
    assert.deepStrictEqual(withoutOfficialWindow.projects, []);
    assert.strictEqual(withoutOfficialWindow.scannedFiles > 0, true);

    writeSession(file, [
      {
        timestamp: new Date(now - 2000).toISOString(),
        type: 'session_meta',
        payload: { id: 'thread-a', cwd: 'D:\\codex\\ProjectA' }
      },
      tokenEvent({ timestamp: new Date(now).toISOString(), total: 1600, used: 31 })
    ]);
    const refreshed = await readProjectSnapshot({
      sessionsDir,
      quotaWindow: {
        windowMinutes: 10080,
        resetsAt: Math.floor((now + 3600 * 1000) / 1000)
      }
    });
    assert.strictEqual(refreshed.projects[0].tokens, 1600);
    assert.strictEqual(Object.hasOwn(refreshed, 'total'), false);
  } finally {
    clearProjectUsageCache();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log('projectUsageReader tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
