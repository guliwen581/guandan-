'use strict';
// 多人引擎路径：4 座皆真人，用 snapshotFor(seat)+act(seat,..) 驱动整局/整场，
// 校验视角旋转、动作分发、工厂隔离、多局进贡。
var Cards = require('../js/cards.js');
var Rules = require('../js/rules.js');
var GameDef = require('../js/game.js');
var createGame = GameDef.createGame;

var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }

function legalMove(sn) {
  var cards = sn.seats[0].cards, level = sn.level;
  var all = Rules.generateAllPlays(cards, level);
  if (!sn.top) { var nb = all.filter(function (p) { return !Rules.isBomb(p); }).sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); }); return { ids: (nb[0] || all[0]).cards.map(function (c) { return c.id; }) }; }
  var beats = all.filter(function (p) { return Rules.canBeat(p, sn.top.play); });
  var nb2 = beats.filter(function (p) { return !Rules.isBomb(p); }).sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); });
  return nb2.length ? { ids: nb2[0].cards.map(function (c) { return c.id; }) } : { pass: true };
}
// 还一张合规贡牌（<=10 且非级牌/配/王），与产品 humanTribute 校验一致
function tributeId(cards, level) {
  function elig(c) { return c.s !== 'W' && !(c.s === 'H' && c.r === level) && c.r !== level && Cards.baseValue(c.r) <= 10; }
  var e = cards.filter(elig); var pool = e.length ? e : cards.filter(function (c) { return c.s !== 'W' && !(c.s === 'H' && c.r === level); });
  pool.sort(function (a, b) { return Cards.cmpValue(a.r, level) - Cards.cmpValue(b.r, level); });
  return pool[0].id;
}
// 以全真人视角驱动一局到结算
function driveRound(game) {
  var guard = 0;
  while (guard++ < 40000) {
    var s0 = game.snapshotFor(0);
    if (s0.phase === 'settle') return s0;
    var acted = false;
    for (var s = 0; s < 4; s++) {
      var sn = game.snapshotFor(s);
      if (sn.canDouble) { game.act(s, { type: 'double', yes: false }); acted = true; break; }
      if (sn.canTribute) { var h = sn.seats[0].cards; if (h && h.length) game.act(s, { type: 'tribute', id: tributeId(h, sn.level) }); acted = true; break; }
      if (sn.canPlay) { var mv = legalMove(sn); if (mv.pass) game.act(s, { type: 'pass' }); else game.act(s, { type: 'play', ids: mv.ids }); acted = true; break; }
    }
    if (!acted) break;
  }
  return game.snapshotFor(0);
}

// ---- 工厂隔离 ----
var gA = createGame(), gB = createGame();
gA.init({ render: function () {}, onSettle: function () {}, onLobby: function () {} });
gB.init({ render: function () {}, onSettle: function () {}, onLobby: function () {} });
gA.quickStart(800);
check('工厂隔离：gA开局不影响gB', gB.snapshot().phase === 'lobby' && gA.snapshot().phase !== 'lobby');

// ---- 视角旋转 ----
var g = createGame();
g.init({ render: function () {}, onSettle: function () {}, onLobby: function () {} });
g.sync = true; g.setHumanSeats([0, 1, 2, 3]);
g.quickStart(800);
var v2 = g.snapshotFor(2);
check('snapshotFor(2) 自己在0号位', v2.self === 0 && v2.seats[0].name === g.NAMES[2]);
check('snapshotFor(2) 对家在2号位', v2.seats[2].name === g.NAMES[0]);
check('snapshotFor(2) 队伍等级我方=team(2)', v2.teamLevel[0] === g.snapshot().teamLevel[0]);
check('各视角手牌数总和=108', (function () { var t = 0; for (var s = 0; s < 4; s++) t += g.snapshotFor(s).seats[0].handCount; return t === 108; })());
check('仅自己视角可见自己手牌', (function () { for (var s = 0; s < 4; s++) { var sn = g.snapshotFor(s); if (!sn.seats[0].cards || sn.seats[0].cards.length !== 27) return false; for (var o = 1; o < 4; o++) if (o !== 2 && sn.seats[o].cards) return false; } return true; })());

// ---- 4 真人整局（驱动到结算，校验不变量）----
function playFullMatch(rounds) {
  var gm = createGame();
  gm.init({ render: function () {}, onSettle: function () {}, onLobby: function () {} });
  gm.sync = true; gm.setHumanSeats([0, 1, 2, 3]);
  gm.quickStart(800);
  var played = 0;
  while (played < rounds) {
    var sn = driveRound(gm);
    if (sn.phase !== 'settle') return { ok: false, why: '未到结算', snap: sn, played: played };
    if (sn.finishOrder.length !== 4) return { ok: false, why: 'finishOrder!=4', snap: sn, played: played };
    var sum = 0; for (var s = 0; s < 4; s++) sum += sn.seats[s].coins;
    if (sum !== 40000) return { ok: false, why: '金币不守恒=' + sum, snap: sn, played: played };
    played++;
    if (sn.matchOver) break;
    gm.nextRound();
  }
  return { ok: true, played: played, snap: gm.snapshotFor(0) };
}
var r1 = playFullMatch(1);
check('4真人整局到结算', r1.ok && r1.played === 1);
var r5 = playFullMatch(6); // 多局，含进贡/还贡
check('4真人多局(含进贡)Invariant', r5.ok);
console.log('  4真人驱动局数=' + r5.played + (r5.why ? ' (' + r5.why + ')' : ''));

// ---- 单人+AI 补位（服务器常见：1 真人 3 AI）----
var g1 = createGame();
g1.init({ render: function () {}, onSettle: function () {}, onLobby: function () {} });
g1.sync = true; g1.setHumanSeats([0]); // 仅 0 号真人，其余 AI
g1.quickStart(800);
var gd = 0;
while (g1.snapshotFor(0).phase !== 'settle' && gd++ < 5000) {
  var s0 = g1.snapshotFor(0);
  if (s0.canDouble) { g1.act(0, { type: 'double', yes: false }); continue; }
  if (s0.canTribute) { var hh = s0.seats[0].cards; g1.act(0, { type: 'tribute', id: tributeId(hh, s0.level) }); continue; }
  if (s0.canPlay) { var mv = legalMove(s0); if (mv.pass) g1.act(0, { type: 'pass' }); else g1.act(0, { type: 'play', ids: mv.ids }); continue; }
  break; // AI 已在 schedule 内同步推进
}
check('1真人+3AI 到结算', g1.snapshotFor(0).phase === 'settle');

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
