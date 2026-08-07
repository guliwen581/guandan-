'use strict';
// P1-5 单机积分赛：初始分2000、4局、积分=底分×倍数×排名倍数、不动金币、打完按积分决胜。
var Game = require('../js/game.js');
var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }

Game.AUTO_ALL = true;
Game.sync = true;
Game.setMatchMode(true);
Game.init({ render: function () {}, onSettle: function () {}, onLobby: function () {} });
var coinsBefore = Game.snapshot().seats.map(function (s) { return s.coins; });
check('积分赛 初始分2000×4', Game.snapshot().seats.every(function (s) { return s.score === 2000; }));
check('积分赛 固定4局', Game.snapshot().mode.rounds === 4);

var deltaOk = true, coinSame = true, overAt4 = false, winnerOk = false, levelOk = true;
for (var round = 1; round <= 4; round++) {
  if (round === 1) Game.quickStart(100); else Game.nextRound();
  var sn = Game.snapshot();
  if (sn.phase !== 'settle') break;
  var lr = sn.lastResult;
  if (lr.delta !== sn.base * sn.mult * lr.rankMult) deltaOk = false;
  if (sn.level !== '2') levelOk = false;
  if (round === 4) {
    overAt4 = sn.matchOver;
    var t0 = lr.scores[0] + lr.scores[2], t1 = lr.scores[1] + lr.scores[3];
    winnerOk = sn.matchWinner === (t0 >= t1 ? 0 : 1);
  }
}
check('积分结算=底分×倍数×排名倍数', deltaOk);
check('积分赛 级牌恒为2', levelOk);
check('积分赛 第4局终局', overAt4);
check('终局胜方=积分高的队', winnerOk);
// 金币不随积分赛变动
var coinsAfter = Game.snapshot().seats.map(function (s) { return s.coins; });
check('积分赛 金币不动', JSON.stringify(coinsBefore) === JSON.stringify(coinsAfter));
// 积分总和守恒（初始 4×2000）
var sumScore = Game.snapshot().lastResult.scores.reduce(function (a, b) { return a + b; }, 0);
check('积分零和=8000', sumScore === 8000);

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
