/*
 * game.js —— 掼蛋游戏流程状态机（含完整赛制，支持多人/多视角）
 * 依赖 Cards / Rules / AI。UI 通过 init({render,onSettle,onLobby}) 钩子渲染。
 *
 * 座位：0=自己(底) 1=右 2=对家(顶) 3=左 ；队伍 = seat & 1（0&2 / 1&3）
 * 阶段：lobby -> (tribute) -> double -> play -> settle ；比赛结束 matchOver
 *
 * 多人支持：
 *  - humanSeats 指定哪些座位由真人控制（默认 [0]；AUTO_ALL=true 时为 [] 全 AI）。
 *    服务器可 setHumanSeats([0,1,2,3]) 让 4 座皆真人，空位由 AI 补。
 *  - snapshotFor(viewer) 返回"以 viewer 为 0 号位(自己)"旋转后的快照，
 *    供各客户端按自己的视角渲染；snapshot() = snapshotFor(0)（单机/UI 默认）。
 *  - act(seat, {type:'play'|'pass'|'double'|'tribute'|'timeout', ...}) 为服务器
 *    统一的真人动作入口；humanPlay/humanPass/... 是其 0 号位快捷封装。
 *  - createGame() 工厂返回相互独立的牌局实例（服务器每房间一个）；模块默认导出
 *    一个单例（浏览器/单测用），并附带 createGame。
 *
 * 赛制（主流掼蛋简化，自洽）：
 *  - 每队自有等级 teamLevel（每局从 2 起）。本局"级牌/本局打" = 庄家队(=上局头游队，首局=0队)的等级；
 *    逢人配 = 该级牌的红桃，主牌 = 该级牌（rules 已按 level 参数化）。
 *  - 结算后头游队按组合升级：双上+3 / 头三+2 / 头末+1；越过 A 即"打通"=该队赢得整场比赛。
 *  - 局间进贡/还贡（第2局起）：末游→头游、三游→二游 各进贡最大牌，收贡方还一张；
 *    两输家合持两张大王则"抗贡"。还贡后头游先出。
 *  - 倍数：加倍阶段每次×2；出炸/同花顺/天王炸×2（封顶64）。
 *  - 不洗牌：发牌用上局牌序切牌而非洗牌（炸弹更多）。
 *  - 持久化：金币/底分存 localStorage（节点无则跳过）；等级每场从2起。
 *
 * 测试：Game.AUTO_ALL=true 让0号也走AI；Game.sync=true 取消 setTimeout 同步执行。
 */
