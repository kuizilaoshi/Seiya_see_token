const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const TAIL_BLOCK_BYTES = 256 * 1024;
const CACHE_TAIL_BYTES = 32 * 1024;
const PROJECT_HEAD_BYTES = 128 * 1024;
const projectFileCache = new Map();

const getDefaultSessionsDir = () => path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.codex',
  'sessions'
);

const toDateMs = (value) => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

const readTailSignature = (filePath, size) => {
  if (!size) return 'empty';
  const length = Math.min(CACHE_TAIL_BYTES, size);
  const buffer = Buffer.allocUnsafe(length);
  let handle;
  try {
    handle = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(handle, buffer, 0, length, size - length);
    return crypto.createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
  } catch {
    return null;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
};

const listJsonlFiles = (root, cutoffMs = 0) => {
  if (!root || !fs.existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      try {
        const stat = fs.statSync(fullPath, { bigint: true });
        const size = Number(stat.size);
        const mtimeMs = Number(stat.mtimeNs / 1000000n);
        if (cutoffMs && mtimeMs < cutoffMs) continue;
        files.push({
          file: fullPath,
          size,
          mtimeMs,
          mtimeNs: stat.mtimeNs.toString(),
          ctimeNs: stat.ctimeNs.toString(),
          tailSignature: readTailSignature(fullPath, size)
        });
      } catch {
        // A session can disappear while Codex archives it; the next scan retries.
      }
    }
  }
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs);
};

const projectNameFromCwd = (cwd) => {
  if (!cwd) return '未识别项目';
  const normalized = cwd.replace(/[\\/]+$/, '');
  return path.basename(normalized) || normalized;
};

const projectCacheMatches = (cached, item) => cached
  && cached.size === item.size
  && cached.mtimeNs === item.mtimeNs
  && cached.ctimeNs === item.ctimeNs
  && item.tailSignature !== null
  && cached.tailSignature === item.tailSignature;

const readProjectFileSummary = async (item) => {
  const handle = await fs.promises.open(item.file, 'r');
  let bytesReadTotal = 0;
  try {
    const headLength = Math.min(PROJECT_HEAD_BYTES, item.size);
    const head = Buffer.allocUnsafe(headLength);
    if (headLength) {
      const { bytesRead } = await handle.read(head, 0, headLength, 0);
      bytesReadTotal += bytesRead;
    }

    let cwd = '';
    let threadId = '';
    for (const line of head.toString('utf8').split(/\r?\n/)) {
      if (!line.includes('"type":"session_meta"')) continue;
      try {
        const record = JSON.parse(line);
        const payload = record.payload || {};
        cwd = payload.cwd || cwd;
        threadId = payload.id || payload.session_id || threadId;
        break;
      } catch {
        // Large files can end the head block in the middle of a JSON line.
      }
    }

    let position = item.size;
    let carry = Buffer.alloc(0);
    let latestToken = null;
    while (position > 0 && !latestToken) {
      const length = Math.min(TAIL_BLOCK_BYTES, position);
      position -= length;
      const block = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(block, 0, length, position);
      bytesReadTotal += bytesRead;
      const bytes = block.subarray(0, bytesRead);
      const combined = carry.length ? Buffer.concat([bytes, carry]) : bytes;
      const lines = combined.toString('utf8').split(/\r?\n/);
      for (let index = lines.length - 1; index >= 1; index -= 1) {
        const line = lines[index];
        if (!line.includes('"type":"token_count"')) continue;
        try {
          const record = JSON.parse(line);
          const payload = record.payload || {};
          const totalTokens = Number(payload.info?.total_token_usage?.total_tokens || 0);
          const latestTs = toDateMs(record.timestamp);
          if (payload.type === 'token_count' && totalTokens > 0 && latestTs) {
            latestToken = { totalTokens, latestTs };
            break;
          }
        } catch {
          // Continue backwards past malformed or partially written records.
        }
      }
      carry = Buffer.from(lines[0] || '', 'utf8');
    }

    if (!latestToken && carry.length) {
      try {
        const record = JSON.parse(carry.toString('utf8'));
        const payload = record.payload || {};
        const totalTokens = Number(payload.info?.total_token_usage?.total_tokens || 0);
        const latestTs = toDateMs(record.timestamp);
        if (payload.type === 'token_count' && totalTokens > 0 && latestTs) {
          latestToken = { totalTokens, latestTs };
        }
      } catch {
        // No usable token record exists in the remaining partial block.
      }
    }

    return {
      cwd,
      threadId,
      totalTokens: latestToken?.totalTokens || 0,
      latestTs: latestToken?.latestTs || 0,
      bytesRead: bytesReadTotal
    };
  } finally {
    await handle.close();
  }
};

