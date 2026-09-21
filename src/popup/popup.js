const SETTINGS_KEY = 'dsbs_settings';
const DEFAULTS = { enabled: true, autoShow: true, extraGroupPattern: '' };

const $ = (sel) => document.querySelector(sel);

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SETTINGS_KEY, (res) => {
      resolve(Object.assign({}, DEFAULTS, (res && res[SETTINGS_KEY]) || {}));
    });
  });
}

function saveSettings(patch) {
  return loadSettings().then((current) => {
    const next = Object.assign({}, current, patch);
    chrome.storage.sync.set({ [SETTINGS_KEY]: next });
    return next;
  });
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}

async function send(type) {
  const tab = await activeTab();
  if (!tab || tab.id === undefined) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { type });
  } catch (e) {
    return null;
  }
}

function setStatus(text, cls) {
  const el = $('#status');
  el.textContent = text;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

function flash(text) {
  const el = $('#saveHint');
  el.textContent = text;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => {
    el.textContent = '';
  }, 1600);
}

async function refreshStatus() {
  const tab = await activeTab();
  const url = (tab && tab.url) || '';
  if (!/^https:\/\/chat\.deepseek\.com\//.test(url)) {
    setStatus('当前不是 chat.deepseek.com 页面，请先打开 DeepSeek 网页版。', 'warn');
    return;
  }
  const res = await send('ping');
  if (!res || !res.ok) {
    setStatus('页面已打开但扩展尚未注入，刷新一次页面即可。', 'warn');
    return;
  }
  if (!res.items) {
    setStatus('扩展已就绪。点击侧边栏的「选择对话」进入多选模式后，面板会自动出现。', 'ok');
  } else {
    setStatus(`已检测到 ${res.items} 条对话处于多选模式，可以直接批量勾选。`, 'ok');
  }
}

async function bind() {
  const settings = await loadSettings();
  $('#enabled').checked = settings.enabled;
  $('#autoShow').checked = settings.autoShow;
  $('#pattern').value = settings.extraGroupPattern || '';

  $('#enabled').addEventListener('change', (e) => {
    saveSettings({ enabled: e.target.checked }).then(refreshStatus);
  });
  $('#autoShow').addEventListener('change', (e) => {
    saveSettings({ autoShow: e.target.checked });
  });
  $('#pattern').addEventListener('change', (e) => {
    const value = e.target.value.trim();
    if (value) {
      try {
        new RegExp(value);
      } catch (err) {
        flash('正则不合法');
        return;
      }
    }
    saveSettings({ extraGroupPattern: value }).then(() => flash('已保存'));
  });

  $('#btn-show').addEventListener('click', async () => {
    const res = await send('show-panel');
    setStatus(res && res.ok ? '面板已显示。' : '无法在当前页面显示面板。', res && res.ok ? 'ok' : 'warn');
  });

  $('#btn-hide').addEventListener('click', async () => {
    await send('hide-panel');
    setStatus('面板已隐藏。', '');
  });

  $('#btn-all').addEventListener('click', async () => {
    const res = await send('select-all');
    if (res && res.ok && res.result && res.result.ok) {
      setStatus(`已勾选 ${res.result.selected} / ${res.result.total} 条对话。`, 'ok');
    } else {
      setStatus('全选失败：未检测到对话列表，或正在处理中。', 'warn');
    }
  });

  $('#btn-none').addEventListener('click', async () => {
    const res = await send('select-none');
    if (res && res.ok && res.result && res.result.ok) {
      setStatus(`已取消选择，剩余 ${res.result.selected} 条。`, 'ok');
    } else {
      setStatus('取消失败：未检测到对话列表，或正在处理中。', 'warn');
    }
  });

  refreshStatus();
}

bind();
