'use strict';
// AI 整体看牌：不拆炸弹/顺子去追小牌；以及一键理(autoPlan)有效性。
var Cards = require('../js/cards.js');
var Rules = require('../js/rules.js');
var AI = require('../js/ai.js');

var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }
var _id = 1;
function mk(s, r) { return { id: _id++, s: s, r: r }; }
function H() { return Array.prototype.map.call(arguments, function (t) { return t === 'SJ' || t === 'BJ' ? mk('W', t) : mk(t[0], t.slice(1)); }); }
function single(cards, level) { return Rules.classify(cards, level); }

var L = 'K'; // 选 K 为级牌，手牌里没有万能牌(HK 不出现)

// ---- breakNum 基础 ----
var h0 = H('S4', 'H4', 'D4', 'C4', 'H9');
var a0 = AI.analyze(h0, L);
var four4 = h0.slice(0, 4);
check('出四炸本身不记拆炸', AI.breakNum(Rules.classify(four4, L), a0) === 0);
check('拆四炸出单张=拆炸', AI.breakNum(Rules.classify([h0[0]], L), a0) >= 100000);
check('闲张9出单=干净', AI.breakNum(Rules.classify([h0[4]], L), a0) === 0);

// ---- 用户场景：4 炸 + 含多余4的顺子 + 闲张9；跟一张3 ----
// 五张4：前4张预留为炸，第5张(S4b)可与5678成顺；9 为闲张
var h1 = H('S4', 'H4', 'D4', 'C4', 'S4', 'H5', 'D6', 'C7', 'S8', 'H10');
var a1 = AI.analyze(h1, L);
var top3 = single([mk('D', '3')], L);
var beats1 = Rules.generateAllPlays(h1, L).filter(function (p) { return Rules.canBeat(p, top3) && !Rules.isBomb(p); });
var sorted1 = AI.smartSort(h1, L, beats1, false);
function ranksOf(arr, type) { return arr.filter(function (p) { return p.type === type; }).map(function (p) { return p.cards[0].r; }); }
var sSingles = ranksOf(sorted1, 'single');
check('跟3：闲张10排第一(干净)', sSingles[0] === '10' && AI.breakNum(sorted1[0], a1) === 0);
check('跟3：拆结构代价单调(干净<拆顺<拆炸)', (function () { for (var i = 1; i < sorted1.length; i++) if (AI.breakNum(sorted1[i - 1], a1) > AI.breakNum(sorted1[i], a1)) return false; return true; })());
// choose 应出闲张9，而非拆炸/拆顺出4或5
var opp = function (s) { return s === 0 ? 0 : 1; }; // 0,2 一队；1,3 一队 -> self=1 与 top.owner=0 为对手
var ch1 = AI.choose({ hand: h1, level: L, top: { play: top3, owner: 0 }, self: 1, team: opp });
check('choose 跟3 出闲张10(不拆结构)', ch1 && ch1.type === 'single' && ch1.cards[0].r === '10');

// ---- 无闲张 + 小牌3：只能拆结构才压得住 -> 过牌 ----
var h2 = H('S4', 'H4', 'D4', 'C4', 'S4', 'H5', 'D6', 'C7', 'S8'); // 无9
var ch2 = AI.choose({ hand: h2, level: L, top: { play: top3, owner: 0 }, self: 1, team: opp });
check('无闲张跟小牌3 -> 过(不拆炸弹/顺子)', ch2 === null);

// ---- 大牌 Q：宁可拆顺子也要拦住 ----
var h3 = H('S10', 'HJ', 'DQ', 'CK', 'HA'); // 10JQKA 顺子，全是顺子牌
var a3 = AI.analyze(h3, '2');
var topQ = single([mk('C', 'Q')], '2');
var oppT = function (s) { return s & 1; };
var ch3 = AI.choose({ hand: h3, level: '2', top: { play: topQ, owner: 0 }, self: 1, team: oppT });
check('拆顺子拦大牌Q -> 压(非过)', ch3 !== null && ch3.type === 'single' && Cards.cmpValue(ch3.cards[0].r, '2') > 12);
var topSmall = single([mk('C', '3')], '2');
var ch3b = AI.choose({ hand: h3, level: '2', top: { play: topSmall, owner: 0 }, self: 1, team: oppT });
check('只靠拆顺子跟小牌3 -> 过', ch3b === null);