const readProjectUsage = async (files, quotaWindow) => {
  if (!quotaWindow || !files.length) return [];
  const resetMs = Number(quotaWindow.resetsAt || 0) * 1000;
  const windowMs = Number(quotaWindow.windowMinutes || 0) * 60000;
  if (!(resetMs > 0) || !(windowMs > 0)) return [];

  const windowStartMs = resetMs - windowMs;
  const projects = new Map();
  const activeFiles = new Set(files.map((item) => item.file));
  const stats = { checkedFiles: 0, parsedFiles: 0, reusedFiles: 0, bytesRead: 0 };

  for (const item of files) {
    if (item.mtimeMs + 5000 < windowStartMs) continue;
    stats.checkedFiles += 1;
    const cached = projectFileCache.get(item.file);
    let summary = cached?.summary || null;
    try {
      if (!projectCacheMatches(cached, item)) {
        summary = await readProjectFileSummary(item);
        projectFileCache.set(item.file, {
          size: item.size,
          mtimeNs: item.mtimeNs,
          ctimeNs: item.ctimeNs,
          tailSignature: item.tailSignature,
          summary
        });
        stats.parsedFiles += 1;
        stats.bytesRead += summary.bytesRead || 0;
      } else {
        stats.reusedFiles += 1;
      }
    } catch {
      projectFileCache.delete(item.file);
      continue;
    }

    if (!summary?.totalTokens || summary.latestTs < windowStartMs) continue;
    const key = summary.cwd || item.file;
    const project = projects.get(key) || {
      name: projectNameFromCwd(summary.cwd),
      cwd: summary.cwd,
      tokens: 0,
      latestTs: 0,
      threads: new Set()
    };
    project.tokens += summary.totalTokens;
    project.latestTs = Math.max(project.latestTs, summary.latestTs);
    if (summary.threadId) project.threads.add(summary.threadId);
    projects.set(key, project);
  }

  for (const cachedFile of projectFileCache.keys()) {
    if (!activeFiles.has(cachedFile)) projectFileCache.delete(cachedFile);
  }

  const totalTokens = Array.from(projects.values())
    .reduce((sum, project) => sum + project.tokens, 0);
  const result = Array.from(projects.values())
    .map((project) => ({
      name: project.name,
      cwd: project.cwd,
      tokens: Math.round(project.tokens),
      percent: totalTokens ? Math.round((project.tokens / totalTokens) * 1000) / 10 : 0,
      latestAt: project.latestTs ? new Date(project.latestTs).toISOString() : null,
      threadCount: project.threads.size
    }))
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, 8);
  Object.defineProperty(result, 'stats', { value: stats, enumerable: false });
  return result;
};

const readProjectSnapshot = async (options = {}) => {
  const sessionsDir = options.sessionsDir
    || process.env.CODEX_USAGE_SESSIONS_DIR
    || getDefaultSessionsDir();
  const cutoffMs = Date.now() - Number(options.lookbackDays || 10) * DAY_MS;
  let files = listJsonlFiles(sessionsDir, cutoffMs);
  if (!files.length && options.allowFullScan !== false) files = listJsonlFiles(sessionsDir);
  const projects = options.quotaWindow
    ? await readProjectUsage(files, options.quotaWindow)
    : [];
  return {
    sessionsDir,
    scannedFiles: files.length,
    projectStats: options.quotaWindow ? projects.stats : null,
    projects
  };
};

const clearProjectUsageCache = () => projectFileCache.clear();

module.exports = {
  clearProjectUsageCache,
  getDefaultSessionsDir,
  listJsonlFiles,
  readProjectSnapshot,
  readProjectUsage
};