(function (root) {
  'use strict';

  function createGame() {
  var Cards = (typeof require !== 'undefined' && typeof window === 'undefined') ? require('./cards.js') : root.Cards;
  var Rules = (typeof require !== 'undefined' && typeof window === 'undefined') ? require('./rules.js') : root.Rules;
  var AI = (typeof require !== 'undefined' && typeof window === 'undefined') ? require('./ai.js') : root.AI;

  var NAMES = ['你', '黄金1', '黄金2', '黄金3'];
  var FACES = ['😎', '', '🐥', ''];
  var RANK_LABEL = ['头游', '二游', '三游', '末游'];
  var SEAT_POS = ['bottom', 'right', 'top', 'left'];
  var LEVELS = Cards.RANKS; // 2..A

  var S = null, SYNC = false, UI = null;
  var humanSeats = [0];                       // 真人座位；AUTO_ALL 时清空
  function isHuman(seat) { return humanSeats.indexOf(seat) >= 0; }
  var lobbyMode = { noShuffle: false, gold: false };
  var persisted = loadPersisted();

  function team(seat) { return seat & 1; }
  function partner(seat) { return seat ^ 2; }
  function lvlIdx(r) { return LEVELS.indexOf(r); }
  function advanceLevel(r, step) { if (r === 'A') return { win: true }; var i = Math.min(lvlIdx(r) + step, LEVELS.length - 1); return { win: false, level: LEVELS[i] }; }
  function cmp(c) { return Cards.cmpValue(c.r, S.level); }
  function highest(hand) { var b = hand[0]; for (var i = 1; i < hand.length; i++) if (cmp(hand[i]) > cmp(b)) b = hand[i]; return b; }
  function lowest(hand) { var b = hand[0]; for (var i = 1; i < hand.length; i++) if (cmp(hand[i]) < cmp(b)) b = hand[i]; return b; }
  function isWildCard(c) { return Cards.isWild(c, S.level); }
  // 进贡：除逢人配外最大的牌（王可进）
  function highestTribute(hand) { var e = hand.filter(function (c) { return !isWildCard(c); }); var b = e[0]; for (var i = 1; i < e.length; i++) if (cmp(e[i]) > cmp(b)) b = e[i]; return b; }
  // 进贡候选：所有并列最大的牌（规则：必须进最大牌，同大时可在并列张中任选一张）
  function tributeCandidates(hand) {
    var e = hand.filter(function (c) { return !isWildCard(c); });
    if (!e.length) return [];
    var hv = cmp(e[0]), out = [e[0]];
    for (var i = 1; i < e.length; i++) {
      var v = cmp(e[i]);
      if (v > hv) { hv = v; out = [e[i]]; }
      else if (v === hv) out.push(e[i]);
    }
    return out;
  }
  function maxTributeValue(hand) { var e = hand.filter(function (c) { return !isWildCard(c); }); if (!e.length) return -1; var hv = cmp(e[0]); for (var i = 1; i < e.length; i++) if (cmp(e[i]) > hv) hv = cmp(e[i]); return hv; }
  // 还贡：点数<=10 且非级牌/逢人配/王；一张都没有时退化为非逢人配/王最小牌（避免卡死）
  function eligibleReturn(c) { return c.s !== 'W' && !isWildCard(c) && c.r !== S.level && Cards.baseValue(c.r) <= 10; }
  function returnLow(hand) {
    var e = hand.filter(eligibleReturn);
    if (!e.length) e = hand.filter(function (c) { return c.s !== 'W' && !isWildCard(c); });
    var b = e[0]; for (var i = 1; i < e.length; i++) if (cmp(e[i]) < cmp(b)) b = e[i]; return b;
  }
  // 抗贡依据（文档§6②）：应贡方合计 2 张逢人配(红桃级牌)即抗贡
  function wildCount(seat) { return S.hands[seat].filter(isWildCard).length; }

  function loadPersisted() {
    try { if (typeof localStorage !== 'undefined') { var s = JSON.parse(localStorage.getItem('guandan') || '{}'); return { coins: s.coins, base: s.base }; } } catch (e) {}
    return {};
  }
  function save() {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem('guandan', JSON.stringify({ coins: S.coins, base: S.base })); } catch (e) {}
  }

  function newMatch(base) {
    return {
      phase: 'lobby', base: base || persisted.base || 800, mult: 1, level: '2',
      teamLevel: ['2', '2'], dealerTeam: 0, roundNo: 0, matchOver: false, matchWinner: null,
      prevResult: null, firstLeader: 0, tribute: null,
      mode: { noShuffle: lobbyMode.noShuffle, gold: lobbyMode.gold }, lastDeck: null,
      hands: [[], [], [], []], finished: [false, false, false, false], finishOrder: [],
      top: null, passCount: 0, turn: 0, doubled: [null, null, null, null], doubleTurn: 0,
      passed: [false, false, false, false], discarded: [], lastResult: null,
      coins: (persisted.coins && persisted.coins.length === 4) ? persisted.coins.slice() : [10000, 10000, 10000, 10000]
    };
  }

  function aliveCount() { var n = 0; for (var i = 0; i < 4; i++) if (!S.finished[i]) n++; return n; }
  function nextAlive(from) { var s = (from + 1) % 4, g = 0; while (S.finished[s] && g++ < 4) s = (s + 1) % 4; return s; }
  // 一局结束条件：存活玩家同属一队即结束（双上/双下时另一队自动为三/末游，无需打满；或仅剩1人）
  function roundOver() {
    var t = -1;
    for (var i = 0; i < 4; i++) if (!S.finished[i]) { if (t < 0) t = team(i); else if (team(i) !== t) return false; }
    return true;
  }
  // 接风：走完者由其对家领出；对家也走完则顺延到下一个存活者
  function leaderAfter(w, fin) { if (!fin[w]) return w; var p = w ^ 2; if (!fin[p]) return p; var s = (p + 1) % 4, g = 0; while (fin[s] && g++ < 4) s = (s + 1) % 4; return s; }

  function deal() {
    var d;
    if (S.mode.noShuffle && S.lastDeck) { var k = Math.floor(Math.random() * 108); d = S.lastDeck.slice(k).concat(S.lastDeck.slice(0, k)); }
    else { d = Cards.shuffle(Cards.makeDeck()); }
    S.lastDeck = d.slice();
    for (var i = 0; i < 4; i++) S.hands[i] = d.slice(i * 27, (i + 1) * 27);
  }

  // ---------- 快照（按 viewer 视角旋转，viewer 恒为 0 号位/自己）----------
  function snapshotFor(viewer) {
    viewer = viewer || 0;
    function rot(s) { return (s - viewer + 4) % 4; }
    var vt = team(viewer);
    var seats = [];
    for (var ni = 0; ni < 4; ni++) {
      var i = (viewer + ni) % 4;                 // 旋转后第 ni 位对应的原始座位
      var reveal = (ni === 0) || (ni === 2 && S.finished[viewer]);
      var ridx = S.finishOrder.indexOf(i);
      seats.push({
        id: ni, pos: SEAT_POS[ni], name: NAMES[i], face: FACES[i], team: team(ni),
        teamLevel: S.teamLevel[team(i)],
        coins: S.coins[i], handCount: S.hands[i].length, finished: S.finished[i],
        alarm: (!S.finished[i] && S.hands[i].length > 0 && S.hands[i].length <= 2) ? S.hands[i].length : 0,  // P0-3 报警：剩1-2张
        rank: ridx >= 0 ? RANK_LABEL[ridx] : null,
        doubled: S.doubled[i], passed: S.passed[i],
        cards: reveal ? (ni === 0 ? Rules.sortHand(S.hands[i], S.level) : S.hands[i].slice()) : null
      });
    }
    // 进贡信息换算到 viewer 视角（viewer 恒为 0 号位）
    var tribute = null;
    if (S.tribute) {
      var givenByHuman = null, gotByHuman = null;
      S.tribute.pairs.forEach(function (p) { if (p.giver === viewer) { givenByHuman = p.held; gotByHuman = p.back || null; } });
      var tKind = S.tribute.pendingKinds[viewer] || null;   // 'give'=轮到我选进贡牌 'back'=轮到我选还贡牌
      var giveCands = null;
      if (tKind === 'give') {
        var gp = S.tribute.pairs.filter(function (p) { return p.giver === viewer; })[0];
        if (gp && gp.candidates) giveCands = gp.candidates.map(function (c) { return c.id; });
      }
      tribute = {
        anti: S.tribute.anti,
        pairs: S.tribute.pairs.map(function (p) { return { giver: rot(p.giver), receiver: rot(p.receiver), held: p.held, back: p.back }; }),
        givenByHuman: givenByHuman, gotByHuman: gotByHuman,
        pendingReceiver: tKind === 'back' ? 0 : null,
        pendingGiver: tKind === 'give',
        giveCandidates: giveCands,
        tributeKind: tKind
      };
    }
    var lastResult = null;
    if (S.lastResult) {
      var lr = S.lastResult, rpos = [0, 0, 0, 0], rdeltas = [0, 0, 0, 0];
      for (var ri = 0; ri < 4; ri++) { rpos[ri] = lr.pos[(viewer + ri) % 4]; rdeltas[ri] = lr.deltas[(viewer + ri) % 4]; }
      lastResult = {
        finishOrder: lr.finishOrder.map(rot), pos: rpos, deltas: rdeltas,
        winTeam: lr.winTeam === vt ? 0 : 1, combo: lr.combo, comboName: lr.comboName, delta: lr.delta,
        rankMult: lr.rankMult,
        newLevel: lr.newLevel, matchOver: lr.matchOver,
        matchWinner: lr.matchWinner == null ? null : (lr.matchWinner === vt ? 0 : 1)
      };
    }
    return {
      phase: S.phase, level: S.level, base: S.base, mult: S.mult,
      turn: rot(S.turn),
      top: S.top ? { play: S.top.play, owner: rot(S.top.owner) } : null,
      seats: seats, finishOrder: S.finishOrder.map(rot), self: 0,
      teamLevel: [S.teamLevel[vt], S.teamLevel[vt ^ 1]],
      dealerTeam: S.dealerTeam === vt ? 0 : 1, roundNo: S.roundNo,
      matchOver: S.matchOver, matchWinner: S.matchWinner == null ? null : (S.matchWinner === vt ? 0 : 1),
      tribute: tribute, mode: S.mode,
      counter: buildCounter(viewer), discarded: S.discarded.length,
      canPlay: S.phase === 'play' && S.turn === viewer && !S.finished[viewer],
      canDouble: S.phase === 'double' && S.doubleTurn === viewer,
      canTribute: S.phase === 'tribute' && S.tribute && S.tribute.pending.indexOf(viewer) >= 0,
      leading: S.phase === 'play' && S.turn === viewer && !S.finished[viewer] && !S.top,
      lastResult: lastResult
    };
  }
  function snapshot() { return snapshotFor(0); }
  // 记牌器：viewer 视角的"未见牌"剩余张数 = 总张 − 自己手牌 − 已弃牌（即其余三家手中还有几张）。
  function buildCounter(viewer) {
    var total = {}; Cards.RANKS.forEach(function (r) { total[r] = 8; }); total['SJ'] = 2; total['BJ'] = 2;
    var inH = {}, disc = {};
    S.hands[viewer].forEach(function (c) { inH[c.r] = (inH[c.r] || 0) + 1; });
    S.discarded.forEach(function (r) { disc[r] = (disc[r] || 0) + 1; });
    var rem = {}; for (var k in total) rem[k] = total[k] - (inH[k] || 0) - (disc[k] || 0);
    return rem;
  }
  function render() { if (UI && UI.render) UI.render(snapshot()); }

  // ---------- 调度 ----------
  function scheduleAI(fn, delay) { if (SYNC) fn(); else setTimeout(fn, delay); }
  function schedule() {
    render();
    if (S.phase === 'tribute') {
      return; // 等真人还贡（AI 收贡已在 runTribute 自动还）
    } else if (S.phase === 'double') {
      if (isHuman(S.doubleTurn)) return; // 等真人加倍
      scheduleAI(doAIDouble, 500);
    } else if (S.phase === 'play') {
      if (S.finished[S.turn]) { S.turn = nextAlive(S.turn); render(); }
      if (isHuman(S.turn)) return;
      scheduleAI(doAITurn, 650);
    }
  }

  // ---------- 一局开始（发牌 + 进贡）----------
  function startRound() {
    S.roundNo++;
    S.level = S.mode.gold ? '2' : S.teamLevel[S.dealerTeam];  // 金币场固定级牌2（对标APK赛制"固定2为级牌"）
    S.mult = 1; S.finished = [false, false, false, false]; S.finishOrder = [];
    S.top = null; S.passCount = 0; S.doubled = [null, null, null, null]; S.doubleTurn = 0;
    S.passed = [false, false, false, false]; S.discarded = []; S.lastResult = null; S.tribute = null;
    deal();
    if (S.roundNo === 1) {
      // 文档§6①：首副由摸到♥2(本局逢人配/级牌红桃)者先出；两副牌有两张，取座位号最小者做确定性 tie-break
      var fl = -1; for (var s = 0; s < 4; s++) if (S.hands[s].some(isWildCard)) { fl = s; break; }
      S.firstLeader = fl >= 0 ? fl : 0;
    } else S.firstLeader = S.prevResult.finishOrder[0];

    if (S.roundNo > 1 && S.prevResult) runTribute(); // 可能设置 phase='tribute' 并 return
    if (S.phase === 'tribute') { render(); return; }
    S.phase = 'double'; S.doubleTurn = 0;
    schedule();
  }
  function seatByPos(res) { var m = {}; for (var s = 0; s < 4; s++) m[res.pos[s]] = s; return m; }
  // 进贡规则（对齐国标）：双上→双贡(输方三+末都给，进大牌者→头游)；
  // 头三→单贡(末游→头游)；头末→无进贡。抗贡=进贡方合计两张大王。
  // 领头：单贡=末游；双贡=进大牌者(同大=头游下家)；抗贡/无贡=头游。
  function runTribute() {
    var fin = S.prevResult.finishOrder; // [头,二,三,末]
    var seatOfPos = fin;                // seatOfPos[p-1] = 第 p 名的座位
    var winTeam = team(fin[0]);
    var losePos = [];
    for (var p = 1; p <= 4; p++) if (team(seatOfPos[p - 1]) !== winTeam) losePos.push(p);
    var isDouble = losePos.indexOf(3) >= 0 && losePos.indexOf(4) >= 0;  // 双下
    var isSingle = losePos.indexOf(4) >= 0 && !isDouble;                // 单下(输方=二+末)
    var givRec = [];
    if (isDouble) {
      var g3 = seatOfPos[2], g4 = seatOfPos[3];
      var v3 = maxTributeValue(S.hands[g3]), v4 = maxTributeValue(S.hands[g4]); // 候选皆并列最大，比值即比最大牌
      var bigG, smG;
      if (v4 > v3) { bigG = g4; smG = g3; }
      else if (v4 < v3) { bigG = g3; smG = g4; }
      else { bigG = g3; smG = g4; } // 同大：进贡映射取三游→头游（领头另算）
      givRec = [{ giver: bigG, receiver: seatOfPos[0] }, { giver: smG, receiver: seatOfPos[1] }];
    } else if (isSingle) {
      givRec = [{ giver: seatOfPos[3], receiver: seatOfPos[0] }];      // 末游→头游
    }
    var antiN = 0; givRec.forEach(function (gr) { antiN += wildCount(gr.giver); }); // 文档：逢人配(红桃级牌)计抗贡
    if (givRec.length === 0) { S.tribute = null; S.firstLeader = fin[0]; return; } // 头末：无进贡
    S.tribute = { anti: antiN >= 2, pairs: givRec, pending: [], pendingKinds: {} };
    if (antiN >= 2) { S.firstLeader = fin[0]; return; }                  // 抗贡：头游先出，不动牌
    // 进贡（两段式）：候选=并列最大牌；真人且候选>1 → 挂起等选（P0-1 进贡选牌），否则自动
    var needGive = false;
    givRec.forEach(function (gr) {
      var cands = tributeCandidates(S.hands[gr.giver]);
      gr.candidates = cands;
      if (isHuman(gr.giver) && cands.length > 1) {
        gr.awaitGive = true; needGive = true;
        S.tribute.pending.push(gr.giver); S.tribute.pendingKinds[gr.giver] = 'give'; S.phase = 'tribute';
      } else {
        doGive(gr, cands[0]);
      }
    });
    if (needGive) return; // startRound 见 phase='tribute' 会挂起等 humanTributeGiveAt
    finishTributeGives(false);
  }
  function doGive(gr, card) {
    S.hands[gr.giver] = S.hands[gr.giver].filter(function (c) { return c.id !== card.id; });
    S.hands[gr.receiver].push(card); gr.held = card; gr.awaitGive = false;
  }
  // 进贡全部完成后：定领头 + 还贡（真人收贡者挂起等选，AI 自动还最小合规牌）
  function finishTributeGives(fromGiveAction) {
    var t = S.tribute, pairs = t.pairs;
    if (pairs.length === 1) S.firstLeader = pairs[0].giver;             // 单贡：末游先出
    else S.firstLeader = (cmp(pairs[0].held) === cmp(pairs[1].held)) ? (S.prevResult.finishOrder[0] + 1) % 4 : pairs[0].giver; // 双贡：进大牌者先出，同大=头游下家
    pairs.forEach(function (gr) {                                       // 还贡：真人等，AI 自动
      if (isHuman(gr.receiver)) { t.pending.push(gr.receiver); t.pendingKinds[gr.receiver] = 'back'; S.phase = 'tribute'; }
      else { var back = returnLow(S.hands[gr.receiver]); S.hands[gr.receiver] = S.hands[gr.receiver].filter(function (c) { return c.id !== back.id; }); S.hands[gr.giver].push(back); gr.back = back; }
    });
    if (fromGiveAction && t.pending.length === 0) { S.phase = 'double'; S.doubleTurn = 0; schedule(); }  // 无人待还贡：推进到加倍
  }
  // 进贡方选牌（P0-1）：所选必须在本对 candidates 内
  function humanTributeGiveAt(seat, id) {
    if (!(S.phase === 'tribute' && S.tribute && S.tribute.pendingKinds[seat] === 'give')) return false;
    var gr = S.tribute.pairs.filter(function (x) { return x.giver === seat && x.awaitGive; })[0];
    if (!gr) return false;
    var card = gr.candidates.filter(function (c) { return c.id === id; })[0];
    if (!card) return false;
    doGive(gr, card);
    S.tribute.pending = S.tribute.pending.filter(function (s) { return s !== seat; });
    delete S.tribute.pendingKinds[seat];
    var still = S.tribute.pairs.some(function (p) { return p.awaitGive; });
    if (!still) finishTributeGives(true); else render();
    return true;
  }
  function humanTributeGive(id) { return humanTributeGiveAt(0, id); }
  function humanTributeAt(seat, id) {
    if (!(S.phase === 'tribute' && S.tribute && S.tribute.pending.indexOf(seat) >= 0)) return false;
    if (S.tribute.pendingKinds[seat] !== 'back') return false;       // 该座是进贡方待办，请走 tributeGive
    var p = S.tribute.pairs.filter(function (x) { return x.receiver === seat; })[0];
    if (!p) return false;
    var card = S.hands[seat].filter(function (c) { return c.id === id; })[0];
    if (!card) return false;
    if (card.s === 'W' || isWildCard(card)) return false;            // 王/逢人配不能还
    if (S.hands[seat].filter(eligibleReturn).length && !eligibleReturn(card)) return false; // 有合规牌时必须还<=10 且非级牌
    S.hands[seat] = S.hands[seat].filter(function (c) { return c.id !== id; });
    S.hands[p.giver].push(card); p.back = card;
    S.tribute.pending = S.tribute.pending.filter(function (s) { return s !== seat; });
    if (S.tribute.pending.length === 0) { S.phase = 'double'; S.doubleTurn = 0; schedule(); }
    else render();
    return true;
  }
  function humanTribute(id) { return humanTributeAt(0, id); }
  // 测试缝：用指定上局名次/手牌/真人座跑一遍进贡，返回进贡状态（不依赖随机发牌）
  function _runTributeTest(level, finishOrder, hands, humans) {
    S = newMatch(800); S.level = level; S.roundNo = 2;
    humanSeats = (humans || []).slice();
    S.hands = hands.map(function (h) { return h.slice(); });
    S.prevResult = { finishOrder: finishOrder.slice() };
    runTribute();
    return { tribute: S.tribute, firstLeader: S.firstLeader, hands: S.hands, phase: S.phase };
  }

  // ---------- 加倍 ----------
  function doubleDecision(seat, yes) {
    if (S.phase !== 'double') return;
    S.doubled[seat] = !!yes;
    if (yes) S.mult = S.mode.gold ? Math.min(S.mult * 2, 50000) : Math.min(S.mult * 2, 64);
    S.doubleTurn++;
    if (S.doubleTurn >= 4) { S.phase = 'play'; S.turn = S.firstLeader; schedule(); }
    else schedule();
  }
  function doAIDouble() {
    var bombs = Rules.generateAllPlays(S.hands[S.doubleTurn], S.level).filter(function (p) { return Rules.isBomb(p); }).length;
    doubleDecision(S.doubleTurn, bombs >= 1 && Math.random() < 0.5);
  }
  function humanDoubleAt(seat, yes) { if (S.phase === 'double' && S.doubleTurn === seat) doubleDecision(seat, yes); }
  function humanDouble(yes) { humanDoubleAt(0, yes); }

  // ---------- 出牌 ----------
  // 金币场炸弹倍数表（APK 明文）：4炸/5炸/同花顺 ×2；6炸/7炸 ×2；8炸及以上 ×3；天王炸 ×5
  function bombMultFor(play) {
    if (play.type === 'rocket') return 5;
    if (play.type === 'sf') return 2;
    return play.cards.length >= 8 ? 3 : 2;
  }
  function applyPlay(seat, play) {
    var ids = {}; play.cards.forEach(function (c) { ids[c.id] = true; });
    S.hands[seat] = S.hands[seat].filter(function (c) { return !ids[c.id]; });
    S.top = { play: play, owner: seat }; S.passCount = 0;
    S.passed = [false, false, false, false];
    play.cards.forEach(function (c) { S.discarded.push(c.r); });
    if (Rules.isBomb(play)) S.mult = S.mode.gold ? Math.min(S.mult * bombMultFor(play), 50000) : Math.min(S.mult * 2, 64);
    if (S.hands[seat].length === 0) { S.finished[seat] = true; S.finishOrder.push(seat); }
    if (roundOver()) { endRound(); return; }
    S.turn = nextAlive(seat); schedule();
  }
  function applyPass(seat) {
    S.passCount++; S.passed[seat] = true;
    var needed = aliveCount() - (S.finished[S.top.owner] ? 0 : 1);
    if (S.passCount >= needed) {
      var w = S.top.owner; S.top = null; S.passCount = 0; S.passed = [false, false, false, false];
      S.turn = leaderAfter(w, S.finished); schedule();
    } else { S.turn = nextAlive(seat); schedule(); }
  }
  function doAITurn() {
    var seat = S.turn, ctx = { hand: S.hands[seat], level: S.level, top: S.top, self: seat, team: team };
    var play = AI.choose(ctx);
    if (play) applyPlay(seat, play); else applyPass(seat);
  }
  function humanPlayAt(seat, ids) {
    if (!(S.phase === 'play' && S.turn === seat && !S.finished[seat])) return false;
    var idset = {}; ids.forEach(function (x) { idset[x] = true; });
    var cards = S.hands[seat].filter(function (c) { return idset[c.id]; });
    if (cards.length !== ids.length) return false;
    var play = Rules.classify(cards, S.level);
    if (!play || (S.top && !Rules.canBeat(play, S.top.play))) return false;
    applyPlay(seat, play); return true;
  }
  function humanPlay(ids) { return humanPlayAt(0, ids); }
  function humanPassAt(seat) {
    if (!(S.phase === 'play' && S.turn === seat && !S.finished[seat]) || !S.top) return false;
    applyPass(seat); return true;
  }
  function humanPass() { return humanPassAt(0); }
  function humanTimeoutAt(seat) {
    if (S.phase === 'double' && S.doubleTurn === seat) { doubleDecision(seat, false); return; }  // 加倍超时=不加倍
    if (S.phase === 'tribute' && S.tribute && S.tribute.pending.indexOf(seat) >= 0) {
      // 进/还贡超时：系统代选（进贡取候选第一张，还贡取最小合规牌）
      if (S.tribute.pendingKinds[seat] === 'give') {
        var gr = S.tribute.pairs.filter(function (x) { return x.giver === seat && x.awaitGive; })[0];
        if (gr && gr.candidates.length) humanTributeGiveAt(seat, gr.candidates[0].id);
      } else {
        var pb = S.tribute.pairs.filter(function (x) { return x.receiver === seat; })[0];
        if (pb) humanTributeAt(seat, returnLow(S.hands[seat]).id);
      }
      return;
    }
    if (!(S.phase === 'play' && S.turn === seat && !S.finished[seat])) return;
    if (S.top) { humanPassAt(seat); return; }
    var all = Rules.generateAllPlays(S.hands[seat], S.level).filter(function (p) { return !Rules.isBomb(p); });
    all.sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); });
    if (all.length) applyPlay(seat, all[0]);
  }
  function humanTimeout() { humanTimeoutAt(0); }

  // 服务器统一动作入口
  function act(seat, action) {
    if (!isHuman(seat)) return false;
    switch (action && action.type) {
      case 'play': return humanPlayAt(seat, action.ids || []);
      case 'pass': return humanPassAt(seat);
      case 'double': humanDoubleAt(seat, !!action.yes); return true;
      case 'tribute': return humanTributeAt(seat, action.id);
      case 'tributeGive': return humanTributeGiveAt(seat, action.id);
      case 'timeout': humanTimeoutAt(seat); return true;
      default: return false;
    }
  }

  // ---------- 结算 + 升级 ----------
  function endRound() {
    S.phase = 'settle';
    for (var m = 0; m < 4; m++) if (S.finishOrder.indexOf(m) < 0) S.finishOrder.push(m); // 双上/双下时补全未走完者为三/末游
    var pos = [0, 0, 0, 0]; S.finishOrder.forEach(function (s, i) { pos[s] = i + 1; });
    for (var i = 0; i < 4; i++) if (pos[i] === 0) pos[i] = 4;
    var winTeam = team(S.finishOrder[0]);
    var wp = pos.map(function (p, i) { return team(i) === winTeam ? p : 0; }).filter(Boolean).sort(function (a, b) { return a - b; });
    var combo = (wp[0] === 1 && wp[1] === 2) ? 3 : (wp[0] === 1 && wp[1] === 3) ? 2 : 1;
    var comboName = combo === 3 ? '双上' : combo === 2 ? '头游+三游' : '头游+末游';
    var rankMult = combo === 3 ? 4 : combo === 2 ? 2 : 1;               // 金币场排名倍数（APK：双下4/一三游2/一四游1）
    var delta = S.base * S.mult * (S.mode.gold ? rankMult : combo), deltas = [0, 0, 0, 0];
    for (var s = 0; s < 4; s++) { deltas[s] = team(s) === winTeam ? delta : -delta; S.coins[s] += deltas[s]; }

    var adv = S.mode.gold ? { win: false } : advanceLevel(S.teamLevel[winTeam], combo);  // 金币场无升级/无终局
    S.dealerTeam = winTeam;
    S.prevResult = { finishOrder: S.finishOrder.slice(), pos: pos };
    if (adv.win) { S.matchOver = true; S.matchWinner = winTeam; }
    else if (!S.mode.gold) S.teamLevel[winTeam] = adv.level;

    S.lastResult = { finishOrder: S.finishOrder.slice(), pos: pos, winTeam: winTeam, combo: combo, comboName: comboName, rankMult: rankMult, delta: delta, deltas: deltas, newLevel: adv.win ? null : (S.mode.gold ? null : adv.level), matchOver: S.matchOver, matchWinner: S.matchWinner };
    save();
    render();
    if (UI && UI.onSettle) UI.onSettle(S.lastResult);
  }

  // ---------- 入口 ----------
  function toLobby() { S.phase = 'lobby'; if (UI && UI.onLobby) UI.onLobby(); render(); }
  function quickStart(base) { S = newMatch(base || S && S.base); startRound(); }
  function nextRound() { if (S.matchOver) return; startRound(); }
  function setNoShuffle(v) { lobbyMode.noShuffle = !!v; if (S && S.phase === 'lobby') render(); }
  function setGoldMode(v) { lobbyMode.gold = !!v; if (S && S.phase === 'lobby') render(); }
  function setBase(b) { if (S && S.phase === 'lobby') { S.base = b; render(); } }
  function setHumanSeats(arr) { humanSeats = (arr || []).slice(); }
  function setNames(arr) { if (arr && arr.length === 4) NAMES = arr.slice(); }
  function resume() { if (S && S.phase !== 'lobby') schedule(); }

  function init(ui) {
    UI = ui; persisted = loadPersisted(); S = newMatch(800);
    if (UI && UI.onLobby) UI.onLobby(); render();
  }

  var Game = {
    init: init, toLobby: toLobby, quickStart: quickStart, nextRound: nextRound,
    humanPlay: humanPlay, humanPass: humanPass, humanTimeout: humanTimeout, humanDouble: humanDouble,
    humanTribute: humanTribute, humanTributeGive: humanTributeGive,
    setNoShuffle: setNoShuffle, setBase: setBase, setGoldMode: setGoldMode,
    snapshot: snapshot, snapshotFor: snapshotFor, act: act, setHumanSeats: setHumanSeats,
    setNames: setNames, resume: resume,
    humanPlayAt: humanPlayAt, humanPassAt: humanPassAt, humanDoubleAt: humanDoubleAt,
    humanTributeAt: humanTributeAt, humanTributeGiveAt: humanTributeGiveAt, humanTimeoutAt: humanTimeoutAt,
    _tributeCandidates: tributeCandidates, _testFirstLeader: function () { return S && S.firstLeader; },
    _bombMultFor: bombMultFor,
    get RANK_LABEL() { return RANK_LABEL; }, get NAMES() { return NAMES; },
    set AUTO_ALL(v) { humanSeats = v ? [] : [0]; }, set sync(v) { SYNC = v; },
    _team: team, _partner: partner, _leaderAfter: leaderAfter, _runTributeTest: _runTributeTest,
    _testRoundOver: function (fin) { var s = S; S = { finished: fin }; var r = roundOver(); S = s; return r; }
  };
  return Game;
  } // end createGame

  var def = createGame();
  if (typeof module !== 'undefined' && module.exports) { module.exports = def; module.exports.createGame = createGame; }
  else { root.Game = def; root.createGame = createGame; }
})(typeof window !== 'undefined' ? window : globalThis);
