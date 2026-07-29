'use strict';
/*
 * counter.test.js —— 记牌器（buildCounter）回归：
 *  修复前 counter 用"全部4家手牌+弃牌"相减，恒为 0（功能失效，C2）。
 *  修复后按 viewer 视角算"未见牌" = 总张 − 自己手牌 − 已弃牌（= 其余三家手中剩余）。
 */
var Cards = require('../js/cards.js');
var Game = require('../js/game.js').createGame();

var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }
function sum(o) { var t = 0; for (var k in o) t += o[k]; return t; }

Game.init({});

// 多局发牌后即校验：discard 为空时，counter 总和应=81（其余三家 27*3），
// 且每点剩余 = 总张 − 自己持有；所有值非负。
var RANKS = Cards.RANKS.concat(['SJ', 'BJ']);
var TOTAL = {}; Cards.RANKS.forEach(function (r) { TOTAL[r] = 8; }); TOTAL.SJ = 2; TOTAL.BJ = 2;
for (var i = 0; i < 30; i++) {
  Game.quickStart(800);
  var snap = Game.snapshot();
  var counter = snap.counter, mine = snap.seats[0].cards;
  check('局' + i + ' counter总和=81', sum(counter) === 81);
  var hold = {}; mine.forEach(function (c) { hold[c.r] = (hold[c.r] || 0) + 1; });
  var perOk = RANKS.every(function (r) { return counter[r] === TOTAL[r] - (hold[r] || 0); });
  check('局' + i + ' 每点剩余=总张-自己持有', perOk);
  check('局' + i + ' counter全部非负', RANKS.every(function (r) { return counter[r] >= 0; }));
}

// 视角一致性：snapshotFor(任意viewer) 的 counter 总和同样=81（各看各的未见牌）
Game.quickStart(800);
var v1 = Game.snapshotFor(1), v3 = Game.snapshotFor(3);
check('1号视角 counter总和=81', sum(v1.counter) === 81);
check('3号视角 counter总和=81', sum(v3.counter) === 81);

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
