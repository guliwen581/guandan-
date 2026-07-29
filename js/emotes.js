/*
 * emotes.js —— 表情 / 快捷语（互动道具，商业化社交要素）
 *  - 复用牌桌右下角已有的"💬"按钮（data-act="chat"），点开表情面板；
 *  - 选中后在自己座位弹气泡 + 人声朗读 + 联机广播；联机收到对方表情按座位弹气泡。
 *  - 面板/气泡都挂在 body 层，不会被 ui.js 重写 #app 冲掉；不依赖 ui.js 任何改动。
 */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;   // 节点环境静默

  var EMOTES = [
    { t: '😀 你好', s: '你好呀' }, { t: '👍 赞', s: '打得好' }, { t: '🤝 配合', s: '配合一下' },
    { t: '😅 我的', s: '我的我的' }, { t: '🔥 加油', s: '加油加油' }, { t: '😎 稳住', s: '稳住，能赢' },
    { t: '⏩ 快点', s: '快点呀' }, { t: '🎉 漂亮', s: '漂亮！' }, { t: '😤 别急', s: '别急别急' }
  ];
  var POS = ['self', 'right', 'top', 'left'];   // viewer 视角座位 -> 气泡位置 class
  var panel = null, open = false;

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'emotepanel';
    panel.style.display = 'none';
    EMOTES.forEach(function (e, i) {
      var b = document.createElement('button');
      b.textContent = e.t; b.setAttribute('data-emote', i);
      panel.appendChild(b);
    });
    document.body.appendChild(panel);
    panel.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-emote]');
      if (b) doEmote(+b.getAttribute('data-emote'));
    });
    return panel;
  }
  function closePanel() { open = false; if (panel) panel.style.display = 'none'; }
  function togglePanel() { open = !open; ensurePanel().style.display = open ? 'grid' : 'none'; }

  function showAt(viewerId, text) {
    var d = document.createElement('div');
    d.className = 'emote ' + (POS[viewerId] || 'self');
    d.textContent = text;
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 2400);
  }
  function doEmote(i) {
    var e = EMOTES[i]; if (!e) return;
    showAt(0, e.t);                                   // 本端立即显示
    if (root.Voice && root.Voice.enabled) root.Voice.say(e.s);   // 人声
    if (root.Net && root.Net.sendChat) root.Net.sendChat(e.s);   // 联机广播
    closePanel();
  }

  // 拦截"💬"按钮（capture 阶段，先于 ui 的 #app 监听；聊天按钮 ui 无对应分支，互不干扰）
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var c = t && t.closest && t.closest('[data-act="chat"]');
    if (c) { ev.stopPropagation(); togglePanel(); return; }
    if (open && panel && !panel.contains(t)) closePanel();   // 点面板外关闭
  }, true);

  // 联机：收到对方表情/聊天，按座位弹气泡（自己发的本端已显示，跳过回声）
  root.GDShowEmote = function (viewerId, text) { showAt(viewerId, text); };
  root.GDEmotes = { doEmote: doEmote, showAt: showAt, list: EMOTES };
})(typeof window !== 'undefined' ? window : globalThis);
