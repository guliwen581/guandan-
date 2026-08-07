'use strict';
// P1-2 记牌器同花顺可能性提示：某花色每个 5 连窗都至少有一个点数被打光(2张)才判 false。
var Game = require('../js/game.js');
var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }
var H = Game._computeSfHint;

// 空弃牌：四花色都可能
var h0 = H([], []);
check('空弃牌 全可能', h0.S && h0.H && h0.C && h0.D);

// 打光 黑桃5/8/J 各两张：黑桃所有窗口都被截断
var r = [], s = [];
['5', '8', 'J'].forEach(function (rk) { for (var i = 0; i < 2; i++) { r.push(rk); s.push('S'); } });
var h1 = H(r, s);
check('黑桃 5/8/J 打光 → 不可能', h1.S === false);
check('其余花色不受影响', h1.H && h1.C && h1.D);

// 只打光一张黑桃5(1张)：仍可能
var h2 = H(['5'], ['S']);
check('单张5未打光 仍可能', h2.S === true);

// 打光红桃A两张 + 红桃10两张：窗口 A2345(缺A)、678910(缺10)、78910J、8910JQ、910JQK、10JQKA 被截；但 23456..56789 仍可能
var r3 = ['A', 'A', '10', '10'], s3 = ['H', 'H', 'H', 'H'];
var h3 = H(r3, s3);
check('红桃缺A和10 仍有中间窗口', h3.H === true);

// 打光红桃 5、J、10 各两张 → 红桃全窗口截断
var r4 = [], s4 = [];
['5', 'J', '10'].forEach(function (rk) { for (var i = 0; i < 2; i++) { r4.push(rk); s4.push('H'); } });
var h4 = H(r4, s4);
check('红桃 5/10/J 打光 → 不可能', h4.H === false);

// 快照集成：金币场驱动一局后 sfHint 存在
Game.AUTO_ALL = true; Game.sync = true;
Game.init({ render: function () {}, onSettle: function () {}, onLobby: function () {} });
Game.quickStart(100);
var sn = Game.snapshot();
check('快照含 sfHint', sn.sfHint && typeof sn.sfHint.S === 'boolean');

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
