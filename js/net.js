/*
 * net.js —— 浏览器联机客户端（原生 WebSocket）
 *  - 与 server/main.js 同端口建立 ws 连接，加入/创建房间；
 *  - 收到服务器快照即调用 GDRender 渲染（快照已旋转到“自己=0号位”，ui.js 无需改动渲染）；
 *  - 暴露一个与 Game 同形的 backend：ui.js 的出牌/不出/加倍/还贡/超时 全部转发到服务器。
 *  需在 ui.js 之前加载。联机请用 `node server/main.js` 启动的地址（同端口托管页面与 WS）。
 */
(function () {
  'use strict';
  var GLOBAL = (typeof window !== 'undefined') ? window : globalThis;
  var Game = GLOBAL.Game;

  var Net = {
    active: false, started: false, seat: -1, room: '', roomInfo: null,
    lastSnap: null, name: '', lastError: null, ws: null, backend: null
  };

  function defaultName() {
    try { return localStorage.getItem('gd_name') || ('玩家' + Math.floor(1000 + Math.random() * 9000)); }
    catch (e) { return '玩家'; }
  }
  Net.name = defaultName();

  function render() { if (GLOBAL.GDRender) GLOBAL.GDRender(Net.lastSnap); }
  function wsUrl() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host; }

  Net.enterOnline = function () {
    Net.active = true; Net.started = false; Net.roomInfo = null; Net.lastError = null;
    render();
  };

  Net.roundsChoice = 0;   // P1-1 建房局数：0不限 / 4 / 8 / 16
  Net.createRoom = function (name) { Net._connectAndJoin('new', name, 800, Net._lobbyGold(), Net.roundsChoice); };
  Net.joinRoom = function (code, name) {
    code = String(code || '').trim().toUpperCase();
    if (!code) { Net.lastError = '请输入房间号'; render(); return; }
    Net._connectAndJoin(code, name, 800, Net._lobbyGold(), 0);
  };
  Net._lobbyGold = function () { try { var sn = Game.snapshot(); return !!(sn && sn.mode && sn.mode.gold); } catch (e) { return false; } };  // 跟随大厅选择；加入已有房间时由房主设置决定

  Net._connectAndJoin = function (room, name, base, gold, rounds) {
    Net.name = (name || '').trim().slice(0, 8) || defaultName();
    try { localStorage.setItem('gd_name', Net.name); } catch (e) {}
    Net.lastError = null;
    if (Net.ws) { try { Net.ws.close(); } catch (e) {} Net.ws = null; }
    var ws;
    try { ws = new WebSocket(wsUrl()); }
    catch (e) { Net.lastError = '无法连接服务器'; render(); return; }
    Net.ws = ws;
    ws.onopen = function () { ws.send(JSON.stringify({ type: 'join', room: room, name: Net.name, base: base, gold: !!gold, rounds: rounds || 0 })); };
    ws.onmessage = function (ev) { Net._onMessage(ev.data); };
    ws.onerror = function () { Net.lastError = '连接出错：联机请用 node server/main.js 启动的地址打开页面'; Net.started = false; render(); };
    ws.onclose = function () {
      if (!Net.active) return;                              // 主动离开(leaveRoom 先置 active=false)不报错
      Net.lastError = Net.lastError || '与服务器断开连接';   // 含游戏中途断线
      Net.started = false;                                  // 回到联机页以展示错误条
      render();
    };
  };

  Net._onMessage = function (text) {
    var msg; try { msg = JSON.parse(text); } catch (e) { return; }
    if (msg.type === 'joined') { Net.seat = msg.seat; Net.room = msg.room; }
    else if (msg.type === 'room') { Net.roomInfo = msg; Net.started = false; render(); }
    else if (msg.type === 'snapshot') {
      Net.lastSnap = msg.snap; Net.started = true;
      if (GLOBAL.GDSetBackend) GLOBAL.GDSetBackend(Net.backend);
      render();
    } else if (msg.type === 'chat') {
      if (msg.seat === Net.seat) return;                       // 自己发的本端已显示，跳过回声
      var vid = (msg.seat - (Net.seat || 0) + 4) % 4;          // 换算到本端视角座位
      if (GLOBAL.GDShowEmote) GLOBAL.GDShowEmote(vid, msg.text);
    } else if (msg.type === 'dissolved') {
      Net.lastError = '房间已被房主解散';
      Net.leaveRoom();
      if (GLOBAL.GDToast) GLOBAL.GDToast('房间已解散');
    } else if (msg.type === 'error') { Net.lastError = msg.msg; render(); }
  };

  Net.startGame = function () { if (Net.ws && Net.ws.readyState === 1) Net.ws.send(JSON.stringify({ type: 'start' })); };
  Net.dissolve = function () { if (Net.ws && Net.ws.readyState === 1) Net.ws.send(JSON.stringify({ type: 'dissolve' })); };
  Net.next = function () { if (Net.ws && Net.ws.readyState === 1) Net.ws.send(JSON.stringify({ type: 'next' })); };
  Net.act = function (action) { if (Net.ws && Net.ws.readyState === 1) Net.ws.send(JSON.stringify({ type: 'act', action: action })); };
  Net.sendChat = function (text) { if (Net.ws && Net.ws.readyState === 1) Net.ws.send(JSON.stringify({ type: 'chat', text: String(text || '').slice(0, 30) })); };

  Net.leaveRoom = function () {
    if (Net.ws) { try { Net.ws.close(); } catch (e) {} Net.ws = null; }
    Net.active = false; Net.started = false; Net.seat = -1; Net.room = ''; Net.roomInfo = null; Net.lastSnap = null;
    if (GLOBAL.GDSetBackend) GLOBAL.GDSetBackend(Game);
    if (Game && Game.toLobby) Game.toLobby(); else render();
  };

  // 与 Game 同形的后端：ui.js 的动作经此转发到服务器
  Net.backend = {
    RANK_LABEL: Game ? Game.RANK_LABEL : ['头游', '二游', '三游', '末游'],
    NAMES: Game ? Game.NAMES : [],
    snapshot: function () { return Net.lastSnap; },
    humanPlay: function (ids) { Net.act({ type: 'play', ids: ids }); return true; },
    humanPass: function () { Net.act({ type: 'pass' }); return true; },
    humanDouble: function (yes) { Net.act({ type: 'double', yes: !!yes }); },
    humanTribute: function (id) { Net.act({ type: 'tribute', id: id }); return true; },
    humanTributeGive: function (id) { Net.act({ type: 'tributeGive', id: id }); return true; },
    humanTimeout: function () { Net.act({ type: 'timeout' }); },
    quickStart: function () { Net.next(); },
    nextRound: function () { Net.next(); },
    toLobby: function () { Net.leaveRoom(); },
    setNoShuffle: function () {}, setBase: function () {}, setGoldMode: function () {}, init: function () {}
  };

  GLOBAL.Net = Net;
})();
