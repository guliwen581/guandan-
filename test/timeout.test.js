'use strict';
// P0-2 超时机制：引擎 timeout 动作覆盖加倍/进贡阶段；服务器权威计时到期自动代打。
var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }

// ---- 引擎：加倍阶段超时 = 不加倍并推进 ----
var createGame = require('../js/game.js').createGame;
var G = createGame();
G.init({ render: function () {}, onSettle: function () {}, onLobby: function () {} });
G.sync = true; G.setHumanSeats([0]);
G.quickStart(800);
var sn = G.snapshot();
check('首局直接进入加倍等待真人', sn.phase === 'double' && sn.canDouble);
G.act(0, { type: 'timeout' });
var sn2 = G.snapshot();
check('加倍超时=不加倍', sn2.seats[0].doubled === false || sn2.seats[0].doubled == null);
check('超时后流程推进(不再等加倍)', !sn2.canDouble);

// ---- 服务器：权威计时器到期触发 act(timeout) ----
var srv = require('../server/main.js');
var r = new srv.Room('T9', 800);
r.game.setHumanSeats([0]);
r.game.setNames(['甲', '乙', '丙', '丁']);
r.seats[0] = { conn: { send: function () {} }, name: '甲' };   // 假连接：只需 scheduleTimeouts 认为在线
r.started = true;
r.game.quickStart(800);
check('服务器房间 进入加倍等待', r.game.snapshotFor(0).canDouble === true);
r.TIMEOUT_MS = 60;           // 实例覆盖，加速测试
r.scheduleTimeouts();
setTimeout(function () {
  var sn3 = r.game.snapshotFor(0);
  check('服务器计时到期自动代决策', sn3.canDouble === false);
  r.clearTimeouts();
  srv.server.close();
  console.log('\n通过 ' + passes + ' / 失败 ' + fails);
  process.exit(fails ? 1 : 0);
}, 150);
