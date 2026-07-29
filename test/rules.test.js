'use strict';
var Cards = require('../js/cards.js');
var Rules = require('../js/rules.js');

var fails = 0, passes = 0;
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function check(name, cond) {
  if (cond) { passes++; }
  else { fails++; console.log('  ✗ FAIL: ' + name); }
}
function c(s, r) { return { id: Math.random(), s: s, r: r }; }
// 简写构造：'H2' -> {s:'H',r:'2'}; 'SJ'/'BJ' 王
function cc(tok) {
  if (tok === 'SJ' || tok === 'BJ') return { id: Math.random(), s: 'W', r: tok };
  return { id: Math.random(), s: tok[0], r: tok.slice(1) };
}
function hand() { return Array.prototype.map.call(arguments, cc); }
function typeOf(cards, level) { var p = Rules.classify(cards, level); return p ? p.type : null; }
function topOf(cards, level) { var p = Rules.classify(cards, level); return p ? p.rank : null; }

console.log('--- 基础 ---');
var deck = Cards.makeDeck();
check('牌数108', deck.length === 108);
check('cmpValue 级牌=15', Cards.cmpValue('2', '2') === 15);
check('cmpValue A=14', Cards.cmpValue('A', '2') === 14);
check('isWild H2@level2', Cards.isWild(cc('H2'), '2') === true);
check('isWild S2@level2 false', Cards.isWild(cc('S2'), '2') === false);

var L = '2';
console.log('--- 牌型识别 (level=2) ---');
check('单张', typeOf(hand('S3'), L) === 'single');
check('对子', typeOf(hand('S5', 'H5'), L) === 'pair');
check('三同张', typeOf(hand('S5', 'H5', 'D5'), L) === 'triple');
check('三带二', typeOf(hand('S5', 'H5', 'D5', 'S9', 'H9'), L) === 'triple2');
check('顺子', typeOf(hand('S3', 'H4', 'D5', 'C6', 'S7'), L) === 'straight');
check('23456=顺子(2可入序,级牌按自然点)', typeOf(hand('S2', 'H3', 'D4', 'C5', 'S6'), L) === 'straight');
check('10JQKA=顺子(A可作大)', typeOf(hand('S10', 'HJ', 'DQ', 'CK', 'SA'), L) === 'straight');
check('连对', typeOf(hand('S3', 'H3', 'D4', 'C4', 'S5', 'H5'), L) === 'pairs');
check('钢板', typeOf(hand('S3', 'H3', 'D3', 'C4', 'S4', 'H4'), L) === 'plate');
check('四炸', typeOf(hand('S5', 'H5', 'D5', 'C5'), L) === 'bomb4');
check('五炸', typeOf(hand('S5', 'H5', 'D5', 'C5', 'S9'), L) === null); // 不同点不是炸
check('天王炸', typeOf(hand('SJ', 'SJ', 'BJ', 'BJ'), L) === 'rocket');
check('同花顺', typeOf(hand('H3', 'H4', 'H5', 'H6', 'H7'), L) === 'sf');

console.log('--- 万能牌替补 (level=2, 万能=H2) ---');
check('万能+单=对子', typeOf(hand('H2', 'S5'), L) === 'pair');
check('万能补顺子', typeOf(hand('H2', 'S3', 'H4', 'D5', 'C6'), L) === 'straight');
check('万能补四炸', typeOf(hand('H2', 'S5', 'H5', 'D5'), L) === 'bomb4');
check('万能当自身=单张15', topOf(hand('H2'), L) === 15);
check('两万能=对级牌', typeOf(hand('H2', 'H2'), L) === 'pair' && topOf(hand('H2', 'H2'), L) === 15);

console.log('--- 级牌升级比较 ---');
check('单级牌>单A', Rules.canBeat(Rules.classify(hand('S2'), L), Rules.classify(hand('SA'), L)) === true);
check('对级牌>对A', Rules.canBeat(Rules.classify(hand('S2', 'H2'), L), Rules.classify(hand('SA', 'HA'), L)) === true);

