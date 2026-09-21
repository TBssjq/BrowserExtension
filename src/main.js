/**
 * DeepSeek 对话批量选择助手 —— 入口
 * 负责：读取设置、监听页面变化、在检测到「选择对话」模式时自动显示面板。
 */
(function () {
  'use strict';

  const DSBS = window.DSBS;
  if (!DSBS || !DSBS.panel) return;

  const SETTINGS_KEY = 'dsbs_settings';
  const DEFAULTS = {
    enabled: true,
    autoShow: true,
    extraGroupPattern: ''
  };

  let settings = Object.assign({}, DEFAULTS);
  let timer = null;
  let observer = null;
  let lastDetectAt = 0;

  function loadSettings() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.sync.get(SETTINGS_KEY, function (res) {
          const stored = (res && res[SETTINGS_KEY]) || {};
          resolve(Object.assign({}, DEFAULTS, stored));
        });
      } catch (e) {
        resolve(Object.assign({}, DEFAULTS));
      }
    });
  }

  function detect() {
    if (!settings.enabled) {
      DSBS.panel.hide();
      return;
    }
    if (DSBS.isBusy()) return;

    let items = [];
    try {
      items = DSBS.getItems().items;
    } catch (e) {
      items = [];
    }

    if (items.length >= 2) {
      if (DSBS.panel.isForced() || (settings.autoShow && !DSBS.panel.isUserHidden())) DSBS.panel.show();
      if (DSBS.panel.isShown()) DSBS.panel.refresh();
      return;
    }
    if (DSBS.panel.isForced()) {
      if (items.length) DSBS.panel.refresh();
      return;
    }
    if (DSBS.panel.isShown()) DSBS.panel.hide();
  }

  function scheduleDetect(delay) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      const now = Date.now();
      if (now - lastDetectAt < 200) {
        scheduleDetect(200);
        return;
      }
      lastDetectAt = now;
      detect();
    }, delay === undefined ? 450 : delay);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function () {
      if (DSBS.isBusy()) return;
      if (!document.querySelector(DSBS.CB_SELECTOR)) return;
      scheduleDetect(500);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function handleMessage(message, sender, sendResponse) {
    const type = message && message.type;
    (async function () {
      try {
        if (type === 'ping') {
          sendResponse({ ok: true, items: DSBS.getItems().items.length });
          return;
        }
        if (type === 'show-panel') {
          DSBS.panel.show();
          DSBS.panel.refresh();
          detect();
          sendResponse({ ok: true });
          return;
        }
        if (type === 'hide-panel') {
          DSBS.panel.hideByUser();
          sendResponse({ ok: true });
          return;
        }
        if (type === 'select-all') {
          DSBS.panel.show();
          const r = await DSBS.selectAll();
          DSBS.panel.refresh();
          sendResponse({ ok: true, result: r });
          return;
        }
        if (type === 'select-none') {
          DSBS.panel.show();
          const r = await DSBS.selectNone();
          DSBS.panel.refresh();
          sendResponse({ ok: true, result: r });
          return;
        }
        if (type === 'get-status') {
          const snapshot = DSBS.getItems();
          sendResponse({
            ok: true,
            found: snapshot.items.length,
            busy: DSBS.isBusy(),
            shown: DSBS.panel.isShown()
          });
          return;
        }
        sendResponse({ ok: false, error: 'unknown message' });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }

  function applySettings(next) {
    settings = Object.assign({}, DEFAULTS, next || {});
    DSBS.setExtraGroupPattern(settings.extraGroupPattern);
  }

  async function init() {
    applySettings(await loadSettings());
    DSBS.panel.mount();
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleDetect(300);
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'sync' && changes[SETTINGS_KEY]) {
        applySettings(changes[SETTINGS_KEY].newValue);
        scheduleDetect(100);
      }
    });
    chrome.runtime.onMessage.addListener(handleMessage);
    startObserver();
    scheduleDetect(400);
  }

  init();
})();
