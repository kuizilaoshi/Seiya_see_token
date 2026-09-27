const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

function resolveCodexCliPath(options = {}) {
  const explicit = options.codexCliPath || process.env.CODEX_CLI_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  const configPath = path.join(userProfile, '.codex', 'config.toml');
  try {
    const config = fs.readFileSync(configPath, 'utf8');
    const match = config.match(/^CODEX_CLI_PATH\s*=\s*['"]([^'"]+)['"]/m);
    if (match?.[1] && fs.existsSync(match[1])) return match[1];
  } catch {
    // Continue to the installed CLI fallback.
  }

  const binRoot = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  try {
    const candidates = fs.readdirSync(binRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(binRoot, entry.name, 'codex.exe'))
      .filter((candidate) => fs.existsSync(candidate));
    return candidates.at(-1) || null;
  } catch {
    return null;
  }
}

function selectStandardRateLimit(response) {
  const direct = response?.rateLimitsByLimitId?.codex;
  const legacy = response?.rateLimits?.limitId === 'codex' ? response.rateLimits : null;
  const limit = direct || legacy;
  const primary = limit?.primary;
  const usedPercent = Number(primary?.usedPercent);
  if (limit?.limitId !== 'codex' || !Number.isFinite(usedPercent)) return null;

  return {
    timestamp: new Date().toISOString(),
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    remainingPercent: Math.round(Math.max(0, Math.min(100, 100 - usedPercent))),
    windowMinutes: Number(primary.windowDurationMins || 0),
    resetsAt: Number(primary.resetsAt || 0),
    limitId: 'codex',
    limitName: limit.limitName || null,
    planType: limit.planType || null,
    credits: limit.credits || null
  };
}

function createCodexRateLimitsClient(options = {}) {
  const cliPath = resolveCodexCliPath(options);
  const spawnProcess = options.spawnProcess || spawn;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  let child = null;
  let initialized = null;
  let stdoutBuffer = '';
  let nextId = 1;
  let closed = false;
  const pending = new Map();

  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimer(request.timer);
      request.reject(error);
    }
    pending.clear();
  }

  function stopChild(error = new Error('Codex app-server stopped')) {
    const running = child;
    child = null;
    initialized = null;
    stdoutBuffer = '';
    rejectPending(error);
    if (running && !running.killed) running.kill();
  }

  function handleMessage(message) {
    if (message?.id === undefined || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    clearTimer(request.timer);
    if (message.error) request.reject(new Error(message.error.message || 'Codex app-server request failed'));
    else request.resolve(message.result);
  }

  function sendRequest(method, params = {}) {
    if (!child?.stdin?.writable) return Promise.reject(new Error('Codex app-server is not writable'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimer(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  async function ensureStarted() {
    if (closed) throw new Error('Codex rate-limit client is closed');
    if (!cliPath) throw new Error('Codex CLI was not found');
    if (child && initialized) return initialized;

    child = spawnProcess(cliPath, ['app-server', '--stdio'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const spawnedChild = child;
    spawnedChild.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf8');
      let newline = stdoutBuffer.indexOf('\n');
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line) {
          try { handleMessage(JSON.parse(line)); } catch { /* Ignore non-JSON diagnostics. */ }
        }
        newline = stdoutBuffer.indexOf('\n');
      }
    });
    spawnedChild.stderr.on('data', () => {});
    spawnedChild.on('error', (error) => {
      if (child === spawnedChild) stopChild(error);
    });
    spawnedChild.on('exit', () => {
      if (child === spawnedChild) stopChild(new Error('Codex app-server exited'));
    });

    initialized = sendRequest('initialize', {
      clientInfo: { name: 'codex-usage-widget', title: 'Codex Usage Widget', version: '1.0.0' },
      capabilities: { experimentalApi: true }
    }).then(() => {
      child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
    }).catch((error) => {
      stopChild(error);
      throw error;
    });
    return initialized;
  }

  async function readStandardRateLimit() {
    await ensureStarted();
    try {
      const response = await sendRequest('account/rateLimits/read');
      const selected = selectStandardRateLimit(response);
      if (!selected) throw new Error('Standard Codex rate limit is unavailable');
      stopChild();
      return selected;
    } catch (error) {
      stopChild(error);
      throw error;
    }
  }

  return {
    close: () => {
      closed = true;
      stopChild(new Error('Codex rate-limit client closed'));
    },
    readStandardRateLimit
  };
}

module.exports = {
  DEFAULT_REQUEST_TIMEOUT_MS,
  createCodexRateLimitsClient,
  resolveCodexCliPath,
  selectStandardRateLimit
};
