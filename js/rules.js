/*
 * rules.js —— 掼蛋规则引擎
 * 依赖 Cards (cards.js)。兼容浏览器与 node(单测)。
 *
 * 牌型 type:
 *   single 单张 | pair 对子 | triple 三同张 | triple2 三带二
 *   straight 顺子(5) | pairs 连对(>=3连) | plate 钢板(2连三)
 *   bomb4..bomb8 炸弹 | sf 同花顺 | rocket 天王炸
 *
 * 炸弹威力(可压非炸弹；炸弹间比 power，再比 rank)：
 *   bomb4(40) < bomb5(50) < bomb6(60) < sf(65) < bomb7(70) < bomb8(80) < bomb9(85) < bomb10(88) < rocket(90)
 *   （采用文档/竞技主规则：同花顺压六炸。若用房规"同花顺=5/6炸"，调 POWER.sf 即可）
 *
 * 非炸弹只能压"同牌型 & 同长度 & 更大牌点"。
 * 顺子/连对/钢板/同花顺 的比较牌点取窗口顶牌的自然 base 值。
 * 万能牌(逢人配)在识别/生成时可替补任意牌。
 */
(function (root) {
  'use strict';
  var Cards = (typeof require !== 'undefined' && typeof window === 'undefined')
    ? require('./cards.js') : root.Cards;

  var POWER = { bomb4: 40, bomb5: 50, bomb6: 60, sf: 65, bomb7: 70, bomb8: 80, bomb9: 85, bomb10: 88, rocket: 90 };
  var PRIO = { rocket: 0, sf: 1, bomb8: 2, bomb7: 3, bomb6: 4, bomb5: 5, bomb4: 6,
    triple2: 7, plate: 8, pairs: 9, straight: 10, triple: 11, pair: 12, single: 13 };
  var TYPE_NAME = { single: '单张', pair: '对子', triple: '三同张', triple2: '三带二',
    straight: '顺子', pairs: '连对', plate: '钢板', bomb4: '四炸', bomb5: '五炸',
    bomb6: '六炸', bomb7: '七炸', bomb8: '八炸', bomb9: '九炸', bomb10: '十炸', sf: '同花顺', rocket: '天王炸' };

  // A 当 1 的"掉头顺"特殊牌型（国标含 A2345 / AA2233 / AAA222）。
  // 主序列是按自然点 2..A 的线性序，无法把 A 绕到 1 之下，故这组窗口单独补充
  // A=1,2,3,4,5 的回绕；比较牌点取窗口顶牌自然值，故为各自牌型中最小的一档。
  var WHEEL5 = [{ r: 'A', v: 1 }, { r: '2', v: 2 }, { r: '3', v: 3 }, { r: '4', v: 4 }, { r: '5', v: 5 }]; // 顺子/同花顺 A2345
  var WHEEL3 = [{ r: 'A', v: 1 }, { r: '2', v: 2 }, { r: '3', v: 3 }];                                    // 连对 AA2233
  var WHEEL2 = [{ r: 'A', v: 1 }, { r: '2', v: 2 }];                                                       // 钢板 AAA222

  function isBomb(p) { return p && p.power > 0; }

  function canBeat(p, last) {
    if (!last) return true;
    if (isBomb(p) && !isBomb(last)) return true;
    if (isBomb(p) && isBomb(last))
      return p.power > last.power || (p.power === last.power && p.rank > last.rank);
    if (!isBomb(p) && isBomb(last)) return false;
    return p.type === last.type && p.len === last.len && p.rank > last.rank;
  }

  // ---- 桶化一手牌 ----
  function bucket(hand, level) {
    var buckets = {}, wilds = [];
    for (var i = 0; i < hand.length; i++) {
      var c = hand[i];
      if (Cards.isWild(c, level)) wilds.push(c);
      else (buckets[c.r] = buckets[c.r] || []).push(c);
    }
    return { buckets: buckets, wilds: wilds };
  }

  function copyBuckets(b) {
    var o = {};
    for (var k in b) o[k] = b[k].slice();
    return o;
  }
  function makeAlloc(buckets, wilds) {
    return {
      rp: copyBuckets(buckets), wp: wilds.slice(),
      takeRank: function (r, n) { var out = []; for (var i = 0; i < n; i++) out.push(this.rp[r].shift()); return out; },
      takeSuit: function (r, s) { var a = this.rp[r]; if (!a) return null; for (var i = 0; i < a.length; i++) if (a[i].s === s) return a.splice(i, 1)[0]; return null; },
      takeWild: function (n) { var out = []; for (var i = 0; i < n; i++) out.push(this.wp.shift()); return out; }
    };
  }

  // 同点组可行性：返回 {fixed, wild} 或 null
  function sameGroup(buckets, W, level, r, N) {
    var cnt = buckets[r] ? buckets[r].length : 0;
    var fixed = Math.min(cnt, N), wild = N - fixed;
    if (wild > W) return null;
    if (wild > 0 && (r === 'SJ' || r === 'BJ')) return null; // 逢人配不能当大小王
    if (fixed === 0 && r !== level) return null; // 全万能牌只能当级牌点本身
    return { fixed: fixed, wild: wild };
  }

  function keysUnion(buckets, level) {
    var ks = Object.keys(buckets);
    if (ks.indexOf(level) < 0) ks.push(level);
    return ks;
  }

  // 连续窗口：返回窗口数组，每个窗口是 [{r,v}...]
  function consecWindows(level, minL, maxL) {
    var seq = Cards.RANKS.map(function (r, i) { return { r: r, v: i + 2 }; })
      .filter(function (o) { return Cards.seqAllowed(o.r); });
    var out = [];
    for (var i = 0; i < seq.length; i++) {
      var j = i;
      while (j + 1 < seq.length && seq[j + 1].v === seq[j].v + 1) j++;
      var seg = seq.slice(i, j + 1);
      for (var L = minL; L <= Math.min(maxL, seg.length); L++)
        for (var s = 0; s + L <= seg.length; s++) out.push(seg.slice(s, s + L));
    }
    return out;
  }

  // 生成一手牌所有合法出牌（每个 play = {cards,type,rank,len,power}）
  function generateAllPlays(hand, level) {
    var B = bucket(hand, level), buckets = B.buckets, wilds = B.wilds, W = wilds.length;
    var KU = keysUnion(buckets, level);
    var plays = [];
    function push(cards, type, rank, len, power) {
      plays.push({ cards: cards, type: type, rank: rank, len: len, power: power || 0 });
    }

    // 单张：每张非万能牌 + 万能牌当级牌
    for (var i = 0; i < hand.length; i++) {
      var c = hand[i];
      push([c], 'single', Cards.cmpValue(c.r, level), 1, 0);
    }

    // 同点型：对/三/炸
    var Ns = [2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (var ni = 0; ni < Ns.length; ni++) {
      var N = Ns[ni];
      for (var ki = 0; ki < KU.length; ki++) {
        var r = KU[ki];
        var g = sameGroup(buckets, W, level, r, N);
        if (!g) continue;
        var al = makeAlloc(buckets, wilds);
        var cards = al.takeRank(r, g.fixed).concat(al.takeWild(g.wild));
        if (cards.length !== N) continue;
        var type = N === 2 ? 'pair' : N === 3 ? 'triple' : 'bomb' + N;
        push(cards, type, Cards.cmpValue(r, level), N, POWER[type] || 0);
      }
    }

    // 三带二
    for (var ti = 0; ti < KU.length; ti++) {
      var T = KU[ti];
      var gT = sameGroup(buckets, W, level, T, 3);
      if (!gT) continue;
      for (var pi = 0; pi < KU.length; pi++) {
        var P = KU[pi];
        if (P === T) continue;
        var gP = sameGroup(buckets, W, level, P, 2);
        if (!gP) continue;
        if (gT.wild + gP.wild > W) continue;
        var a2 = makeAlloc(buckets, wilds);
        var cc = a2.takeRank(T, gT.fixed).concat(a2.takeWild(gT.wild))
          .concat(a2.takeRank(P, gP.fixed)).concat(a2.takeWild(gP.wild));
        if (cc.length !== 5) continue;
        push(cc, 'triple2', Cards.cmpValue(T, level), 5, 0);
      }
    }

    // 顺子(5) / 同花顺(5)；末尾追加掉头顺 A2345（含其同花顺）
    var win5 = consecWindows(level, 5, 5).concat([WHEEL5]);
    for (var w = 0; w < win5.length; w++) {
      var win = win5[w], top = win[win.length - 1].v;
      // 顺子
      var fixedUsed = 0, okS = true;
      for (var x = 0; x < win.length; x++) fixedUsed += Math.min(buckets[win[x].r] ? buckets[win[x].r].length : 0, 1);
      var wildS = 5 - fixedUsed;
      if (wildS <= W) {
        var a3 = makeAlloc(buckets, wilds), cs = [];
        for (var x2 = 0; x2 < win.length; x2++) {
          var rr = win[x2].r, f = Math.min(buckets[rr] ? buckets[rr].length : 0, 1);
          cs = cs.concat(a3.takeRank(rr, f), a3.takeWild(1 - f));
        }
        if (cs.length === 5) push(cs, 'straight', top, 5, 0);
      }
      // 同花顺：枚举花色
      for (var si = 0; si < Cards.SUITS.length; si++) {
        var s = Cards.SUITS[si], ks = 0;
        for (var y = 0; y < win.length; y++) {
          var arr = buckets[win[y].r];
          if (arr) for (var z = 0; z < arr.length; z++) if (arr[z].s === s) { ks++; break; }
        }
        var wildF = 5 - ks;
        if (wildF < 0 || wildF > W) continue;
        var a4 = makeAlloc(buckets, wilds), cf = [];
        for (var y2 = 0; y2 < win.length; y2++) {
          var rr2 = win[y2].r, got = a4.takeSuit(rr2, s);
          if (got) cf.push(got); else cf = cf.concat(a4.takeWild(1));
        }
        if (cf.length === 5) push(cf, 'sf', top, 5, POWER.sf);
      }
    }

    // 连对/木板 = 恰好 3 连对(6 张, AABBCC)；追加掉头连对 AA2233
    var winP = consecWindows(level, 3, 3).concat([WHEEL3]);
    for (var wp = 0; wp < winP.length; wp++) {
      var winp = winP[wp], L = winp.length, need = L * 2, fu = 0;
      for (var a = 0; a < L; a++) fu += Math.min(buckets[winp[a].r] ? buckets[winp[a].r].length : 0, 2);
      var wP = need - fu;
      if (wP > W) continue;
      var a5 = makeAlloc(buckets, wilds), cp = [];
      for (var b = 0; b < L; b++) {
        var rrb = winp[b].r, fb = Math.min(buckets[rrb] ? buckets[rrb].length : 0, 2);
        cp = cp.concat(a5.takeRank(rrb, fb), a5.takeWild(2 - fb));
      }
      if (cp.length === need) push(cp, 'pairs', winp[L - 1].v, need, 0);
    }

    // 钢板(2连三)；追加掉头钢板 AAA222
    var winG = consecWindows(level, 2, 2).concat([WHEEL2]);
    for (var wg = 0; wg < winG.length; wg++) {
      var wing = winG[wg], fu2 = 0;
      for (var c = 0; c < 2; c++) fu2 += Math.min(buckets[wing[c].r] ? buckets[wing[c].r].length : 0, 3);
      var wG = 6 - fu2;
      if (wG > W) continue;
      var a6 = makeAlloc(buckets, wilds), cg = [];
      for (var d = 0; d < 2; d++) {
        var rrd = wing[d].r, fd = Math.min(buckets[rrd] ? buckets[rrd].length : 0, 3);
        cg = cg.concat(a6.takeRank(rrd, fd), a6.takeWild(3 - fd));
      }
      if (cg.length === 6) push(cg, 'plate', wing[1].v, 6, 0);
    }

    // 天王炸
    var sj = buckets['SJ'] ? buckets['SJ'].length : 0, bj = buckets['BJ'] ? buckets['BJ'].length : 0;
    var wR = 4 - (sj + bj);
    if (wR <= W && sj + bj > 0) {
      var a7 = makeAlloc(buckets, wilds);
      var cr = a7.takeRank('SJ', sj).concat(a7.takeRank('BJ', bj), a7.takeWild(wR));
      if (cr.length === 4) push(cr, 'rocket', 17, 4, POWER.rocket);
    }

    return plays;
  }

  // 识别一个选择是否为合法牌型（取整选匹配、按优先级）
  function classify(cards, level) {
    if (!cards || cards.length === 0) return null;
    var ps = generateAllPlays(cards, level).filter(function (p) { return p.cards.length === cards.length; });
    if (ps.length === 0) return null;
    ps.sort(function (a, b) { return PRIO[a.type] - PRIO[b.type]; });
    return ps[0];
  }

  function findBeating(hand, last, level) {
    return generateAllPlays(hand, level).filter(function (p) { return canBeat(p, last); });
  }

  // 出牌排序键：先非炸按(牌点,长度)升序，炸弹按威力升序，便于"出最小"
  function playKey(p) {
    return (isBomb(p) ? 1000 + p.power : 0) * 100000 + p.rank * 100 + p.len;
  }

  // 手牌排序：万能牌最左，其次按比较牌点降序，再花色
  function sortHand(hand, level) {
    var so = { H: 0, S: 1, D: 2, C: 3 };
    return hand.slice().sort(function (a, b) {
      var wa = Cards.isWild(a, level) ? 0 : 1, wb = Cards.isWild(b, level) ? 0 : 1;
      if (wa !== wb) return wa - wb;
      var va = Cards.cmpValue(a.r, level), vb = Cards.cmpValue(b.r, level);
      if (va !== vb) return vb - va;
      return (so[a.s] || 0) - (so[b.s] || 0);
    });
  }

  function bombLabel(n) { return ['四炸', '五炸', '六炸', '七炸', '八炸', '九炸', '十炸'][Math.min(n, 10) - 4] || '炸弹'; }

  /*
   * 理牌（对齐原版边锋一键理）：
   *  - 锁定的组合(locks)原样作为最左侧栏，带🔒与牌型标签；
   *  - 余牌按"点数"竖叠成栏，顺序按 cmpValue 降序（王、级牌在最左）；
   *  - 仅"炸弹栏"(同点>=4)挂标签；对子/三张/单张不挂；
   *  - 万能牌留在其级牌点栏内，不单独拎出。
   *  返回 { columns:[ {cards, chip, locked} ] }。
   */
  // 给 5 张的顺子/同花顺算"有效点/有效花色"：万能牌显示成它所补的点数；
  // 若其余牌同花色(同花顺)，万能牌也按该花色显示，使整栏看起来是清一色连序。
  // 返回重排并克隆好的卡片数组（万能牌带 asRank/asSuit），无法解析返回 null。
  function runEffective(cards, level) {
    if (cards.length !== 5) return null;
    var byC = {}; cards.forEach(function (c) { byC[c.id] = c; });
    var w = cards.filter(function (c) { return Cards.isWild(c, level); });
    if (w.length > 1) return null;
    var real = cards.filter(function (c) { return !Cards.isWild(c, level); });
    var flushSuit = (real.length && real.every(function (c) { return c.s === real[0].s; })) ? real[0].s : null;
    function symOf(v) { return ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'][v]; }
    function cloneWild(v) { var cc = {}; for (var k in w[0]) cc[k] = w[0][k]; cc.asRank = symOf(v); if (flushSuit) cc.asSuit = flushSuit; return cc; }
    function fit(arr) {
      arr.sort(function (a, b) { return a.v - b.v; });
      for (var s = 1; s <= 10; s++) {
        var ok = true, inn = 0;
        for (var i = 0; i < arr.length; i++) { if (arr[i].v < s || arr[i].v > s + 4) { ok = false; break; } inn++; }
        if (ok && (5 - inn) === w.length) {
          var have = {}; arr.forEach(function (o) { have[o.v] = o.id; });
          var order = [];
          for (var v = s; v <= s + 4; v++) order.push(have[v] ? byC[have[v]] : cloneWild(v));
          return order;
        }
      }
      return null;
    }
    function vals(useA1) { return real.map(function (c) { return { id: c.id, v: (useA1 && c.r === 'A') ? 1 : Cards.baseValue(c.r) }; }); }
    return fit(vals(false)) || (real.some(function (c) { return c.r === 'A'; }) ? fit(vals(true)) : null);
  }

  function organize(hand, level, locks) {
    locks = locks || [];
    var byId = {}; hand.forEach(function (c) { byId[c.id] = c; });
    // lock 是 UI 的"分组展示"，organize 不做牌型校验（保持哑分组契约，测试/锁牌可传任意 ids）。
    // 这里只挡一种异常：lock 里有牌已不在手中（跨局残留等"缺牌"）。这种 lock 判为失效，
    // 其现存牌落回普通点数栏，杜绝"上一局5张顺子本局缺1张却被标成4张顺子"的错标。
    // （换局的残留锁另由 ui.js 在 roundNo 变化时整体清空。）
    locks = locks.filter(function (lk) { return lk.ids.every(function (id) { return byId[id]; }); });
    var lockedOf = {}; locks.forEach(function (lk) { lk.ids.forEach(function (id) { lockedOf[id] = lk; }); });
    var pool = hand.filter(function (c) { return !lockedOf[c.id]; });
    var byRank = {}; pool.forEach(function (c) { (byRank[c.r] = byRank[c.r] || []).push(c); });
    var rankCols = Object.keys(byRank).map(function (r) {
      var cards = byRank[r].slice().sort(function (a, b) { return Cards.cmpValue(b.r, level) - Cards.cmpValue(a.r, level) || (a.s < b.s ? -1 : 1); });
      return { cards: cards, chip: cards.length >= 4 ? bombLabel(cards.length) : null, locked: false };
    }).sort(function (a, b) { return Cards.cmpValue(b.cards[0].r, level) - Cards.cmpValue(a.cards[0].r, level); });
    var lockCols = locks.map(function (lk) {
      var cards = lk.ids.map(function (id) { return byId[id]; }).filter(Boolean);
      if ((lk.type === 'sf' || lk.type === 'straight') && cards.length === 5) {
        var eff = runEffective(cards, level);
        if (eff) cards = eff;
      }
      return { cards: cards, chip: lk.label || null, locked: true, type: lk.type || null };
    });
    return { columns: lockCols.concat(rankCols) };
  }

  // 在 pool 中为指定花色找一个同花顺（5 连，万能牌至多补 1 个缺口），返回 5 张牌对象或 null
  function findSF(pool, level, suit) {
    var wild = null;
    for (var i = 0; i < pool.length; i++) if (Cards.isWild(pool[i], level)) { wild = pool[i]; break; }
    // 万能牌只作"补缺位"用，不参与自然匹配，避免一张牌两用
    function has(r) { for (var j = 0; j < pool.length; j++) { var c = pool[j]; if (c !== wild && c.r === r && c.s === suit) return c; } return null; }
    var seq = Cards.RANKS.map(function (r, i) { return { r: r, v: i + 2 }; }).filter(function (o) { return Cards.seqAllowed(o.r); }).sort(function (a, b) { return a.v - b.v; });
    var segs = [], cur = [];
    seq.forEach(function (o) { if (cur.length && o.v !== cur[cur.length - 1].v + 1) { segs.push(cur); cur = []; } cur.push(o); });
    if (cur.length) segs.push(cur);
    var wins = [];
    for (var a = 0; a < segs.length; a++) {
      var seg = segs[a];
      for (var s = 0; s + 5 <= seg.length; s++) wins.push(seg.slice(s, s + 5));
    }
    wins.push(WHEEL5); // 掉头同花顺 A2345（最小档），自然点含 2，绕过 seqAllowed
    for (var wi = 0; wi < wins.length; wi++) {
      var win = wins[wi], gapSeen = false, ok = true, cards = [];
      for (var k = 0; k < 5; k++) { var cc = has(win[k].r); if (cc) cards.push(cc); else { if (gapSeen || !wild) { ok = false; break; } gapSeen = true; cards.push(wild); } }
      if (ok) return cards;
    }
    return null;
  }

  /*
   * 一键理牌：把整手牌贪心拆成"成型组合"列表（每项={ids,type,label,suit}），
   * 供 UI 作锁定栏展示，余牌仍按点数竖叠。启发式策略（保炸弹、整体看牌）：
   *  1) 张数>=4 的点数整组当炸弹（绝不拆）；
   *  2) 反复取余牌里"最长"的 顺子/连对/钢板/同花顺（同长则同花顺>钢板>连对>顺子）；
   *  3) 反复取三带二；余下对/三/单/万能牌留给点数竖叠。
   *  各组 id 互不相交，且每组都是合法牌型；不拆炸弹。
   */
  function autoPlan(hand, level) {
    // 万能牌单独抽出：只允许它"补 1 个缺口"去完成同花顺/顺子，绝不用它凑假对/假三(连对/钢板/三带二只用真牌)
    var wilds = hand.filter(function (c) { return Cards.isWild(c, level); });
    var real = hand.filter(function (c) { return !Cards.isWild(c, level); });
    var groups = [], usedWild = 0;
    function takeReal(cards) { var m = {}; cards.forEach(function (c) { m[c.id] = 1; }); real = real.filter(function (c) { return !m[c.id]; }); }
    function push(cards, type, label, suit) { groups.push({ ids: cards.map(function (c) { return c.id; }), type: type, label: label, suit: suit || null }); }
    function pool() { return real.concat(wilds.slice(usedWild)); }
    function wc(cards) { return cards.filter(function (c) { return Cards.isWild(c, level); }).length; }
    // 1) 炸弹：real 中同点>=4 **整组**当 N 炸（5张=五炸、6张=六炸…，绝不拆成"4+余"，符合"明显是N张"的直觉；
    //    若想把多余张拿去组顺子，请手动拆该锁定栏——锁牌不劫持选择，可自由勾选子集）。
    var cm = {}; real.forEach(function (c) { cm[c.r] = (cm[c.r] || 0) + 1; });
    for (var r in cm) if (cm[r] >= 4) { var bc = real.filter(function (c) { return c.r === r; }); var n = Math.min(bc.length, 10); push(bc, 'bomb' + n, bombLabel(n)); takeReal(bc); }
    // 2) 同花顺/顺子（最多补 1 张万能），同花顺优先
    var g2 = 0;
    while (g2++ < 12) {
      var cand = generateAllPlays(pool(), level).filter(function (p) { return (p.type === 'sf' || p.type === 'straight') && wc(p.cards) <= 1 && wc(p.cards) <= wilds.length - usedWild; });
      if (!cand.length) break;
      cand.sort(function (a, b) { return (PRIO[a.type] - PRIO[b.type]) || (b.rank - a.rank); });
      var pk = cand[0]; usedWild += wc(pk.cards);
      var suit = null; if (pk.type === 'sf') { var ns = pk.cards.filter(function (c) { return !Cards.isWild(c, level); }); suit = ns.length ? ns[0].s : null; }
      push(pk.cards, pk.type, TYPE_NAME[pk.type] || pk.type, suit);
      takeReal(pk.cards.filter(function (c) { return !Cards.isWild(c, level); }));
    }
    // 3) 连对/钢板：仅真牌
    var g3 = 0;
    while (g3++ < 12) {
      var seq = generateAllPlays(real, level).filter(function (p) { return p.type === 'plate' || p.type === 'pairs'; });
      if (!seq.length) break;
      seq.sort(function (a, b) { return (b.cards.length - a.cards.length) || (PRIO[a.type] - PRIO[b.type]); });
      push(seq[0].cards, seq[0].type, TYPE_NAME[seq[0].type]); takeReal(seq[0].cards);
    }
    // 4) 三带二：仅真牌
    var g4 = 0;
    while (g4++ < 12) {
      var t2 = generateAllPlays(real, level).filter(function (p) { return p.type === 'triple2'; });
      if (!t2.length) break;
      push(t2[0].cards, 'triple2', TYPE_NAME.triple2); takeReal(t2[0].cards);
    }
    return groups;
  }

  var Rules = {
    POWER: POWER, TYPE_NAME: TYPE_NAME, PRIO: PRIO,
    isBomb: isBomb, canBeat: canBeat, bombLabel: bombLabel, organize: organize, findSF: findSF, autoPlan: autoPlan, runEffective: runEffective,
    generateAllPlays: generateAllPlays, classify: classify,
    findBeating: findBeating, playKey: playKey, sortHand: sortHand
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
  else root.Rules = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
