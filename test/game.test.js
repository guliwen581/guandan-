'use strict';
var Cards = require('../js/cards.js');
var Rules = require('../js/rules.js');
var Game = require('../js/game.js');

var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }

var settled = null, renders = 0;
Game.init({ render: function () { renders++; }, onSettle: function (r) { settled = r; }, onLobby: function () {} });

// ---- A: 全自动同步，100 局死锁/不变量检测 ----
Game.AUTO_ALL = true; Game.sync = true;
var ok = true, comboHist = {};
for (var i = 0; i < 100; i++) {
  settled = null;
  Game.quickStart(800);
  if (!settled) { ok = false; console.log('  第' + i + '局未结算'); break; }
  check('局' + i + ' 走完4人', settled.finishOrder.length === 4);
  var sum = 0; for (var s = 0; s < 4; s++) sum += Game.snapshot().seats[s].coins;
  check('局' + i + ' 金币守恒=40000', sum === 40000);
  comboHist[settled.comboName] = (comboHist[settled.comboName] || 0) + 1;
}
check('100局全部结算', ok);
console.log('  组合分布:', JSON.stringify(comboHist));

// ---- B: 人类出牌路径集成（0号人类，其余AI，同步）----
Game.AUTO_ALL = false; Game.sync = true;
settled = null; renders = 0;
Game.quickStart(800);
// 加倍阶段：人类不加倍
check('开局可加倍', Game.snapshot().canDouble === true);
Game.humanDouble(false);
// 循环人类回合直到结算
function legalHumanMove(snap) {
  var cards = snap.seats[0].cards; // 已排序
  var level = snap.level;
  var all = Rules.generateAllPlays(cards, level);
  if (!snap.top) { // 领出
    var nb = all.filter(function (p) { return !Rules.isBomb(p); }).sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); });
    return (nb[0] || all[0]).cards.map(function (c) { return c.id; });
  }
  var beats = all.filter(function (p) { return Rules.canBeat(p, snap.top.play); });
  var nb2 = beats.filter(function (p) { return !Rules.isBomb(p); }).sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); });
  if (nb2.length) return { play: nb2[0].cards.map(function (c) { return c.id; }) };
  return { pass: true };
}
var guard = 0;
while (Game.snapshot().phase !== 'settle' && guard++ < 5000) {
  var sn = Game.snapshot();
  if (sn.phase === 'double' && sn.canDouble) { Game.humanDouble(false); continue; }
  if (sn.canPlay) {
    var mv = legalHumanMove(sn);
    if (mv.pass) { var p1 = Game.humanPass(); }
    else { var p2 = Game.humanPlay(mv.play || mv); }
  }
  // 若轮到 AI，sync 模式下 schedule 已同步推进；若仍卡 human 但 canPlay=false 且非 double，可能短暂，再转一轮
}
check('人类路径最终结算', Game.snapshot().phase === 'settle' && settled !== null);
check('人类路径步数合理', guard < 5000);
console.log('  人类路径回合循环 guard=' + guard + ', 结算组合=' + (settled && settled.comboName));

// ---- C: 非法出牌被拒 ----
Game.AUTO_ALL = false; Game.sync = false;
Game.quickStart(800);
// 直接尝试在加倍阶段出牌应失败
check('加倍阶段出牌拒绝', Game.humanPlay([12345]) === false);

// ---- 接风：走完者由对家领出 ----
check('接风-走完者对家领出', Game._leaderAfter(0, [true, false, false, false]) === 2);
check('接风-对家也走完则顺延', Game._leaderAfter(0, [true, false, true, false]) === 3);
check('未走完者自己领出', Game._leaderAfter(1, [false, false, false, false]) === 1);

// ---- 一局结束：一队两人走完(双上/双下)即结束，另一队自动三/末游 ----
check('开局4人在场 未结束', Game._testRoundOver([false, false, false, false]) === false);
check('走完1人 未结束', Game._testRoundOver([true, false, false, false]) === false);
check('头+二游分属两队 未结束', Game._testRoundOver([true, true, false, false]) === false);
check('双上(0,2同队走完) -> 结束', Game._testRoundOver([true, false, true, false]) === true);
check('双下(1,3同队走完) -> 结束', Game._testRoundOver([false, true, false, true]) === true);
check('走完3人 -> 结束', Game._testRoundOver([true, true, true, false]) === true);

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