console.log('--- 比牌规则 ---');
function P(cards) { return Rules.classify(cards, L); }
check('对6>对5', Rules.canBeat(P(hand('S6', 'H6')), P(hand('S5', 'H5'))) === true);
check('对5!>对6', Rules.canBeat(P(hand('S5', 'H5')), P(hand('S6', 'H6'))) === false);
check('顺48>顺37', Rules.canBeat(P(hand('S4', 'H5', 'D6', 'C7', 'S8')), P(hand('S3', 'H4', 'D5', 'C6', 'S7'))) === true);
check('炸压单', Rules.canBeat(P(hand('S9', 'H9', 'D9', 'C9')), P(hand('SA'))) === true);
check('单!压炸', Rules.canBeat(P(hand('SA')), P(hand('S9', 'H9', 'D9', 'C9'))) === false);
check('五炸>四炸', Rules.canBeat(P(hand('S3', 'H3', 'D3', 'C3', 'S3')), P(hand('S9', 'H9', 'D9', 'C9'))) === true);
check('同花顺>六炸(文档主规则)', Rules.canBeat(P(hand('H3', 'H4', 'H5', 'H6', 'H7')), P(hand('S8', 'H8', 'D8', 'C8', 'S8', 'H8'))) === true);
check('同花顺>五炸', Rules.canBeat(P(hand('H3', 'H4', 'H5', 'H6', 'H7')), P(hand('S8', 'H8', 'D8', 'C8', 'S8'))) === true);
check('七炸>同花顺', Rules.canBeat(P(hand('S3', 'H3', 'D3', 'C3', 'S3', 'H3', 'D3')), P(hand('H5', 'H6', 'H7', 'H8', 'H9'))) === true);
check('天王炸>七炸', Rules.canBeat(P(hand('SJ', 'SJ', 'BJ', 'BJ')), P(hand('S3', 'H3', 'D3', 'C3', 'S3', 'H3', 'D3'))) === true);
check('九炸(8+万能)', typeOf(hand('S3', 'H3', 'D3', 'C3', 'S3', 'H3', 'D3', 'C3', 'H2'), L) === 'bomb9');
check('十炸(8+2万能)', typeOf(hand('S3', 'H3', 'D3', 'C3', 'S3', 'H3', 'D3', 'C3', 'H2', 'H2'), L) === 'bomb10');
check('十炸>九炸>八炸', Rules.canBeat(P(hand('S3', 'H3', 'D3', 'C3', 'S3', 'H3', 'D3', 'C3', 'H2', 'H2')), P(hand('S3', 'H3', 'D3', 'C3', 'S3', 'H3', 'D3', 'C3', 'H2'))) && Rules.canBeat(P(hand('S3', 'H3', 'D3', 'C3', 'S3', 'H3', 'D3', 'C3', 'H2')), P(hand('S3', 'H3', 'D3', 'C3', 'S3', 'H3', 'D3', 'C3'))));
check('逢人配不能当王', typeOf(hand('SJ', 'SJ', 'H2'), L) === null);
check('不同类型非炸互不压', Rules.canBeat(P(hand('S6', 'H6')), P(hand('S5', 'H5', 'D5'))) === false);

console.log('--- 生成 & 找压牌 ---');
var h1 = hand('S3', 'H3', 'D3', 'C3', 'S5', 'H7', 'D9', 'CJ', 'SQ');
var all = Rules.generateAllPlays(h1, L);
check('生成非空', all.length > 0);
check('含四炸3', all.some(function (p) { return p.type === 'bomb4' && p.rank === Cards.cmpValue('3', L); }));
var lastSingleA = P(hand('SA'));
var beat = Rules.findBeating(h1, lastSingleA, L);
check('找得到压A的牌', beat.length > 0 && beat.every(function (p) { return Rules.canBeat(p, lastSingleA); }));

console.log('--- 27张手牌压测 ---');
var big = Cards.makeDeck(); Cards.shuffle(big); var h27 = big.slice(0, 27);
var t0 = Date.now(); var g27 = Rules.generateAllPlays(h27, '7'); var dt = Date.now() - t0;
check('27张生成不抛错且<300ms', Array.isArray(g27) && dt < 300);
console.log('  (27张可出牌型数=' + g27.length + ', 耗时=' + dt + 'ms)');

