/**
 * DeepSeek 对话批量选择助手 —— DOM 探测层（只读）
 *
 * 1. 找出「选择对话」模式下对话列表里的复选框；
 * 2. 把复选框归到所属的「对话行」；
 * 3. 推断每一行属于哪个日期分组（今天 / 昨天 / 7 天内 / 2025-07 ...）。
 *
 * 站点结构随时会变，因此全部使用启发式规则，不写死具体选择器。
 */
(function () {
  'use strict';

  const DSBS = (window.DSBS = window.DSBS || {});

  const CB_SELECTOR = [
    'input[type="checkbox"]',
    '[role="checkbox"]',
    '[aria-checked]',
    '[class*="checkbox" i]',
    '[class*="check-box" i]',
    '[class*="check_box" i]',
    '[data-testid*="checkbox" i]'
  ].join(',');

  const EXCLUDE_TEXT_RE =
    /^(新建对话|新对话|新建|搜索|设置|个人中心|登录|注册|加载更多|查看更多|展开|收起|返回|New chat|Search|Settings|Log in)$/i;

  let extraGroupRe = null;
  let groupCache = new WeakMap();
  let overflowCache = new WeakMap();

  /* ---------------------------- 基础工具 ---------------------------- */

  function cleanText(el) {
    if (!el) return '';
    return String(el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity || '1') < 0.05) return false;
    return true;
  }

  function hasClassToken(el, token) {
    if (!el) return false;
    const cls =
      typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '';
    if (!cls) return false;
    return new RegExp('(^|[\\s_-])' + token + '($|[\\s_-])', 'i').test(cls);
  }

  function isOverflowScrollable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (overflowCache.has(el)) return overflowCache.get(el);
    const style = getComputedStyle(el);
    const ok = /(auto|scroll|overlay)/.test(style.overflowY) || /(auto|scroll|overlay)/.test(style.overflow);
    overflowCache.set(el, ok);
    return ok;
  }

  /* --------------------------- 复选框识别 --------------------------- */

  /** 只保留「最内层」的复选框，避免父子嵌套元素被算成两个 */
  function innermostCheckboxes(root) {
    const all = Array.prototype.slice.call(root.querySelectorAll(CB_SELECTOR));
    if (all.length < 2) return all;
    const set = new Set(all);
    const drop = new Set();
    for (let i = 0; i < all.length; i++) {
      let p = all[i].parentElement;
      while (p && p !== document.documentElement) {
        if (set.has(p)) drop.add(p);
        p = p.parentElement;
      }
    }
    return all.filter(function (el) {
      return !drop.has(el);
    });
  }

  function checkboxPriority(el) {
    if (el.tagName === 'INPUT') return 3;
    if (el.getAttribute && el.getAttribute('role') === 'checkbox') return 2;
    return 1;
  }

  /** 一次遍历统计每个祖先包含多少复选框，供 findItemNode 使用 */
  function buildCountMap(boxes) {
    const map = new Map();
    for (let i = 0; i < boxes.length; i++) {
      let p = boxes[i].parentElement;
      while (p && p !== document.documentElement) {
        map.set(p, (map.get(p) || 0) + 1);
        p = p.parentElement;
      }
    }
    return map;
  }

  /** parent 中位于 me 之前的兄弟里是否已有日期标题（说明 parent 是分组容器而不是一行对话） */
  function hasEarlierHeader(parent, me) {
    const kids = parent.children;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      if (child === me) return false;
      if (child.contains && child.contains(me)) continue;
      if (getHeaderLabel(child)) return true;
    }
    return false;
  }

  /**
   * 从复选框向上爬，找到代表「一条对话」的行节点。
   * 终止条件：再往上会把别的复选框也包进来、已经是列表容器、
   * 或者已经把日期标题包进来了（那种情况说明当前节点就是一行对话）。
   */
  function findItemNode(cb, countMap) {
    let node = cb;
    for (let i = 0; i < 8; i++) {
      const parent = node.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      if (countMap.get(parent) > 1) break;
      if (isOverflowScrollable(parent)) break;
      if (parent.clientHeight > 320 || parent.clientWidth > 900) break;
      if (hasEarlierHeader(parent, node)) break;
      node = parent;
    }
    return node;
  }

  function byDocOrder(a, b) {
    if (a.node === b.node) return 0;
    const pos = a.node.compareDocumentPosition(b.node);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  /** 最低公共祖先：chain 自下而上，第一个能包含全部节点的即为所求 */
  function lowestCommonAncestor(nodes) {
    if (!nodes.length) return null;
    let cur = nodes[0];
    while (cur && cur !== document.documentElement) {
      let all = true;
      for (let i = 1; i < nodes.length; i++) {
        if (!cur.contains(nodes[i])) {
          all = false;
          break;
        }
      }
      if (all) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  /**
   * 当前处于「选择对话」模式的对话列表。
   * @returns {{container: Element|null, items: Array<{node: Element, checkbox: Element}>}}
   */
  function getItems() {
    const boxes = innermostCheckboxes(document);
    if (!boxes.length) return { container: null, items: [] };

    const countMap = buildCountMap(boxes);
    const byItem = new Map();

    for (let i = 0; i < boxes.length; i++) {
      const cb = boxes[i];
      const node = findItemNode(cb, countMap);
      const prev = byItem.get(node);
      if (!prev || checkboxPriority(cb) > checkboxPriority(prev)) byItem.set(node, cb);
    }

    let entries = [];
    byItem.forEach(function (cb, node) {
      if (isVisible(node)) entries.push({ node: node, checkbox: cb });
    });
    if (!entries.length) return { container: null, items: [] };

    let container = lowestCommonAncestor(
      entries.map(function (it) {
        return it.node;
      })
    );

    // 页面里可能还存在别的复选框（例如设置弹窗）。若最小公共祖先落到 body，
    // 说明这些行并不是同一个列表，退化成「按父容器取最大的一组」。
    if (!container || container === document.body || container === document.documentElement) {
      const buckets = new Map();
      entries.forEach(function (it) {
        const parent = it.node.parentElement;
        if (!parent) return;
        let arr = buckets.get(parent);
        if (!arr) {
          arr = [];
          buckets.set(parent, arr);
        }
        arr.push(it);
      });
      let best = null;
      buckets.forEach(function (arr) {
        if (!best || arr.length > best.length) best = arr;
      });
      container = best && best.length ? best[0].node.parentElement : null;
      entries = best || [];
    }

    entries.sort(byDocOrder);
    assignGroups(entries, container);
    return { container: container, items: entries };
  }

  /* -------------------------- 复选框状态读取 ------------------------- */

  function findChildInput(cb) {
    if (cb.tagName === 'INPUT' && cb.type === 'checkbox') return cb;
    const inner = cb.querySelector && cb.querySelector('input[type="checkbox"]');
    return inner || null;
  }

  /**
   * 读取勾选状态：true / false / null（无法判断）。
   */
  function getCheckedState(item) {
    const cb = item && item.checkbox;
    const node = item && item.node;
    if (!cb) return null;

    const input = findChildInput(cb);
    if (input) return !!input.checked;

    const scope = [cb, node];
    for (let i = 0; i < scope.length; i++) {
      const el = scope[i];
      if (!el || !el.getAttribute) continue;
      const aria = el.getAttribute('aria-checked');
      if (aria === 'true') return true;
      if (aria === 'false') return false;
    }
    for (let i = 0; i < scope.length; i++) {
      const el = scope[i];
      if (!el || !el.getAttribute) continue;
      const ds = el.getAttribute('data-state');
      if (ds === 'checked' || ds === 'on') return true;
      if (ds === 'unchecked' || ds === 'off') return false;
    }
    if (cb.hasAttribute('data-checked')) return true;

    for (let i = 0; i < scope.length; i++) {
      const el = scope[i];
      if (!el) continue;
      if (hasClassToken(el, 'checked') || hasClassToken(el, 'selected')) return true;
    }
    if (hasClassToken(cb, 'unchecked') || (node && hasClassToken(node, 'unchecked'))) return false;

    // 兜底：勾选后一般会插入一个对勾图标
    const marks = cb.querySelectorAll('*');
    for (let i = 0; i < marks.length && i < 8; i++) {
      const cls = typeof marks[i].className === 'string' ? marks[i].className : '';
      if (/tick|checkmark|check-icon/i.test(cls)) return true;
    }
    return null;
  }

  /* ---------------------------- 日期分组 ---------------------------- */

  function setExtraGroupPattern(src) {
    if (!src) {
      extraGroupRe = null;
      return;
    }
    try {
      extraGroupRe = new RegExp(src, 'i');
    } catch (e) {
      extraGroupRe = null;
    }
  }

  /**
   * 去掉标题尾部可能带的计数，例如「今天（12）」「昨天 3」「7 天内 · 25」
   * 否则这些真实分组会因为多出几个字符而匹配不上。
   */
  function normalizeGroupText(raw) {
    let t = String(raw || '').replace(/\s+/g, ' ').trim();
    // 「今天（12）」「昨天(3)条对话」——必须带括号才剥离
    t = t.replace(/\s*[（(]\s*\d+\s*[）)]\s*(?:个|条)?\s*(?:对话|会话|聊天|记录)?\s*$/i, '');
    // 「7 天内 · 25」
    t = t.replace(/[·•|｜]\s*\d+\s*$/, '');
    // 「今天 12」
    t = t.replace(/\s+\d+\s*$/, '');
    // 「今天 12 个对话」——必须带量词才剥离，否则会把「2026-09」尾部的 9 也误删
    t = t.replace(/\s*\d+\s*(?:个|条)?\s*(?:对话|会话|聊天|记录|chats?|conversations?)\s*$/i, '');
    return t.trim();
  }

  /**
   * 日期分组标题的判定规则，覆盖：
   *   今天/昨天/前天、本周/上周、本月/上月、更早
   *   近 7 天、最近 30 天、7 天内、30 天内、1 个月内、3 天前
   *   2026-09、2026/09/15、2026年9月、9月15日、9月
   */
  const DATE_HEADER_RE = new RegExp(
    '^(?:' +
      '今天|今日|昨天|昨日|前天|前日|' +
      '本周|这周|这一周|本星期|这星期|上周|上星期|前一星期|' +
      '本月|这个月|当月|上月|上个月|' +
      '更早|更久|更早以前|更久以前|很早|以前|' +
      'Today|Yesterday|Earlier|Older' +
      ')$|' +
      '^(?:近|最近|过去|前|last|past|previous)\\s*\\d+\\s*(?:天|日|周|个?月|年|days?|weeks?|months?|years?)(?:内|以内|之内)?$|' +
      '^\\d+\\s*(?:天|日|周|个?月|年|小时|分钟)(?:前|内|以内|之内)?$|' +
      '^\\d{4}\\s*[-/.年]\\s*\\d{1,2}\\s*(?:[-/.月]\\s*(?:\\d{1,2}\\s*[日号]?)?)?$|' +
      '^\\d{4}\\s*年?$|' +
      '^\\d{1,2}\\s*[-/.]\\s*\\d{1,2}$|' +
      '^\\d{1,2}\\s*月(?:\\s*\\d{1,2}\\s*[日号])?$',
    'i'
  );

  function isDateHeaderText(raw) {
    const t = normalizeGroupText(raw);
    if (!t || t.length > 24) return false;
    if (EXCLUDE_TEXT_RE.test(t)) return false;
    if (extraGroupRe && extraGroupRe.test(t)) return true;
    return DATE_HEADER_RE.test(t);
  }

  /** 是日期分组标题则返回归一化后的标签，否则返回 null */
  function getHeaderLabel(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SVG') return null;
    // 分组标题节点不会太大，先做廉价剪枝，避免对整块容器做 textContent
    if (el.childElementCount > 24) return null;
    const text = cleanText(el);
    if (!text || text.length > 24) return null;
    if (!isDateHeaderText(text)) return null;
    // 真正包含对话行的容器不算标题（选择模式下里面一定有复选框）
    if (el.matches && el.matches(CB_SELECTOR)) return null;
    if (el.querySelector && el.querySelector(CB_SELECTOR)) return null;
    const rect = el.getBoundingClientRect();
    if (rect.height > 60 || rect.width < 8) return null;
    return normalizeGroupText(text);
  }

  /**
   * 一次性按文档顺序给所有对话行标记分组。
   * 比「每行各自向前回溯」快得多，也避免长列表下的重复布局计算。
   * 规则：往下走遇到的第一个标题，就是其后所有对话行的分组。
   */
  function assignGroups(items, container) {
    if (!items.length) return;
    if (!container) container = items[0].node.parentElement;
    if (!container) return;

    const itemSet = new Set(
      items.map(function (it) {
        return it.node;
      })
    );
    if (itemSet.has(container)) return;

    let current = null;
    const walk = function (el) {
      const kids = el.children;
      for (let i = 0; i < kids.length; i++) {
        const child = kids[i];
        if (itemSet.has(child)) {
          groupCache.set(child, current);
          continue;
        }
        const label = getHeaderLabel(child);
        if (label) {
          current = label;
          continue;
        }
        walk(child);
      }
    };
    walk(container);
  }

  /** 兜底：往上/往前找最近的一个日期分组标题（取最先遇到的，不再被更早的强匹配抢走） */
  function getGroupByNode(node) {
    if (!node) return null;
    if (groupCache.has(node)) return groupCache.get(node);

    let result = null;
    let cur = node;
    for (let depth = 0; depth < 6 && cur; depth++) {
      let sib = cur.previousElementSibling;
      let steps = 0;
      while (sib && steps < 80) {
        const label = getHeaderLabel(sib);
        if (label) {
          result = label;
          break;
        }
        sib = sib.previousElementSibling;
        steps++;
      }
      if (result) break;
      const parent = cur.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      cur = parent;
    }

    groupCache.set(node, result);
    return result;
  }

  function getGroup(item) {
    return item ? getGroupByNode(item.node) : null;
  }

  function clearGroupCache() {
    groupCache = new WeakMap();
    overflowCache = new WeakMap();
  }

  /** 跨渲染稳定的标识：分组 + 标题文本 */
  function itemKey(item) {
    if (!item) return '';
    const group = getGroup(item) || '';
    return group + '::' + cleanText(item.node).slice(0, 150);
  }

  /* ------------------------------ 导出 ------------------------------ */

  DSBS.CB_SELECTOR = CB_SELECTOR;
  DSBS.cleanText = cleanText;
  DSBS.isVisible = isVisible;
  DSBS.getItems = getItems;
  DSBS.getCheckedState = getCheckedState;
  DSBS.getGroup = getGroup;
  DSBS.itemKey = itemKey;
  DSBS.clearGroupCache = clearGroupCache;
  DSBS.setExtraGroupPattern = setExtraGroupPattern;
  DSBS.isDateHeaderText = isDateHeaderText;
  DSBS.normalizeGroupText = normalizeGroupText;
})();
