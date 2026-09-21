/**
 * DeepSeek 对话批量选择助手 —— 浮层面板（Shadow DOM 隔离样式）
 */
(function () {
  'use strict';

  const DSBS = (window.DSBS = window.DSBS || {});

  const HOST_ID = 'dsbs-panel-host';
  const STORE_KEY = 'dsbs_ui_state';

  const STYLE = [
    ':host { all: initial; position: fixed; z-index: 2147483600; }',
    '* { box-sizing: border-box; }',
    '.p { width: 268px; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;',
    '  color: #1b1c1f; background: #fff; border: 1px solid rgba(0,0,0,.08); border-radius: 14px;',
    '  box-shadow: 0 12px 32px rgba(0,0,0,.16); overflow: hidden; user-select: none; }',
    '.p.collapsed .body { display: none; }',
    '.head { display: flex; align-items: center; gap: 6px; padding: 9px 10px; cursor: move;',
    '  background: linear-gradient(135deg,#4d6bfe,#7a5cff); color: #fff; }',
    '.dot { width: 7px; height: 7px; border-radius: 50%; background: #b9ffdc; box-shadow: 0 0 0 3px rgba(255,255,255,.25); }',
    '.title { flex: 1; font-weight: 600; font-size: 13px; letter-spacing: .3px; }',
    'button { font: inherit; border: 0; background: none; cursor: pointer; color: inherit; }',
    '.ico { width: 22px; height: 22px; border-radius: 6px; line-height: 20px; font-size: 14px; opacity: .85; }',
    '.ico:hover { background: rgba(255,255,255,.22); opacity: 1; }',
    '.body { padding: 10px; }',
    '.row { display: flex; gap: 6px; }',
    '.btn { flex: 1; padding: 7px 0; border-radius: 8px; background: #f2f3f5; font-size: 12.5px;',
    '  border: 1px solid transparent; transition: .15s; }',
    '.btn:hover { background: #e6e8ee; }',
    '.btn.primary { background: #4d6bfe; color: #fff; }',
    '.btn.primary:hover { background: #3f5bf0; }',
    '.sep { display: flex; align-items: center; justify-content: space-between; margin: 11px 2px 6px;',
    '  font-size: 11.5px; color: #8b8f99; }',
    '.mini { font-size: 11.5px; color: #4d6bfe; padding: 1px 6px; border-radius: 5px; }',
    '.mini:hover { background: #eef1ff; }',
    '.groups { max-height: 216px; overflow-y: auto; margin: 0 -2px; padding: 0 2px; }',
    '.g { display: flex; align-items: center; gap: 8px; padding: 5px 7px; border-radius: 8px; cursor: pointer; }',
    '.g:hover { background: #f5f6f8; }',
    '.g input { width: 15px; height: 15px; accent-color: #4d6bfe; cursor: pointer; margin: 0; }',
    '.gl { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.gc { font-size: 11.5px; color: #9aa0aa; }',
    '.empty { padding: 10px 6px; font-size: 12px; color: #9aa0aa; line-height: 1.7; }',
    '.status { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,.06);',
    '  font-size: 11.5px; color: #6b7280; display: flex; justify-content: space-between; }',
    '.status b { color: #4d6bfe; font-weight: 600; }',
    '@media (prefers-color-scheme: dark) {',
    '  .p { background: #23252b; color: #e6e8ee; border-color: rgba(255,255,255,.1); }',
    '  .btn { background: #32343c; } .btn:hover { background: #3c3f49; }',
    '  .btn.primary { background: #4d6bfe; }',
    '  .g:hover { background: #2c2e36; }',
    '  .status { border-color: rgba(255,255,255,.08); color: #9aa0aa; }',
    '}'
  ].join('\n');

  const HTML = [
    '<div class="p">',
    '  <div class="head">',
    '    <span class="dot"></span>',
    '    <span class="title">对话批量选择</span>',
    '    <button class="ico" data-act="collapse" title="收起">–</button>',
    '    <button class="ico" data-act="hide" title="隐藏面板">×</button>',
    '  </div>',
    '  <div class="body">',
    '    <div class="row">',
    '      <button class="btn primary" data-act="all">全选</button>',
    '      <button class="btn" data-act="none">全不选</button>',
    '      <button class="btn" data-act="invert">反选</button>',
    '    </div>',
    '    <div class="sep"><span>按日期选择</span><button class="mini" data-act="refresh">刷新</button></div>',
    '    <div class="groups"></div>',
    '    <div class="status"><span data-role="count">—</span><span data-role="hint"></span></div>',
    '  </div>',
    '</div>'
  ].join('\n');

  let host = null;
  let root = null;
  let els = {};
  let panelEl = null;
  let activeGroups = new Set();
  let lastGroupSignature = '';
  let forced = false;
  let userHidden = false;
  let running = false;
  /** 全量扫描得到的完整日期分组（可能包含当前未渲染的旧对话） */
  let knownGroups = [];
  let autoScanned = false;
  let scanning = false;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------ 创建 ------------------------------ */

  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;left:auto;top:auto;z-index:2147483600;display:none;';
    root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);

    const wrap = document.createElement('div');
    wrap.innerHTML = HTML;
    root.appendChild(wrap);

    panelEl = root.querySelector('.p');
    els = {
      groups: root.querySelector('.groups'),
      count: root.querySelector('[data-role="count"]'),
      hint: root.querySelector('[data-role="hint"]'),
      head: root.querySelector('.head')
    };

    (document.body || document.documentElement).appendChild(host);

    root.addEventListener('click', function (e) {
      const btn = e.target.closest && e.target.closest('[data-act]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      handleAction(btn.getAttribute('data-act'));
    });

    bindDrag();
    loadUiState();
  }

  function bindDrag() {
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let dragging = false;

    els.head.addEventListener('pointerdown', function (e) {
      if (e.target.closest('[data-act]')) return;
      dragging = true;
      const rect = host.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      originLeft = rect.left;
      originTop = rect.top;
      host.style.left = originLeft + 'px';
      host.style.top = originTop + 'px';
      host.style.right = 'auto';
      host.style.bottom = 'auto';
      try {
        els.head.setPointerCapture(e.pointerId);
      } catch (err) {}
      e.preventDefault();
    });

    els.head.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      const left = Math.min(Math.max(0, originLeft + e.clientX - startX), window.innerWidth - 60);
      const top = Math.min(Math.max(0, originTop + e.clientY - startY), window.innerHeight - 40);
      host.style.left = left + 'px';
      host.style.top = top + 'px';
    });

    const stop = function () {
      if (!dragging) return;
      dragging = false;
      saveUiState();
    };
    els.head.addEventListener('pointerup', stop);
    els.head.addEventListener('pointercancel', stop);
  }

  /* ------------------------------ 状态 ------------------------------ */

  function saveUiState() {
    if (!host) return;
    const payload = {
      position:
        host.style.left && host.style.left !== 'auto' ? { left: host.style.left, top: host.style.top } : null,
      collapsed: panelEl.classList.contains('collapsed')
    };
    try {
      chrome.storage.local.set({ [STORE_KEY]: payload });
    } catch (e) {}
  }

  function loadUiState() {
    try {
      chrome.storage.local.get(STORE_KEY, function (res) {
        const state = res && res[STORE_KEY];
        if (!state) return;
        if (state.position) {
          host.style.left = state.position.left;
          host.style.top = state.position.top;
          host.style.right = 'auto';
          host.style.bottom = 'auto';
        }
        if (state.collapsed) panelEl.classList.add('collapsed');
      });
    } catch (e) {}
  }

  /* ---------------------------- 分组渲染 ---------------------------- */

  function collectGroups() {
    // 已经全量扫描过：直接使用完整结果（含未渲染的旧对话分组）
    if (knownGroups.length) {
      let total = 0;
      for (let i = 0; i < knownGroups.length; i++) total += knownGroups[i].count;
      return { groups: knownGroups, ungrouped: 0, total: total };
    }
    const snapshot = DSBS.getItems();
    const map = new Map();
    let ungrouped = 0;
    for (let i = 0; i < snapshot.items.length; i++) {
      const label = DSBS.getGroup(snapshot.items[i]);
      if (!label) {
        ungrouped++;
        continue;
      }
      map.set(label, (map.get(label) || 0) + 1);
    }
    const groups = [];
    map.forEach(function (count, label) {
      groups.push({ label: label, count: count });
    });
    return { groups: groups, ungrouped: ungrouped, total: snapshot.items.length };
  }

  function renderGroups() {
    const info = collectGroups();
    const signature = info.groups.map(function (g) { return g.label + ':' + g.count; }).join('|');

    if (signature === lastGroupSignature && els.groups.childElementCount) {
      // 结构没变，只同步勾选态，避免频繁重绘导致闪烁
      const inputs = els.groups.querySelectorAll('input[data-group]');
      for (let i = 0; i < inputs.length; i++) {
        inputs[i].checked = activeGroups.has(inputs[i].getAttribute('data-group'));
      }
      return info;
    }
    lastGroupSignature = signature;

    els.groups.textContent = '';
    if (!info.groups.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '未识别到日期分组。可点击「刷新」，或在扩展弹窗里配置自定义分组规则。';
      els.groups.appendChild(empty);
      return info;
    }

    info.groups.forEach(function (g) {
      const row = document.createElement('label');
      row.className = 'g';
      row.innerHTML =
        '<input type="checkbox"><span class="gl">' +
        escapeHtml(g.label) +
        '</span><span class="gc">' +
        g.count +
        '</span>';
      const input = row.querySelector('input');
      input.setAttribute('data-group', g.label);
      input.checked = activeGroups.has(g.label);
      input.addEventListener('change', function () {
        onGroupToggle(g.label, input.checked);
      });
      els.groups.appendChild(row);
    });
    return info;
  }

  /* ---------------------------- 状态显示 ---------------------------- */

  function setStatus(text, hint) {
    if (els.count) els.count.textContent = text;
    if (els.hint) els.hint.textContent = hint || '';
  }

  function updateQuickStatus() {
    const snapshot = DSBS.getItems();
    let selected = 0;
    let known = 0;
    for (let i = 0; i < snapshot.items.length; i++) {
      const state = DSBS.getCheckedState(snapshot.items[i]);
      if (state === true) selected++;
      if (state !== null) known++;
    }
    const suffix = known === 0 && snapshot.items.length ? '（状态未知）' : '';
    setStatus('已选 ' + selected + ' / 可见 ' + snapshot.items.length + suffix, '');
  }

  function report(result) {
    if (!result) {
      setStatus('操作失败', '');
      return;
    }
    if (result.ok === false) {
      const reason = result.reason;
      setStatus(reason === 'empty' ? '未检测到对话列表' : reason === 'busy' ? '正在处理中…' : '无法判断勾选状态', '');
      return;
    }
    setStatus('已选 ' + result.selected + ' / 共 ' + result.total, '');
  }

  /* ------------------------------ 动作 ------------------------------ */

  async function run(fn) {
    if (running) return null;
    running = true;
    setStatus('处理中…', '');
    let result = null;
    try {
      result = await fn();
      report(result);
    } catch (e) {
      setStatus('出错了：' + (e && e.message), '');
    } finally {
      running = false;
    }
    return result;
  }

  /** 全量扫描一遍列表，把完整的日期分组（含未渲染的旧对话）列出来 */
  async function deepRefresh() {
    if (scanning || running || DSBS.isBusy()) return;
    scanning = true;
    setStatus('正在扫描全部对话…', '');
    try {
      const res = await DSBS.scanGroups();
      if (res && res.ok) {
        knownGroups = res.groups || [];
        lastGroupSignature = '';
        renderGroups();
        setStatus('已选 ' + res.selected + ' / 共 ' + res.total, '');
      } else {
        setStatus(!res || res.reason === 'empty' ? '未检测到对话列表' : '扫描失败', '');
      }
    } catch (e) {
      setStatus('扫描出错了：' + (e && e.message), '');
    } finally {
      scanning = false;
    }
  }

  function handleAction(act) {
    if (act === 'all') {
      activeGroups.clear();
      run(function () {
        return DSBS.selectAll();
      }).then(afterRun);
      return;
    }
    if (act === 'none') {
      activeGroups.clear();
      run(function () {
        return DSBS.selectNone();
      }).then(afterRun);
      return;
    }
    if (act === 'invert') {
      run(function () {
        return DSBS.invertSelection();
      }).then(afterRun);
      return;
    }
    if (act === 'refresh') {
      lastGroupSignature = '';
      knownGroups = [];
      DSBS.clearGroupCache();
      renderGroups();
      deepRefresh();
      return;
    }
    if (act === 'collapse') {
      panelEl.classList.toggle('collapsed');
      saveUiState();
      return;
    }
    if (act === 'hide') {
      forced = false;
      userHidden = true;
      hide();
    }
  }

  function onGroupToggle(label, on) {
    if (on) activeGroups.add(label);
    else activeGroups.delete(label);
    run(function () {
      return DSBS.applySelection(function (item) {
        const group = DSBS.getGroup(item);
        if (group !== label) return undefined;
        return on;
      });
    }).then(afterRun);
  }

  /* ------------------------------ 对外 ------------------------------ */

  function show() {
    const wasHidden = !host || host.style.display === 'none';
    if (!host) mount();
    host.style.display = 'block';
    if (wasHidden) {
      // 重新进入多选模式：分组数据作废，等下一次 refresh 重新全量扫描
      autoScanned = false;
      knownGroups = [];
      lastGroupSignature = '';
    }
  }

  function hide() {
    if (host) host.style.display = 'none';
  }

  function isShown() {
    return !!host && host.style.display !== 'none';
  }

  function refresh(opts) {
    opts = opts || {};
    if (!host || host.style.display === 'none') return;
    if (DSBS.isBusy() || running || scanning) return;
    DSBS.clearGroupCache();
    renderGroups();
    if (!opts.keepStatus) updateQuickStatus();
    // 面板每次重新出现时，先做一次全量扫描，保证旧对话的分组也能被列出来
    if (!autoScanned && !opts.keepStatus) {
      autoScanned = true;
      deepRefresh();
    }
  }

  /** 操作结束后：用本次扫描到的完整分组刷新列表，同时保留「已选 N / 共 M」结果文案 */
  function afterRun(result) {
    if (result && result.ok && result.groups && result.groups.length) {
      knownGroups = result.groups;
      lastGroupSignature = '';
    }
    refresh({ keepStatus: true });
  }

  DSBS.panel = {
    mount: mount,
    /** 主动显示（弹窗触发）：标记为强制，忽略自动隐藏逻辑 */
    show: function () {
      forced = true;
      userHidden = false;
      show();
    },
    hide: hide,
    /** 用户手动关闭面板：本次会话不再自动弹出 */
    hideByUser: function () {
      forced = false;
      userHidden = true;
      hide();
    },
    isShown: isShown,
    isForced: function () {
      return forced;
    },
    isUserHidden: function () {
      return userHidden;
    },
    clearForced: function () {
      forced = false;
    },
    refresh: refresh
  };
})();