console.log('--- 理牌 organize（复刻原版截图手牌）---');
var hand2 = [
  c('W', 'SJ'),
  c('C', '2'), c('H', '2'), c('S', '2'),
  c('S', 'A'),
  c('C', 'K'), c('S', 'K'),
  c('S', 'J'),
  c('D', '10'), c('C', '10'),
  c('H', '9'), c('H', '9'), c('S', '9'), c('S', '9'),
  c('D', '8'), c('D', '8'), c('H', '8'), c('S', '8'),
  c('S', '7'),
  c('C', '6'), c('C', '6'),
  c('C', '5'),
  c('D', '3'), c('D', '3'), c('C', '3'), c('C', '3'), c('H', '3')
];
function colByRank(org, r) { return org.columns.filter(function (x) { return !x.locked && x.cards[0].r === r; })[0]; }
var org = Rules.organize(hand2, '2', []);
check('默认12栏', org.columns.length === 12);
check('默认顺序=王,级牌,A..降序', org.columns.map(function (x) { return x.cards[0].r; }).join(',') === 'SJ,2,A,K,J,10,9,8,7,6,5,3');
check('默认万能牌在2栏内(3张)', colByRank(org, '2').cards.length === 3);
check('默认9=四炸 8=四炸 3=五炸', colByRank(org, '9').chip === '四炸' && colByRank(org, '8').chip === '四炸' && colByRank(org, '3').chip === '五炸');
check('默认对子/单张无标签', colByRank(org, 'K').chip === null && colByRank(org, 'A').chip === null && colByRank(org, '6').chip === null);
// 锁定梅花同花顺(6C,5C,万能2H,3C)
var wild = hand2.filter(function (x) { return x.s === 'H' && x.r === '2'; })[0];
var c6 = hand2.filter(function (x) { return x.s === 'C' && x.r === '6'; })[0];
var c5 = hand2.filter(function (x) { return x.s === 'C' && x.r === '5'; })[0];
var c3 = hand2.filter(function (x) { return x.s === 'C' && x.r === '3'; })[0];
var org2 = Rules.organize(hand2, '2', [{ ids: [c6.id, c5.id, wild.id, c3.id], type: 'sf', label: '同花顺' }]);
check('锁定栏在最左且带标签', org2.columns[0].locked === true && org2.columns[0].chip === '同花顺' && org2.columns[0].cards.length === 4);
check('锁后3变四炸、6变单张、5消失、2剩2张', colByRank(org2, '3').cards.length === 4 && colByRank(org2, '3').chip === '四炸' && colByRank(org2, '6').cards.length === 1 && colByRank(org2, '6').chip === null && colByRank(org2, '5') === undefined && colByRank(org2, '2').cards.length === 2);
// 锁定同花顺里万能牌应显示成它所补的点数，整栏连序
var he = [c('S', '2'), c('H', '2'), c('S', '4'), c('S', '5'), c('S', '6')];
var orgE = Rules.organize(he, '2', [{ ids: he.map(function (x) { return x.id; }), type: 'sf', label: '同花顺' }]);
var colE = orgE.columns[0];
check('锁定同花顺万能牌补位显示且连序2-6', colE.cards.map(function (x) { return x.asRank || x.r; }).join(',') === '2,3,4,5,6' && colE.cards[1].s === 'H' && colE.cards[1].r === '2' && colE.cards[1].asRank === '3');
check('锁定同花顺万能牌按清一色花色显示', colE.cards[1].asSuit === 'S');
// 用户场景：打7，万能=红心7，配 4 张方块 -> 万能应显示成方块7，整栏清一色
var hd = [c('H', '7'), c('D', '8'), c('D', '9'), c('D', '10'), c('D', 'J')];
var colD = Rules.organize(hd, '7', [{ ids: hd.map(function (x) { return x.id; }), type: 'sf', label: '同花顺' }]).columns[0];
check('万能+4方块 万能显为方块7 且整栏方块', colD.cards[0].asRank === '7' && colD.cards[0].asSuit === 'D' && colD.cards[0].s === 'H' && colD.cards.map(function (x) { return x.asSuit || x.s; }).every(function (s) { return s === 'D'; }));
// 杂色顺子：万能不按某花色显示（asSuit 缺省）
var hm = [c('H', '7'), c('S', '8'), c('H', '9'), c('D', '10'), c('C', 'J')];
var colM = Rules.organize(hm, '7', [{ ids: hm.map(function (x) { return x.id; }), type: 'straight', label: '顺子' }]).columns[0];
check('杂色顺子 万能无 asSuit 仅补点', !colM.cards[0].asSuit && colM.cards[0].asRank === '7');
// 残留锁防护：lock 含"已不在手中的牌"(缺牌) -> 整条 lock 失效，现存牌落回点数栏，不再错标顺子
var org3 = Rules.organize(hand2, '2', [{ ids: [c6.id, c5.id, wild.id, c3.id, 99999], type: 'straight', label: '顺子' }]);
check('缺牌残留锁被丢弃(无锁定栏)', org3.columns.every(function (x) { return !x.locked; }));
check('缺牌残留锁的牌落回点数栏(5栏再现)', colByRank(org3, '5') !== undefined && colByRank(org3, '6') !== undefined);
check('全在手的lock原样保留(契约不变)', Rules.organize(hand2, '2', [{ ids: [c6.id, c5.id, wild.id, c3.id], type: 'sf', label: '同花顺' }]).columns[0].locked === true);

