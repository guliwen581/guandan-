'use strict';
// 进贡规则单测：双贡/单贡/无贡、抗贡、领头、进牌除逢人配、还牌<=10 除级牌/配/王。
var Game = require('../js/game.js');
var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }
var _id = 1;
function mk(s, r) { return { id: _id++, s: s, r: r }; }
function BJ() { return mk('W', 'BJ'); }
function hasCard(hand, s, r) { return hand.some(function (c) { return c.s === s && c.r === r; }); }
function maxRank(hand) { var m = null; hand.forEach(function (c) { if (c.s !== 'W' && (!m || c.r > m)) m = c.r; }); return m; }

// ---- 1) 双贡：进大牌者->头游；还牌<=10 且非级牌 ----
var r1 = Game._runTributeTest('2', [0, 2, 1, 3], [
  [mk('S', '2'), mk('S', '3'), mk('S', '7'), mk('D', 'J')], // 头(收): 含级牌2 应被还牌排除
  [mk('S', 'K'), mk('S', '6'), mk('S', '7')],               // 三(进): 最大 K
  [mk('S', '4'), mk('S', '9'), mk('D', 'Q')],               // 二(收)
  [mk('S', 'A'), mk('S', '8'), mk('S', '9')]                // 末(进): 最大 A -> 给头游
], []);
check('双贡两条进贡', r1.tribute && r1.tribute.pairs.length === 2 && !r1.tribute.anti);
check('双贡 大牌(末A)->头游', r1.tribute.pairs[0].giver === 3 && r1.tribute.pairs[0].receiver === 0 && r1.tribute.pairs[0].held.r === 'A');
check('双贡 小牌(三K)->二游', r1.tribute.pairs[1].giver === 1 && r1.tribute.pairs[1].receiver === 2 && r1.tribute.pairs[1].held.r === 'K');
check('双贡 领头=进大牌者(末)', r1.firstLeader === 3);
check('双贡 还牌<=10且排除级牌2', r1.tribute.pairs[0].back.r === '3' && r1.tribute.pairs[1].back.r === '4');
check('双贡 牌张实际移动', hasCard(r1.hands[0], 'S', 'A') && !hasCard(r1.hands[3], 'S', 'A') && hasCard(r1.hands[3], 'S', '3'));

// ---- 2) 单贡：末游->头游，领头=末游 ----
var r2 = Game._runTributeTest('2', [0, 1, 2, 3], [
  [mk('S', '3'), mk('S', '4')], [mk('S', '5')], [mk('S', '6')], [mk('S', 'A'), mk('S', '8')]
], []);
check('单贡仅一条 末->头', r2.tribute && r2.tribute.pairs.length === 1 && r2.tribute.pairs[0].giver === 3 && r2.tribute.pairs[0].receiver === 0);
check('单贡 领头=末游', r2.firstLeader === 3);

// ---- 3) 头末：无进贡，领头=头游 ----
var r3 = Game._runTributeTest('2', [0, 1, 3, 2], [
  [mk('S', '3')], [mk('S', '4')], [mk('S', '5')], [mk('S', '6')]
], []);
check('头末 无进贡', r3.tribute === null);
check('头末 领头=头游', r3.firstLeader === 0);

// ---- 4) 抗贡(文档)：应贡方合计两张逢人配(红桃级牌)，不动牌，领头=头游 ----
var r4 = Game._runTributeTest('2', [0, 2, 1, 3], [
  [mk('S', '3')], [mk('S', 'K')], [mk('S', '4')], [mk('H', '2'), mk('H', '2'), mk('S', 'A')] // 末游持2张逢人配
], []);
check('抗贡 触发(2逢人配)', r4.tribute && r4.tribute.anti === true);
check('抗贡 不动牌(进贡方未给出)', r4.tribute.pairs[0].held == null && r4.hands[3].filter(function (c) { return c.s === 'H' && c.r === '2'; }).length === 2);
check('抗贡 领头=头游', r4.firstLeader === 0);
// ---- 4b) 规则校正：两王不再触发抗贡（旧规则），应正常进贡最大非王牌 ----
var r4b = Game._runTributeTest('2', [0, 2, 1, 3], [
  [mk('S', '3')], [mk('S', 'K')], [mk('S', '4')], [BJ(), BJ(), mk('S', 'A')]
], []);
check('两王不抗贡(按文档)', r4b.tribute && r4b.tribute.anti === false);
check('两王局 大王照常进贡(不再抗贡)', r4b.tribute.pairs[0].held && r4b.tribute.pairs[0].held.r === 'BJ');

// ---- 5) 进贡排除逢人配 ----
var r5 = Game._runTributeTest('5', [0, 1, 2, 3], [
  [mk('S', '3')], [mk('S', '4')], [mk('S', '6')], [mk('H', '5'), mk('S', 'A'), mk('S', '9')] // H5=逢人配，不应进
], []);
check('进贡 除逢人配外最大= A', r5.tribute.pairs[0].held.r === 'A');
check('进贡 逢人配仍留在进贡方手里', hasCard(r5.hands[3], 'H', '5'));

// ---- 6) 真人收贡：进入 tribute 等待还贡 ----
var r6 = Game._runTributeTest('2', [0, 1, 2, 3], [
  [mk('S', '3')], [mk('S', '4')], [mk('S', '6')], [mk('S', 'A')]
], [0]);
check('真人收贡 挂起等待', r6.tribute.pending.indexOf(0) >= 0 && r6.phase === 'tribute');

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
