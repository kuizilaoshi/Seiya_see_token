const clampPercent = (value) => Math.max(0, Math.min(100, Number(value)));

const formatReset = (resetsAtSeconds, nowMs = Date.now()) => {
  if (!resetsAtSeconds) return { label: '未知', iso: null, remainingMs: null };
  const resetMs = Number(resetsAtSeconds) * 1000;
  const remainingMs = resetMs - nowMs;
  const iso = new Date(resetMs).toISOString();
  if (remainingMs <= 0) return { label: '等待 Codex 更新', iso, remainingMs };

  const totalMinutes = Math.floor(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    return {
      label: `${Math.floor(hours / 24)}天${hours % 24}小时后`,
      iso,
      remainingMs
    };
  }
  return { label: `${hours}小时${minutes}分钟后`, iso, remainingMs };
};

const windowLabel = (minutes) => {
  const value = Number(minutes || 0);
  if (!value) return '未知窗口';
  if (value < 60) return `${value} 分钟窗口`;
  if (value < 24 * 60) return `${Math.round(value / 60)} 小时窗口`;
  return `${Math.round(value / (24 * 60))} 天窗口`;
};

const projectFields = (projectSnapshot = {}) => ({
  sessionsDir: projectSnapshot.sessionsDir || null,
  scannedFiles: Number(projectSnapshot.scannedFiles || 0),
  projectStats: projectSnapshot.projectStats || null,
  projects: Array.isArray(projectSnapshot.projects) ? projectSnapshot.projects : []
});

const createLoadingSnapshot = (projectSnapshot = {}) => ({
  hasData: false,
  status: 'loading',
  source: null,
  generatedAt: new Date().toISOString(),
  dataUpdatedAt: null,
  warning: '正在获取 Codex 官方用量',
  total: null,
  ...projectFields(projectSnapshot)
});

const createOfficialSnapshot = (official, projectSnapshot = {}) => {
  if (!official || official.limitId !== 'codex') {
    throw new TypeError('A standard Codex rate limit is required');
  }
  const usedPercent = clampPercent(official.usedPercent);
  const remainingPercent = Number.isFinite(Number(official.remainingPercent))
    ? clampPercent(official.remainingPercent)
    : clampPercent(100 - usedPercent);
  const timestamp = official.timestamp || new Date().toISOString();

  return {
    hasData: true,
    status: 'current',
    source: 'codex-app-server',
    generatedAt: new Date().toISOString(),
    dataUpdatedAt: timestamp,
    warning: null,
    selectedLimit: {
      id: official.limitId,
      name: official.limitName || null,
      planType: official.planType || null
    },
    total: {
      usedPercent,
      remainingPercent,
      windowMinutes: Number(official.windowMinutes || 0),
      windowLabel: windowLabel(official.windowMinutes),
      resetsAt: Number(official.resetsAt || 0) || null,
      reset: formatReset(official.resetsAt),
      limitId: official.limitId,
      limitName: official.limitName || null,
      planType: official.planType || null,
      sourceTimestamp: timestamp,
      credits: official.credits || null
    },
    ...projectFields(projectSnapshot)
  };
};

const isOfficialSnapshot = (snapshot) => snapshot?.hasData === true
  && snapshot?.source === 'codex-app-server'
  && snapshot?.total
  && Number.isFinite(Number(snapshot.total.remainingPercent));

const createOfficialFailureSnapshot = (error, previous, projectSnapshot = {}) => {
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  const projects = projectFields(projectSnapshot);
  if (isOfficialSnapshot(previous)) {
    return {
      ...previous,
      ...projects,
      status: 'stale',
      generatedAt: new Date().toISOString(),
      warning: `官方数据暂未更新：${message}`,
      officialError: message,
      isStale: true
    };
  }

  return {
    hasData: false,
    status: 'unavailable',
    source: null,
    generatedAt: new Date().toISOString(),
    dataUpdatedAt: null,
    warning: `官方用量暂时不可用：${message}`,
    officialError: message,
    total: null,
    ...projects
  };
};

const mergeProjectSnapshot = (snapshot, projectSnapshot = {}) => ({
  ...(snapshot || createLoadingSnapshot()),
  ...projectFields(projectSnapshot),
  generatedAt: new Date().toISOString()
});

const quotaWindowFromSnapshot = (snapshot) => {
  if (!isOfficialSnapshot(snapshot)) return null;
  const windowMinutes = Number(snapshot.total.windowMinutes || 0);
  const resetsAt = Number(snapshot.total.resetsAt || 0);
  if (!(windowMinutes > 0) || !(resetsAt > 0)) return null;
  return { windowMinutes, resetsAt };
};

module.exports = {
  createLoadingSnapshot,
  createOfficialFailureSnapshot,
  createOfficialSnapshot,
  formatReset,
  isOfficialSnapshot,
  mergeProjectSnapshot,
  quotaWindowFromSnapshot,
  windowLabel
};
