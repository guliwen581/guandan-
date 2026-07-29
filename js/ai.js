/*
 * ai.js —— 掼蛋 AI 出牌策略（启发式，整体看牌）
 * 依赖 Rules / Cards。
 *
 * AI.choose(ctx) -> play对象 或 null(过牌)
 *   ctx = { hand:[card], level, top:{play,owner}|null, self:int, team:fn(seat)->0/1 }
 *
 * 结构保护（analyze/breakNum）——按"拆它代价"分级：
 *   · 炸弹(bombReserved) 最重 · 顺子/同花顺(seqIds) · 三同张(tripleIds) · 对子(pairIds) 轻
 *   对子为"轻保护"：跟单张时**优先用孤张**而非拆对（所以跟 10 有孤 K 就出 K、不拆 QQ）；
 *   但若手里没有孤张，仍允许拆对压牌（拆对的轻罚只影响排序，不阻止出牌）。
 *   跟一对时给"比它大的最小单对"；跟一张小牌时若无孤张/拆对可选才考虑过牌，绝不轻易拆炸/顺/三同张。
 *
 * smartSort(hand,level,plays,leading) 暴露给 ui.js 的"提示"使用，提示与 AI 同一套排序。
 */
(function (root) {
  'use strict';
  var Rules = (typeof require !== 'undefined' && typeof window === 'undefined')
    ? require('./rules.js') : root.Rules;
  var Cards = (typeof require !== 'undefined' && typeof window === 'undefined')
    ? require('./cards.js') : root.Cards;

  function byKey(plays) {
    return plays.slice().sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); });
  }

  function analyze(hand, level) {
    var nonWild = hand.filter(function (c) { return !Cards.isWild(c, level); });
    var byRank = {}; nonWild.forEach(function (c) { (byRank[c.r] = byRank[c.r] || []).push(c); });
    var bombReserved = {}, bombRanks = {}, tripleIds = {}, pairIds = {};
    for (var r in byRank) {
      var arr = byRank[r];
      if (arr.length >= 4) {
        bombRanks[r] = true;
        for (var i = 0; i < 4; i++) bombReserved[arr[i].id] = true;
        var rest = arr.slice(4);
        if (rest.length >= 3) rest.forEach(function (c) { tripleIds[c.id] = true; });
        else if (rest.length === 2) rest.forEach(function (c) { pairIds[c.id] = true; });
      } else if (arr.length === 3) {
        arr.forEach(function (c) { tripleIds[c.id] = true; });
      } else if (arr.length === 2) {
        arr.forEach(function (c) { pairIds[c.id] = true; });
      }
    }
    var pool = nonWild.filter(function (c) { return !bombReserved[c.id]; });
    var seqIds = {};
    if (pool.length) {
      Rules.generateAllPlays(pool, level).forEach(function (p) {
        if (p.type === 'straight' || p.type === 'sf') p.cards.forEach(function (c) { seqIds[c.id] = true; });
      });
    }
    return { bombReserved: bombReserved, bombRanks: bombRanks, tripleIds: tripleIds, pairIds: pairIds, seqIds: seqIds };
  }

  // 拆结构代价：bb(炸) > bs(顺/同花顺) > bt(三同张) > bp(对子,轻)；rc=牌内同点张数，>=2 视为"整组用"不罚
  function breakNum(P, an) {
    var bb = 0, bs = 0, bt = 0, bp = 0;
    var isBomb = Rules.isBomb(P);
    var isSeq5 = P.type === 'straight' || P.type === 'sf';
    var rc = {}; P.cards.forEach(function (c) { rc[c.r] = (rc[c.r] || 0) + 1; });
    P.cards.forEach(function (c) {
      if (an.bombReserved[c.id]) { if (!isBomb) bb++; }
      else if (an.seqIds[c.id]) { if (!isSeq5) bs++; }
      else if (an.tripleIds[c.id]) { if (!(rc[c.r] >= 2)) bt++; }   // 三同张被当"单张"出才罚
      else if (an.pairIds[c.id]) { if (!(rc[c.r] >= 2)) bp++; }      // 拆对跟单张：轻罚，让孤张优先
    });
    return bb * 100000 + bs * 1000 + bt * 10 + bp * 1;
  }

  function smartSort(hand, level, plays, leading) {
    var an = analyze(hand, level), cnt = {};
    if (leading) hand.forEach(function (c) { cnt[c.r] = (cnt[c.r] || 0) + 1; });
    function extra(P) {
      var e = 0;
      if (leading) {
        if (P.type === 'single' && cnt[P.cards[0].r] > 1) e += 5000;   // 不拆对/三去出单张
        if (hand.length <= 8) {
          var m = {}; P.cards.forEach(function (c) { m[c.id] = 1; });
          var rem = hand.filter(function (c) { return !m[c.id]; });
          if (rem.length && Rules.classify(rem, level)) e -= 100000;   // 手少时优先"领一手+留一手走完"
        }
      }
      return e;
    }
    return plays.slice().sort(function (a, b) {
      var ka = (Rules.isBomb(a) ? 1e12 : 0) + breakNum(a, an) * 1000000 + extra(a) + Rules.playKey(a);
      var kb = (Rules.isBomb(b) ? 1e12 : 0) + breakNum(b, an) * 1000000 + extra(b) + Rules.playKey(b);
      return ka - kb;
    });
  }

  function topRank(top) { return top && top.play ? top.play.rank : 0; }

  function choose(ctx) {
    var hand = ctx.hand, level = ctx.level, top = ctx.top, self = ctx.self, team = ctx.team;
    var all = Rules.generateAllPlays(hand, level);
    var leading = !top || top.owner === self;
    function empties(p) { return p.cards.length === hand.length; }

    if (leading) {
      var winNow = byKey(all.filter(empties));
      if (winNow.length) return winNow[0];
      var nb = smartSort(hand, level, all.filter(function (p) { return !Rules.isBomb(p); }), true);
      if (nb.length) return nb[0];
      return byKey(all)[0];
    }

    // 跟牌
    var beats = all.filter(function (p) { return Rules.canBeat(p, top.play); });
    if (!beats.length) return null;
    var winNow2 = beats.filter(empties);
    if (winNow2.length) return byKey(winNow2)[0];
    if (team(top.owner) === team(self)) return null; // 队友最大，让牌

    var an = analyze(hand, level);
    var nb2 = smartSort(hand, level, beats.filter(function (p) { return !Rules.isBomb(p); }), false);
    if (nb2.length) {
      var bn = breakNum(nb2[0], an);
      if (bn < 10) return nb2[0];                       // 孤张(0)/仅拆对(1~9)都压：拆对轻罚只让"有孤张先孤张"
      if (bn >= 100000) { /* 需拆炸弹：不拆，转炸弹/过牌 */ }
      else if (topRank(top) <= 10) return null;         // 只靠拆顺/三压小牌 -> 过
      else return nb2[0];                               // 拆顺/三压大牌(J+) -> 压
    }
    // 只剩炸弹能压
    if (hand.length <= 8) return byKey(beats)[0];
    return null;
  }

  var AI = { choose: choose, analyze: analyze, breakNum: breakNum, smartSort: smartSort };
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
  else root.AI = AI;
})(typeof window !== 'undefined' ? window : globalThis);
