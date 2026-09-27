const ring = document.getElementById('ringValue');
const remaining = document.getElementById('remaining');
const used = document.getElementById('used');
const windowLabel = document.getElementById('windowLabel');
const resetLabel = document.getElementById('resetLabel');
const projectList = document.getElementById('projectList');
const status = document.getElementById('status');
const closeDialog = document.getElementById('closeDialog');
const pinBtn = document.getElementById('pinBtn');
const refreshBtn = document.getElementById('refreshBtn');
const quotaLabel = document.querySelector('.meter .label');
const circumference = 2 * Math.PI * 50;

let activeRefresh = null;
let lastDisplayRevision = -1;
ring.style.strokeDasharray = `${circumference}`;

function fmtTokens(value) {
  const number = Number(value || 0);
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
  if (number >= 1000) return `${Math.round(number / 1000)}K`;
  return `${Math.round(number)}`;
}

function fmtTime(iso) {
  if (!iso) return '--';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '--';
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function fmtClock(iso) {
  if (!iso) return '--:--:--';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[character]));
}

function setPinState(state) {
  const active = Boolean(state?.alwaysOnTop);
  pinBtn.textContent = active ? '↓' : '↑';
  pinBtn.classList.toggle('active', active);
  pinBtn.title = active ? '取消置顶' : '置顶';
}

function renderProjects(projects = []) {
  if (!projects.length) {
    projectList.innerHTML = '<div class="empty">当前窗口内暂无项目明细</div>';
    return;
  }

  projectList.innerHTML = projects.map((project, index) => `
    <article class="project">
      <div class="project-top">
        <span class="rank">${index + 1}</span>
        <div class="project-title">
          <strong title="${escapeHtml(project.cwd || project.name)}">${escapeHtml(project.name)}</strong>
          <small>${fmtTime(project.latestAt)} · ${project.threadCount || 1} 个任务</small>
        </div>
        <b>${project.percent}%</b>
      </div>
      <div class="bar"><i style="width:${Math.max(4, Math.min(100, project.percent))}%"></i></div>
      <div class="tokens">${fmtTokens(project.tokens)} tokens</div>
    </article>
  `).join('');
}

function render(snapshot) {
  const revision = Number(snapshot?.displayRevision || 0);
  if (revision && revision < lastDisplayRevision) return;
  if (revision) lastDisplayRevision = revision;
  renderProjects(snapshot?.projects || []);
  if (!snapshot?.hasData) {
    quotaLabel.textContent = snapshot?.status === 'loading' ? '正在获取用量' : '额度暂不可用';
    remaining.textContent = '--%';
    used.textContent = '--%';
    windowLabel.textContent = '--';
    resetLabel.textContent = snapshot?.status === 'loading' ? '读取中' : '等待重试';
    ring.style.strokeDashoffset = `${circumference}`;
    status.textContent = snapshot?.warning || '正在获取 Codex 官方用量';
    return;
  }

  const total = snapshot.total;
  const remainingPercent = Math.round(total.remainingPercent);
  const usedPercent = Math.round(total.usedPercent * 10) / 10;
  quotaLabel.textContent = '剩余用量';
  remaining.textContent = `${remainingPercent}%`;
  used.textContent = `${usedPercent}%`;
  windowLabel.textContent = total.windowLabel || '--';
  resetLabel.textContent = total.reset?.label || '--';
  ring.style.strokeDashoffset = `${circumference * (1 - remainingPercent / 100)}`;
  status.textContent = snapshot.status === 'stale'
    ? `官方数据暂未更新 · 上次成功 ${fmtClock(snapshot.dataUpdatedAt)}`
    : `官方数据 ${fmtClock(snapshot.dataUpdatedAt)} · 60 秒自动刷新`;
}

function showCloseDialog() {
  closeDialog.hidden = false;
}

function hideCloseDialog() {
  closeDialog.hidden = true;
}

async function refreshNow() {
  if (activeRefresh) return activeRefresh;
  const originalText = refreshBtn.textContent;
  refreshBtn.disabled = true;
  refreshBtn.classList.add('refreshing');
  refreshBtn.textContent = '…';
  refreshBtn.title = '正在刷新';
  status.textContent = '正在读取 Codex 最新官方额度…';

  const request = window.codexUsage.refresh();
  activeRefresh = request;
  try {
    const snapshot = await request;
    render(snapshot);
    return snapshot;
  } catch (error) {
    status.textContent = `刷新失败：${error?.message || error}`;
    return null;
  } finally {
    if (activeRefresh === request) activeRefresh = null;
    refreshBtn.disabled = false;
    refreshBtn.classList.remove('refreshing');
    refreshBtn.textContent = originalText;
    refreshBtn.title = '刷新';
  }
}

refreshBtn.addEventListener('click', refreshNow);
document.getElementById('closeBtn').addEventListener('click', showCloseDialog);
document.getElementById('minimizeTrayBtn').addEventListener('click', () => {
  hideCloseDialog();
  window.codexUsage.hide();
});
document.getElementById('quitBtn').addEventListener('click', () => window.codexUsage.quit());
document.getElementById('cancelCloseBtn').addEventListener('click', hideCloseDialog);
pinBtn.addEventListener('click', () => window.codexUsage.toggleTop());

window.codexUsage.onUpdate(render);
window.codexUsage.onCloseAsk(showCloseDialog);
window.codexUsage.onWindowState(setPinState);
window.codexUsage.get().then(render);
window.codexUsage.getWindowState().then(setPinState);