console.log('--- 同花顺快捷键 findSF ---');
var w = c('H', '2');
var hsf = [w, c('H', '7'), c('H', '8'), c('H', '9'), c('H', '10'), c('D', '3'), c('D', '8'), c('S', '5'), c('C', '9')];
var sfH = Rules.findSF(hsf, '2', 'H');
check('红桃有同花顺(万能补位)', sfH && sfH.length === 5 && sfH.indexOf(w) >= 0 && sfH.filter(function (x) { return x !== w; }).every(function (x) { return x.s === 'H'; }));
check('方/黑/草无同花顺', Rules.findSF(hsf, '2', 'D') === null && Rules.findSF(hsf, '2', 'S') === null && Rules.findSF(hsf, '2', 'C') === null);
check('无万能但5连=有', Rules.findSF([c('H', '7'), c('H', '8'), c('H', '9'), c('H', '10'), c('H', 'J')], '2', 'H') !== null);
check('无万能且仅4连=无', Rules.findSF([c('H', '7'), c('H', '8'), c('H', '9'), c('H', '10'), c('D', '2')], '2', 'H') === null);
check('万能已用则红桃凑不出', Rules.findSF(hsf.filter(function (x) { return x !== w; }), '2', 'H') === null);

console.log('--- 掉头顺 A 当 1 (A2345 / AA2233 / AAA222) ---');
check('A2345=顺子(level6)', typeOf(hand('SA', 'S2', 'H3', 'D4', 'C5'), '6') === 'straight');
check('级牌2可入A2345(level2)', typeOf(hand('SA', 'S2', 'H3', 'D4', 'C5'), '2') === 'straight');
check('级牌A可入A2345(levelA)', typeOf(hand('SA', 'S2', 'H3', 'D4', 'C5'), 'A') === 'straight');
check('同花A2345=同花顺(level6)', typeOf(hand('SA', 'S2', 'S3', 'S4', 'S5'), '6') === 'sf');
check('万能补缺= A,3,4,5+万能(level2)', typeOf(hand('SA', 'H2', 'D3', 'C4', 'S5'), '2') === 'straight');
check('AA2233=连对(level6)', typeOf(hand('SA', 'HA', 'S2', 'H2', 'S3', 'H3'), '6') === 'pairs');
check('AAA222=钢板(level6)', typeOf(hand('SA', 'HA', 'DA', 'S2', 'H2', 'D2'), '6') === 'plate');
check('23456=顺子(level6,级牌6按自然点)', typeOf(hand('S2', 'H3', 'D4', 'C5', 'S6'), '6') === 'straight');
check('223344=连对(2可入序)', typeOf(hand('S2', 'H2', 'S3', 'H3', 'S4', 'H4'), '6') === 'pairs');
check('222333=钢板(2可入序)', typeOf(hand('S2', 'H2', 'D2', 'S3', 'H3', 'D3'), '6') === 'plate');
check('级牌入一般顺子(打7,56789)', typeOf(hand('S5', 'H6', 'D7', 'C8', 'S9'), '7') === 'straight');
check('级牌入连对(打7,667788)', typeOf(hand('S6', 'H6', 'S7', 'D7', 'S8', 'H8'), '7') === 'pairs');
check('级牌入钢板(打7,666777)', typeOf(hand('S6', 'H6', 'D6', 'S7', 'D7', 'C7'), '7') === 'plate');
check('223344 > AA2233', Rules.canBeat(P(hand('S2', 'H2', 'S3', 'H3', 'S4', 'H4')), P(hand('SA', 'HA', 'S2', 'H2', 'S3', 'H3'))) === true);
check('34567 > A2345', Rules.canBeat(P(hand('S3', 'H4', 'D5', 'C6', 'S7')), P(hand('SA', 'S2', 'H3', 'D4', 'C5'))) === true);
check('A2345 !> 34567', Rules.canBeat(P(hand('SA', 'S2', 'H3', 'D4', 'C5')), P(hand('S3', 'H4', 'D5', 'C6', 'S7'))) === false);
check('334455 > AA2233', Rules.canBeat(P(hand('S3', 'H3', 'D4', 'C4', 'S5', 'H5')), P(hand('SA', 'HA', 'S2', 'H2', 'S3', 'H3'))) === true);
check('333444 > AAA222', Rules.canBeat(P(hand('S3', 'H3', 'D3', 'C4', 'S4', 'H4')), P(hand('SA', 'HA', 'DA', 'S2', 'H2', 'D2'))) === true);
check('findSF找到掉头同花顺A2345', (function () { var p = [c('S', 'A'), c('S', '2'), c('S', '3'), c('S', '4'), c('S', '5'), c('D', '9')]; var r = Rules.findSF(p, '6', 'S'); return r && r.length === 5; })());
check('findSF其它花色无掉头同花顺', Rules.findSF([c('S', 'A'), c('S', '2'), c('S', '3'), c('S', '4'), c('S', '5')], '6', 'H') === null);

