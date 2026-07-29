/*
 * cards.js —— 掼蛋卡牌基础
 * 双副牌 = 108 张：52*2 + 小王*2 + 大王*2
 * 兼容浏览器(挂到 window.Cards) 与 node(module.exports) 以便单测。
 *
 * 牌点规则（本项目采用，主流掼蛋规则简化）：
 *  - 自然序 base: 2..A -> 2..14；小王 16；大王 17
 *  - 级牌(本局打的点数)升为"主牌"，牌点 = 15（高于 A，低于王），用于单/对/三/炸等同型比较
 *  - 逢人配 = 级牌点数的红桃(♥)，是万能牌，可充当任意一张牌
 *  - 顺子/连对/钢板 使用自然 base 序：2..A 均可入序，级牌按"自然点"入序(不参与序列的升级比较)，王不入序；A 另可作 1 组掉头顺 A2345/AA2233/AAA222
 */
(function (root) {
  'use strict';

  var RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  var SUITS = ['S', 'H', 'D', 'C'];
  var SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var SUIT_RED = { H: true, D: true };

  // 自然牌点
  function baseValue(rank) {
    if (rank === 'SJ') return 16;       // 小王
    if (rank === 'BJ') return 17;       // 大王
    var i = RANKS.indexOf(rank);        // 2..A -> 2..14
    return i + 2;
  }

  // 比较用牌点：级牌升为 15
  function cmpValue(rank, level) {
    if (rank === 'SJ' || rank === 'BJ') return baseValue(rank);
    if (rank === level) return 15;
    return baseValue(rank);
  }

  function isJoker(card) { return card.s === 'W'; }

  // 该牌是否是逢人配（万能牌）
  function isWild(card, level) { return card.s === 'H' && card.r === level; }

  // 该点数能否参与序列(顺子/连对/钢板/同花顺)：王不入序；2..A 均可入序，
  // 级牌按其自然点入序（升级比较只作用于单/对/三/炸，不影响序列）。
  function seqAllowed(rank) {
    return rank !== 'SJ' && rank !== 'BJ';
  }

  // 构造一副 108 张牌，每张 {id, s, r}
  function makeDeck() {
    var deck = [];
    var id = 0;
    for (var copy = 0; copy < 2; copy++) {
      for (var si = 0; si < SUITS.length; si++) {
        for (var ri = 0; ri < RANKS.length; ri++) {
          deck.push({ id: id++, s: SUITS[si], r: RANKS[ri] });
        }
      }
      deck.push({ id: id++, s: 'W', r: 'SJ' }); // 小王
      deck.push({ id: id++, s: 'W', r: 'BJ' }); // 大王
    }
    return deck;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // 显示用文本
  function rankText(card) {
    if (card.r === 'SJ') return '小';
    if (card.r === 'BJ') return '大';
    return card.r;
  }
  function suitText(card) {
    if (card.s === 'W') return card.r === 'BJ' ? '王' : '王';
    return SUIT_SYM[card.s];
  }

  var Cards = {
    RANKS: RANKS, SUITS: SUITS, SUIT_SYM: SUIT_SYM, SUIT_RED: SUIT_RED,
    baseValue: baseValue, cmpValue: cmpValue,
    isJoker: isJoker, isWild: isWild, seqAllowed: seqAllowed,
    makeDeck: makeDeck, shuffle: shuffle,
    rankText: rankText, suitText: suitText
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Cards;
  else root.Cards = Cards;
})(typeof window !== 'undefined' ? window : globalThis);
