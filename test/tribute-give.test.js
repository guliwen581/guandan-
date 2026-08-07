'use strict';
// P0-1 进贡选牌单测：并列最大牌可任选其一；非候选牌拒绝；超时系统代选；快照视角字段；双贡两真人依次选。
var Game = require('../js/game.js');
var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }
var _id = 1;
function mk(s, r) { return { id: _id++, s: s, r: r }; }
function hasCard(hand, s, r) { return hand.some(function (c) { return c.s === s && c.r === r; }); }

// ---- A) 单贡 · 真人进贡方有并列最大(A♠ A♦)：挂起等选，牌未动 ----
var rA = Game._runTributeTest('2', [0, 1, 2, 3], [
  [mk('S', '3')], [mk('S', '4')], [mk('S', '6')],
  [mk('S', 'A'), mk('D', 'A'), mk('S', '9')]
], [3]);
check('A 挂起等进贡选牌', rA.phase === 'tribute' && rA.tribute.pending.indexOf(3) >= 0 && rA.tribute.pendingKinds[3] === 'give');
check('A 候选=两张A', rA.tribute.pairs[0].candidates.length === 2);
check('A 牌尚未移动', rA.tribute.pairs[0].held == null && rA.hands[3].length === 3 && rA.hands[0].length === 1);

// 非法选择：9 不在候选中
check('A 选非候选牌被拒', Game.humanTributeGiveAt(3, rA.hands[3][2].id) === false && rA.hands[3].length === 3);

// 快照视角：进贡方看到 tributeKind=give + 候选 id；收贡方不受影响
var snG = Game.snapshotFor(3), snR = Game.snapshotFor(0);
check('A 快照-进贡方 kind=give', snG.canTribute && snG.tribute.tributeKind === 'give' && snG.tribute.pendingGiver === true);
check('A 快照-候选id下发', Array.isArray(snG.tribute.giveCandidates) && snG.tribute.giveCandidates.length === 2);
check('A 快照-收贡方无进贡待办', snR.tribute.tributeKind == null && snR.tribute.pendingGiver === false);

// 合法选择 A♦ → 牌移动到收贡方，AI 收贡者自动还贡，流程推进
var aD = rA.hands[3].filter(function (c) { return c.s === 'D'; })[0];
check('A act路由 tributeGive', Game.act(3, { type: 'tributeGive', id: aD.id }) === true);
check('A 选后牌已移动', hasCard(rA.hands[0], 'D', 'A') && !hasCard(rA.hands[3], 'D', 'A'));
check('A 收贡方自动还贡(3)', rA.tribute.pairs[0].back && rA.tribute.pairs[0].back.r === '3');
check('A 流程离开tribute', Game.snapshot().phase !== 'tribute' && rA.tribute.pending.length === 0);

// ---- B) 唯一最大牌：自动进贡，不挂起 ----
var rB = Game._runTributeTest('2', [0, 1, 2, 3], [
  [mk('S', '3')], [mk('S', '4')], [mk('S', '6')],
  [mk('S', 'A'), mk('S', '9')]
], [3]);
check('B 唯一最大自动进贡', rB.tribute.pairs[0].held && rB.tribute.pairs[0].held.r === 'A' && rB.tribute.pending.length === 0);
check('B 不进tribute等待', rB.phase !== 'tribute');

// ---- C) 超时：系统代选候选第一张 ----
var rC = Game._runTributeTest('2', [0, 1, 2, 3], [
  [mk('S', '3')], [mk('S', '4')], [mk('S', '6')],
  [mk('S', 'A'), mk('D', 'A'), mk('S', '9')]
], [3]);
Game.humanTimeoutAt(3);
check('C 超时代选最大牌', hasCard(rC.hands[0], 'S', 'A') && !hasCard(rC.hands[3], 'S', 'A'));
check('C 超时后流程推进', Game.snapshot().phase !== 'tribute');

// ---- D) 双贡 · 两个进贡方都是真人：各自挂起，依次选完才推进 ----
var rD = Game._runTributeTest('2', [0, 2, 1, 3], [
  [mk('S', '3'), mk('S', '8')], [mk('S', 'K'), mk('D', 'K'), mk('S', '5')],
  [mk('S', '4'), mk('S', '9')], [mk('S', 'A'), mk('D', 'A'), mk('S', '7')]
], [1, 3]);
check('D 双贡双真人皆挂起', rD.phase === 'tribute' && rD.tribute.pending.length === 2 && rD.tribute.pendingKinds[1] === 'give' && rD.tribute.pendingKinds[3] === 'give');
var dA = rD.hands[3].filter(function (c) { return c.s === 'D' && c.r === 'A'; })[0];
check('D 末游先选完仍挂起(等三游)', Game.humanTributeGiveAt(3, dA.id) === true && rD.phase === 'tribute' && rD.tribute.pending.length === 1);
var dK = rD.hands[1].filter(function (c) { return c.s === 'D' && c.r === 'K'; })[0];
check('D 三游选完全部推进', Game.humanTributeGiveAt(1, dK.id) === true && Game.snapshot().phase !== 'tribute');
check('D 大贡A->头游 小贡K->二游', hasCard(rD.hands[0], 'D', 'A') && hasCard(rD.hands[2], 'D', 'K'));
check('D 领头=进大牌者(末游)', Game._testFirstLeader() === 3);
check('D 双收贡AI自动还', rD.tribute.pairs[0].back && rD.tribute.pairs[1].back);

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
