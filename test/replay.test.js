'use strict';
// P1-3 回放：结算快照携带本局公共事件流；座位按视角旋转；事件构成完整(加倍/出牌/不出/结算)。
var createGame = require('../js/game.js').createGame;
var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }

var G = createGame();
G.init({ render: function () {}, onSettle: function () {}, onLobby: function () {} });
G.sync = true; G.AUTO_ALL = true;
G.quickStart(800);
var sn = G.snapshot();
check('结算快照带 replay', sn.phase === 'settle' && Array.isArray(sn.lastResult.replay) && sn.lastResult.replay.length > 10);
var rep = sn.lastResult.replay;
check('含加倍事件(4条)', rep.filter(function (e) { return e.t === 'dbl'; }).length === 4);
check('含出牌事件且有牌数据', rep.some(function (e) { return e.t === 'play' && e.cards && e.cards.length > 0; }));
check('以结算事件收尾', rep[rep.length - 1].t === 'settle');
check('出牌座位均在 0-3', rep.every(function (e) { return e.seat == null || (e.seat >= 0 && e.seat <= 3); }));

// 视角旋转：snapshotFor(2) 里首个出牌事件座位 = (0视角座位 - 2 + 4) % 4
var firstPlay0 = rep.filter(function (e) { return e.t === 'play'; })[0];
var rep2 = G.snapshotFor(2).lastResult.replay;
var firstPlay2 = rep2.filter(function (e) { return e.t === 'play'; })[0];
check('回放座位随视角旋转', firstPlay2.seat === (firstPlay0.seat - 2 + 4) % 4);

// 第二局 replay 重新计数（不串局）：首事件是进贡(有贡)或加倍(无贡/抗贡)，不会混入上一局事件
G.nextRound();
var sn3 = G.snapshot();
var t0 = sn3.phase === 'settle' ? sn3.lastResult.replay[0].t : '';
check('新一局 replay 重置', t0 === 'dbl' || t0 === 'give');

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