// ---- 同花顺威力定档（C1）：采用文档/竞技主规则 sf(65) 压六炸、压不过七炸 ----
check('POWER.sf=65 且 bomb6<sf<bomb7', Rules.POWER.sf === 65 && Rules.POWER.bomb6 < Rules.POWER.sf && Rules.POWER.sf < Rules.POWER.bomb7);
check('同花顺 > 6炸', Rules.canBeat({ type: 'sf', power: Rules.POWER.sf, rank: 14, len: 5 }, { type: 'bomb6', power: Rules.POWER.bomb6, rank: 3, len: 6 }) === true);
check('同花顺 !> 7炸', Rules.canBeat({ type: 'sf', power: Rules.POWER.sf, rank: 14, len: 5 }, { type: 'bomb7', power: Rules.POWER.bomb7, rank: 3, len: 7 }) === false);
check('7炸 > 同花顺', Rules.canBeat({ type: 'bomb7', power: Rules.POWER.bomb7, rank: 3, len: 7 }, { type: 'sf', power: Rules.POWER.sf, rank: 14, len: 5 }) === true);
check('同花顺 > 5炸', Rules.canBeat({ type: 'sf', power: Rules.POWER.sf, rank: 14, len: 5 }, { type: 'bomb5', power: Rules.POWER.bomb5, rank: 14, len: 5 }) === true);
// ---- C3：seqAllowed 只取 rank 一个形参 ----
check('seqAllowed 形参个数=1', Cards.seqAllowed.length === 1);
check('seqAllowed 王不入序/点数可入序', Cards.seqAllowed('SJ') === false && Cards.seqAllowed('BJ') === false && Cards.seqAllowed('2') === true && Cards.seqAllowed('A') === true);

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
