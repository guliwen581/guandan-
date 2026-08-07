'use strict';
// P0-4 金币场：固定级牌2、无升级无终局、排名倍数4/2/1、炸弹倍数表、50000封顶、金币零和。
var Game = require('../js/game.js');
var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }

// ---- 炸弹倍数表（APK 明文）----
check('天王炸×5', Game._bombMultFor({ type: 'rocket', cards: [1, 1, 1, 1] }) === 5);
check('同花顺×2', Game._bombMultFor({ type: 'sf', cards: [1, 2, 3, 4, 5] }) === 2);
check('4炸×2', Game._bombMultFor({ type: 'bomb4', cards: [1, 2, 3, 4] }) === 2);
check('7炸×2', Game._bombMultFor({ type: 'bomb7', cards: [1, 2, 3, 4, 5, 6, 7] }) === 2);
check('8炸×3', Game._bombMultFor({ type: 'bomb8', cards: [1, 2, 3, 4, 5, 6, 7, 8] }) === 3);

// ---- 全 AI 驱动金币场多局 ----
Game.AUTO_ALL = true;
Game.sync = true;
Game.setGoldMode(true);
Game.init({ render: function () {}, onSettle: function () {}, onLobby: function () {} });
var sumOk = true, levelOk = true, noOver = true, deltaOk = true;
var prevCoins = null;
for (var round = 1; round <= 4; round++) {
  if (round === 1) Game.quickStart(100); else Game.nextRound();
  var sn = Game.snapshot();
  check('金币场 第' + round + '局到结算', sn.phase === 'settle' && sn.lastResult);
  var lr = sn.lastResult;
  var expectMult = { 3: 4, 2: 2, 1: 1 }[lr.combo];
  if (lr.rankMult !== expectMult) deltaOk = false;
  if (lr.delta !== sn.base * sn.mult * lr.rankMult) deltaOk = false;
  if (sn.matchOver || lr.matchOver) noOver = false;
  if (sn.teamLevel[0] !== '2' || sn.teamLevel[1] !== '2') levelOk = false;
  var sum = 0; sn.seats.forEach(function (s) { sum += s.coins; });
  if (sum !== 40000) sumOk = false;   // 初始 4×10000，金币零和
}
check('排名倍数=双下4/一三游2/一四游1 且 delta=底分×倍数×排名倍数', deltaOk);
check('金币场 永不终局', noOver);
check('金币场 级牌固定2不升级', levelOk && Game.snapshot().level === '2');
check('金币场 金币零和=40000', sumOk);

// ---- 晋级场回归：切回后仍走升级赛制 ----
Game.setGoldMode(false);
Game.quickStart(100);
var sn2 = Game.snapshot();
check('晋级场恢复升级赛制', sn2.mode.gold === false);

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