// ---- autoPlan 有效性：炸弹+顺子 被拆出，对子/单张留作余牌 ----
var hA = H('S9', 'H9', 'D9', 'C9', 'S3', 'D4', 'C5', 'S6', 'H7', 'SK', 'DK', 'CA');
var planA = Rules.autoPlan(hA, '2');
function idsOf(groups) { var m = {}; groups.forEach(function (g) { g.ids.forEach(function (i) { m[i] = 1; }); }); return m; }
var idsA = idsOf(planA);
var typesA = planA.map(function (g) { return g.type; });
check('autoPlan 含四炸9 与 顺子', typesA.indexOf('bomb4') >= 0 && typesA.indexOf('straight') >= 0);
check('autoPlan 各组 id 互不相交且为合法牌型', (function () {
  var seen = {};
  for (var i = 0; i < planA.length; i++) {
    var g = planA[i];
    for (var j = 0; j < g.ids.length; j++) { if (seen[g.ids[j]]) return false; seen[g.ids[j]] = 1; }
    var cards = g.ids.map(function (id) { return hA.filter(function (c) { return c.id === id; })[0]; });
    var cl = Rules.classify(cards, '2'); if (!cl || cl.type !== g.type) return false;
  }
  return true;
})());
check('autoPlan 不拆炸弹(顺子组不含9)', (function () {
  var bombIds = {}; planA.filter(function (g) { return g.type === 'bomb4'; }).forEach(function (g) { g.ids.forEach(function (i) { bombIds[i] = 1; }); });
  return planA.filter(function (g) { return g.type !== 'bomb4'; }).every(function (g) { return g.ids.every(function (i) { return !bombIds[i]; }); });
})());
check('autoPlan 余牌=对K+单A(未入组)', (function () { var used = idsOf(planA); var rem = hA.filter(function (c) { return !used[c.id]; }); return rem.length === 3; })());

// ---- autoPlan：5张4 -> 整组五炸（不再拆成 4+1）----
var hB = H('S4', 'H4', 'D4', 'C4', 'S4', 'H5', 'D6', 'C7', 'S8');
var planB = Rules.autoPlan(hB, '2');
var tB = planB.map(function (g) { return g.type; });
check('autoPlan 5张4 = 五炸(整组,不拆4+1)', tB.indexOf('bomb5') >= 0 && tB.indexOf('bomb4') < 0 && tB.indexOf('straight') < 0);
check('autoPlan 五炸含全部5张4 且各组不相交', (function () {
  var b5 = planB.filter(function (g) { return g.type === 'bomb5'; })[0];
  if (!b5 || b5.ids.length !== 5) return false;
  var cnt = {}; planB.forEach(function (g) { g.ids.forEach(function (i) { cnt[i] = (cnt[i] || 0) + 1; }); });
  for (var k in cnt) if (cnt[k] > 1) return false;
  return b5.ids.every(function (i) { return hB.filter(function (c) { return c.id === i; })[0].r === '4'; });
})());

// ---- autoPlan 万能牌只补同花顺/顺子，不凑假连对 ----
function cardById(h, id) { return h.filter(function (c) { return c.id === id; })[0]; }
function groupHasWild(h, g) { return g.ids.some(function (i) { return Cards.isWild(cardById(h, i), '2'); }); }
// 4 黑桃连 + 1 万能 -> 应成同花顺(含万能)，且不应出现"万能凑的连对"
var hC = H('S3', 'S4', 'S5', 'S6', 'H2', 'HA', 'CK', 'CQ', 'H9', 'C8', 'S8', 'C5');
var planC = Rules.autoPlan(hC, '2');
check('autoPlan 4同色+万能 -> 同花顺(含万能)', planC.some(function (g) { return g.type === 'sf' && g.ids.length === 5 && groupHasWild(hC, g); }));
check('autoPlan 不用万能凑连对/钢板/三带二', planC.filter(function (g) { return g.type === 'pairs' || g.type === 'plate' || g.type === 'triple2'; }).every(function (g) { return !groupHasWild(hC, g); }));
// 两万能 + 4 黑桃连：旧逻辑会用两万能凑假连对吃掉黑桃；新逻辑应成同花顺(用1万能)，另一万能留作余牌
var hD = H('S3', 'S4', 'S5', 'S6', 'H2', 'H2', 'HA', 'CK', 'CQ', 'H9', 'C8', 'S8', 'C5');
var planD = Rules.autoPlan(hD, '2');
check('autoPlan 双万能不凑假连对，仍成同花顺', planD.some(function (g) { return g.type === 'sf' && groupHasWild(hD, g); }) && planD.filter(function (g) { return g.type === 'pairs' || g.type === 'plate'; }).every(function (g) { return !groupHasWild(hD, g); }));
check('autoPlan 同花顺只用1张万能', planD.filter(function (g) { return g.type === 'sf'; }).every(function (g) { return g.ids.filter(function (i) { return Cards.isWild(cardById(hD, i), '2'); }).length <= 1; }));

