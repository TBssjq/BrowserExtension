/**
 * DeepSeek 对话批量选择助手 —— 操作层
 *
 * 负责真正去「点击」站点自己的复选框，并兼容列表虚拟化：
 * 先滚到顶部，逐屏勾选后再滚回原位。
 */
(function () {
  'use strict';

  const DSBS = (window.DSBS = window.DSBS || {});

  /** 记录本会话中被我们点过的复选框，用于在无法读取状态时避免重复切换 */
  let touched = new WeakSet();
  let busy = false;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /** 完整模拟一次鼠标点击，兼容只监听 mousedown / pointerdown 的实现 */
  function simulateClick(el) {
    const rect = el.getBoundingClientRect();
    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    };
    try {
      el.dispatchEvent(
        new PointerEvent('pointerdown', Object.assign({ pointerId: 1, isPrimary: true, pointerType: 'mouse' }, common))
      );
    } catch (e) {}
    el.dispatchEvent(new MouseEvent('mousedown', common));
    try {
      el.focus({ preventScroll: true });
    } catch (e) {}
    try {
      el.dispatchEvent(
        new PointerEvent('pointerup', Object.assign({ pointerId: 1, isPrimary: true, pointerType: 'mouse' }, common))
      );
    } catch (e) {}
    el.dispatchEvent(new MouseEvent('mouseup', common));
    el.dispatchEvent(new MouseEvent('click', common));
  }

  /**
   * 把某一行设为期望的勾选状态。
   * 状态读不出来时，用「本会话是否点过」来推断，保证不会来回翻转。
   */
  function setChecked(item, desired) {
    const cb = item && item.checkbox;
    if (!cb) return false;

    const state = DSBS.getCheckedState(item);
    if (state === desired) return false;

    if (state === null) {
      const wasTouched = touched.has(cb);
      if (desired === true && wasTouched) return false;
      if (desired === false && !wasTouched) return false;
    }

    simulateClick(cb);
    if (desired) touched.add(cb);
    else touched.delete(cb);
    return true;
  }

  /** 找到可以滚动的列表容器 */
  function findScrollContainer(node) {
    let cur = node && node.parentElement;
    let firstScrollable = null;
    while (cur && cur !== document.documentElement) {
      const style = getComputedStyle(cur);
      const scrollable = /(auto|scroll|overlay)/.test(style.overflowY);
      if (scrollable) {
        if (cur.scrollHeight > cur.clientHeight + 8) return cur;
        if (!firstScrollable) firstScrollable = cur;
      }
      cur = cur.parentElement;
    }
    if (firstScrollable) return firstScrollable;
    return document.scrollingElement || document.documentElement;
  }

  /**
   * 滚动扫描整个对话列表，对每个对话行调用 handler(item, key)。
   * 返回 Map<key, boolean|null>：本行扫描结束后的勾选状态。
   */
  async function withScrollScan(handler) {
    if (busy) return { ok: false, reason: 'busy', states: new Map(), groupOf: new Map() };
    busy = true;

    const states = new Map();
    const groupOf = new Map();
    let scrollTarget = null;
    let prevBehavior = '';
    let homeTop = 0;
    try {
      const snapshot = DSBS.getItems();
      if (!snapshot.items.length) return { ok: false, reason: 'empty', states: states, groupOf: groupOf };

      const container = findScrollContainer(snapshot.items[0].node);
      const canScroll = !!(
        container &&
        container.scrollHeight > container.clientHeight + 8 &&
        container !== document.scrollingElement
      );

      const runPass = function () {
        const current = DSBS.getItems();
        for (let i = 0; i < current.items.length; i++) {
          const item = current.items[i];
          const key = DSBS.itemKey(item);
          const label = DSBS.getGroup(item);
          if (label) groupOf.set(key, label);
          let target;
          try {
            target = handler(item, key);
          } catch (e) {
            target = undefined;
          }
          const state = DSBS.getCheckedState(item);
          if (state !== null) states.set(key, state);
          else if (!states.has(key)) states.set(key, target === true || touched.has(item.checkbox));
        }
      };

      if (!canScroll) {
        runPass();
      } else {
        // 站点可能有 scroll-behavior: smooth，会让 scrollTop 变成动画值，先临时关掉
        scrollTarget = container;
        prevBehavior = container.style.scrollBehavior;
        container.style.scrollBehavior = 'auto';
        homeTop = container.scrollTop;

        container.scrollTop = 0;
        await sleep(220);

        let prev = null;
        let guard = 0;
        while (guard++ < 400) {
          runPass();
          const top = container.scrollTop;
          if (prev !== null && Math.abs(top - prev) < 1) break;
          prev = top;
          container.scrollTop = top + Math.max(60, Math.floor(container.clientHeight * 0.8));
          await sleep(180);
        }

        container.scrollTop = homeTop;
        await sleep(150);
      }

      return { ok: true, states: states, groupOf: groupOf };
    } finally {
      if (scrollTarget) {
        scrollTarget.style.scrollBehavior = prevBehavior;
        try {
          scrollTarget.scrollTop = homeTop;
        } catch (e) {}
      }
      busy = false;
    }
  }

  function summarize(states, groupOf) {
    let selected = 0;
    states.forEach(function (v) {
      if (v) selected++;
    });
    // groupOf 以对话为 key 去重，所以跨滚动批次不会重复计数，且保持自上而下的顺序
    const buckets = new Map();
    groupOf.forEach(function (label) {
      buckets.set(label, (buckets.get(label) || 0) + 1);
    });
    const groups = [];
    buckets.forEach(function (count, label) {
      groups.push({ label: label, count: count });
    });
    return { total: states.size, selected: selected, groups: groups };
  }

  /**
   * 执行一次批量选择。
   * @param {(item, key) => (boolean|undefined)} decide
   *   true 勾选 / false 取消勾选 / undefined 不动这一行
   */
  async function applySelection(decide) {
    const res = await withScrollScan(function (item, key) {
      const target = decide(item, key);
      if (target === true || target === false) setChecked(item, target);
      return target;
    });
    if (!res.ok) return res;
    const stat = summarize(res.states, res.groupOf);
    return { ok: true, total: stat.total, selected: stat.selected, groups: stat.groups };
  }

  /** 只扫描、不点击：用于把完整的「日期分组」列表列出来 */
  async function scanGroups() {
    const res = await withScrollScan(function () {
      return undefined;
    });
    if (!res.ok) return res;
    const stat = summarize(res.states, res.groupOf);
    return { ok: true, total: stat.total, selected: stat.selected, groups: stat.groups };
  }

  function selectAll() {
    return applySelection(function () {
      return true;
    });
  }

  function selectNone() {
    return applySelection(function () {
      return false;
    });
  }

  /** 反选：先扫描记录状态，再按相反状态应用 */
  async function invertSelection() {
    const snapshotStates = new Map();
    const scan = await withScrollScan(function (item, key) {
      const state = DSBS.getCheckedState(item);
      if (state !== null) snapshotStates.set(key, state);
      return undefined;
    });
    if (!scan.ok) return scan;
    if (!snapshotStates.size) return { ok: false, reason: 'unknown-state' };

    DSBS.clearGroupCache();
    return applySelection(function (item, key) {
      if (!snapshotStates.has(key)) return undefined;
      return !snapshotStates.get(key);
    });
  }

  DSBS.applySelection = applySelection;
  DSBS.scanGroups = scanGroups;
  DSBS.selectAll = selectAll;
  DSBS.selectNone = selectNone;
  DSBS.invertSelection = invertSelection;
  DSBS.setChecked = setChecked;
  DSBS.simulateClick = simulateClick;
  DSBS.resetTouched = function () {
    touched = new WeakSet();
  };
  DSBS.isBusy = function () {
    return busy;
  };
})();
