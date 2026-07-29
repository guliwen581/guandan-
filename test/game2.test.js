'use strict';
var Cards = require('../js/cards.js');
var Rules = require('../js/rules.js');
var AI = require('../js/ai.js');
var Game = require('../js/game.js');

var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }
function li(r) { return Cards.RANKS.indexOf(r); }

// 渲染桩：在加倍阶段（进贡已结算、尚未出牌）每座位必为27张
var doubleBad = 0, last = null;
var UI = { render: function (s) { if (s.phase === 'double' && !s.seats.every(function (x) { return x.handCount === 27; })) doubleBad++; last = s; }, onSettle: function () {}, onLobby: function () {} };
Game.init(UI);

// ---- A: 全自动完整比赛 ----
Game.AUTO_ALL = true; Game.sync = true;
Game.quickStart(800);
var prevTL = null, roundSeen = 0, consBad = 0;
function invariants(s) {
  roundSeen = s.roundNo;
  var sumH = s.seats.reduce(function (a, x) { return a + x.handCount; }, 0);
  if (sumH + s.discarded !== 108) consBad++;          // 牌不丢
  if (prevTL) for (var t = 0; t < 2; t++) if (li(s.teamLevel[t]) < li(prevTL[t])) consBad++; // 等级单调
  prevTL = s.teamLevel.slice();
}
invariants(Game.snapshot());
var guard = 0;
while (!Game.snapshot().matchOver && guard++ < 400) { Game.nextRound(); invariants(Game.snapshot()); }
var fin = Game.snapshot();
check('全自动比赛产生胜者', fin.matchOver === true && (fin.matchWinner === 0 || fin.matchWinner === 1));
check('胜者等级停在A', li(fin.teamLevel[fin.matchWinner]) === li('A'));
check('每局加倍阶段人手27张(进贡守恒)', doubleBad === 0);
check('整场牌张守恒+等级单调', consBad === 0);
check('进行了多局', roundSeen >= 2);
console.log('  全自动比赛局数=' + roundSeen + ' 胜队=' + fin.matchWinner + ' 等级=' + JSON.stringify(fin.teamLevel));

// ---- B: 人类还贡交互（人类机器人，记录是否触发并正确处理 tribute）----
Game.AUTO_ALL = false; Game.sync = true;
doubleBad = 0;
// 弱化两对手（跟牌总过、领出只出最小单张），让人类+对家稳压 → 人类成收贡方
var _orig = AI.choose;
AI.choose = function (ctx) {
  if (ctx.self === 1 || ctx.self === 3) {
    if (ctx.top) return null;
    var s = Rules.generateAllPlays(ctx.hand, ctx.level).filter(function (p) { return p.type === 'single'; });
    s.sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); });
    return s[0] || _orig(ctx);
  }
  return _orig(ctx);
};
function move(sn) {
  var cards = sn.seats[0].cards, level = sn.level, all = Rules.generateAllPlays(cards, level), legal;
  if (!sn.top) legal = all.filter(function (p) { return !Rules.isBomb(p); });
  else legal = all.filter(function (p) { return Rules.canBeat(p, sn.top.play); });
  legal.sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); });
  return legal.length ? { play: legal[0].cards.map(function (c) { return c.id; }) } : { pass: true };
}
var sawTribute = 0, tributeOk = true, matches = 0;
function runHumanMatch() {
  matches++; Game.quickStart(800);
  var g = 0;
  while (g++ < 600) {
    var sn = Game.snapshot();
    if (sn.phase === 'double' && !sn.seats.every(function (x) { return x.handCount === 27; })) doubleBad++;
    if (sn.matchOver) return;
    if (sn.canTribute) {
      sawTribute++;
      // 还一张：选最小牌
      var hand = sn.seats[0].cards, lv = sn.level, lo = hand[0];
      for (var i = 1; i < hand.length; i++) if (Cards.cmpValue(hand[i].r, lv) < Cards.cmpValue(lo.r, lv)) lo = hand[i];
      if (!Game.humanTribute(lo.id)) tributeOk = false;
      continue;
    }
    if (sn.canDouble) { Game.humanDouble(false); continue; }
    if (sn.canPlay) { var mv = move(sn); if (mv.pass) Game.humanPass(); else Game.humanPlay(mv.play); continue; }
    if (sn.phase === 'settle') { if (sn.matchOver) return; Game.nextRound(); continue; }
    break; // 不该到这儿
  }
}
while (sawTribute === 0 && matches < 4) runHumanMatch();
check('人类路径触发过还贡', sawTribute >= 1);
check('人类还贡调用均成功', tributeOk);
check('人类路径进贡后仍27张', doubleBad === 0);
console.log('  人类比赛场数=' + matches + ' 触发还贡=' + sawTribute);

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