// ---- 跟一张：三同张受保护，宁可出闲张（别人出4 应出8 不拆666）----
var oppT2 = function (s) { return s & 1; };
var hT = H('S6', 'H6', 'D6', 'S9', 'H9', 'S8', 'CK'); // 666+99 三带二 + 闲张8/K
var topSingle4 = Rules.classify([mk('D', '4')], '2');
var beatsT = Rules.generateAllPlays(hT, '2').filter(function (p) { return Rules.canBeat(p, topSingle4) && !Rules.isBomb(p); });
var sT = AI.smartSort(hT, '2', beatsT, false);
check('跟4 拆三同张6受罚、闲张8排第一', AI.breakNum(Rules.classify([hT[0]], '2'), AI.analyze(hT, '2')) > 0 && sT[0].type === 'single' && sT[0].cards[0].r === '8');
check('choose 跟4 出闲张8 不拆666', (function () { var c = AI.choose({ hand: hT, level: '2', top: { play: topSingle4, owner: 0 }, self: 1, team: oppT2 }); return c && c.type === 'single' && c.cards[0].r === '8'; })());
check('整出三同张666 不算拆', AI.breakNum(Rules.classify([hT[0], hT[1], hT[2]], '2'), AI.analyze(hT, '2')) === 0);
// ---- 跟一对：三带二的对子部分不受保护，最小单对优先（别人出对7 应出99）----
var hP = H('S6', 'H6', 'D6', 'S9', 'H9', 'SQ', 'HQ'); // 66699 三带二 + QQ
var topPair7 = Rules.classify([mk('D', '7'), mk('C', '7')], '2');
var beatsP = Rules.generateAllPlays(hP, '2').filter(function (p) { return Rules.canBeat(p, topPair7) && !Rules.isBomb(p); });
var sP = AI.smartSort(hP, '2', beatsP, false);
check('跟7 99(三带二对子部分)干净且最小', sP[0].type === 'pair' && sP[0].cards[0].r === '9');
check('choose 跟7 出99', (function () { var c = AI.choose({ hand: hP, level: '2', top: { play: topPair7, owner: 0 }, self: 1, team: oppT2 }); return c && c.type === 'pair' && c.rank === 9; })());
// ---- 跟一对：三同张"拆对"不罚，最小单对优先（别人出对5，有666 也应出66）----
var hQ = H('S6', 'H6', 'D6', 'S9', 'H9', 'SK', 'HK'); // 666 + 99 + KK
var topPair5 = Rules.classify([mk('D', '5'), mk('C', '5')], '2');
check('三同张拆对66 不罚', AI.breakNum(Rules.classify([hQ[0], hQ[1]], '2'), AI.analyze(hQ, '2')) === 0);
var beatsQ = Rules.generateAllPlays(hQ, '2').filter(function (p) { return Rules.canBeat(p, topPair5) && !Rules.isBomb(p); });
check('跟5 最小单对=66', AI.smartSort(hQ, '2', beatsQ, false)[0].cards[0].r === '6');
check('choose 跟5 出66(拆三同张)', (function () { var c = AI.choose({ hand: hQ, level: '2', top: { play: topPair5, owner: 0 }, self: 1, team: oppT2 }); return c && c.type === 'pair' && c.rank === 6; })());
check('跟4 仍不拆666 出单6(出闲张9)', (function () { var c = AI.choose({ hand: hQ, level: '2', top: { play: Rules.classify([mk('D', '4')], '2'), owner: 0 }, self: 1, team: oppT2 }); return c && c.type === 'single' && c.cards[0].r === '9'; })());

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
