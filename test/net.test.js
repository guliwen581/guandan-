'use strict';
/*
 * net.test.js —— 联机端到端：启动真实 WS 服务器，多个 node 客户端经 WebSocket
 * 加入房间、开始、出牌，校验整局走通（握手/帧/房间/视角快照/动作分发全链路）。
 */
process.env.PORT = '8123';
process.env.FAST = '1'; // AI 同步秒出，加速 1 真人+AI 局

var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }

require('../server/main.js'); // 监听 8123
var wsclient = require('./wsclient.js');
var Cards = require('../js/cards.js');
var Rules = require('../js/rules.js');
var PORT = 8123;

function legalMoveIds(sn) {
  var cards = sn.seats[0].cards, level = sn.level;
  var all = Rules.generateAllPlays(cards, level);
  if (!sn.top) { var nb = all.filter(function (p) { return !Rules.isBomb(p); }).sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); }); return { ids: (nb[0] || all[0]).cards.map(function (c) { return c.id; }) }; }
  var beats = all.filter(function (p) { return Rules.canBeat(p, sn.top.play); });
  var nb2 = beats.filter(function (p) { return !Rules.isBomb(p); }).sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); });
  return nb2.length ? { ids: nb2[0].cards.map(function (c) { return c.id; }) } : { pass: true };
}
function tributeId(cards, level) {
  function elig(c) { return c.s !== 'W' && !(c.s === 'H' && c.r === level) && c.r !== level && Cards.baseValue(c.r) <= 10; }
  var e = cards.filter(elig); var pool = e.length ? e : cards.filter(function (c) { return c.s !== 'W' && !(c.s === 'H' && c.r === level); });
  pool.sort(function (a, b) { return Cards.cmpValue(a.r, level) - Cards.cmpValue(b.r, level); });
  return pool[0].id;
}

// humans 个客户端联机打一局；其余位由服务器 AI 补。完成回调 done(settleSnap|null)
function runOnlineGame(roomCode, humans, timeoutMs, done) {
  var clients = [], snaps = [null, null, null, null], seatOf = [], joined = 0;
  var settled = false, lastSeq = -1, finished = false;
  function finish(sn) { if (finished) return; finished = true; clients.forEach(function (c) { try { c.close(); } catch (e) {} }); done(sn); }
  var watchdog = setTimeout(function () { finish(null); }, timeoutMs);
  function tryAct() {
    if (settled) return;
    for (var s = 0; s < 4; s++) {
      var m = snaps[s]; if (!m) continue; var sn = m.snap;
      if (sn.phase === 'settle') { settled = true; clearTimeout(watchdog); finish(sn); return; }
      if (!(sn.canDouble || sn.canTribute || sn.canPlay)) continue;
      if (m.seq <= lastSeq) return;      // 同一状态只出一手，防重复
      lastSeq = m.seq;
      if (sn.canDouble) { clients[s].send({ type: 'act', action: { type: 'double', yes: false } }); return; }
      if (sn.canTribute) { var h = sn.seats[0].cards; clients[s].send({ type: 'act', action: { type: 'tribute', id: tributeId(h, sn.level) } }); return; }
      var mv = legalMoveIds(sn); clients[s].send({ type: 'act', action: mv.pass ? { type: 'pass' } : { type: 'play', ids: mv.ids } }); return;
    }
  }
  for (var i = 0; i < humans; i++) {
    (function (idx) {
      var c = wsclient.connect(PORT, '127.0.0.1', function () {
        c.send({ type: 'join', room: roomCode, name: 'P' + idx, base: 800 });
      });
      c.onMessage = function (text) {
        var msg; try { msg = JSON.parse(text); } catch (e) { return; }
        if (msg.type === 'joined') {
          seatOf[idx] = msg.seat; joined++;
          if (joined === humans) setTimeout(function () { clients[0].send({ type: 'start' }); }, 30);
        } else if (msg.type === 'snapshot') {
          snaps[seatOf[idx]] = { seq: msg.seq, snap: msg.snap }; tryAct();
        }
      };
      clients[idx] = c;
    })(i);
  }
}

function asyncCheck(name, roomCode, humans, validate, next) {
  runOnlineGame(roomCode, humans, 15000, function (sn) {
    var ok = false, why = '';
    if (!sn) { why = '超时未结算'; }
    else { var r = validate(sn); ok = r.ok; why = r.why || ''; }
    check(name + (why ? ' (' + why + ')' : ''), ok);
    next();
  });
}

console.log('--- 联机：4 真人 ---');
var steps = [];
steps.push(function (next) {
  asyncCheck('4真人联机整局到结算+不变量', '1111', 4, function (sn) {
    if (sn.finishOrder.length !== 4) return { ok: false, why: 'finishOrder!=4' };
    var sum = 0; for (var s = 0; s < 4; s++) sum += sn.seats[s].coins;
    if (sum !== 40000) return { ok: false, why: '金币不守恒=' + sum };
    return { ok: true };
  }, next);
});
steps.push(function (next) {
  asyncCheck('1真人+3AI联机整局到结算', '2222', 1, function (sn) {
    if (sn.finishOrder.length !== 4) return { ok: false, why: 'finishOrder!=4' };
    if (sn.seats[0].handCount !== 0 && sn.finishOrder.indexOf(0) < 0) return { ok: false, why: '视角异常' };
    return { ok: true };
  }, next);
});
steps.push(function (next) {
  // 视角正确性：2 真人，各自快照里自己恒在 0 号位、对家在 2 号位
  var clients = [], snaps = [null, null], seatOf = [], joined = 0, settled = false, lastSeq = -1, finished = false;
  function fin(ok) { if (finished) return; finished = true; clients.forEach(function (c) { try { c.close(); } catch (e) {} }); check('2真人各自视角自己恒在0号位', ok); next(); }
  var wd = setTimeout(function () { fin(false); }, 15000);
  function tryAct() {
    if (settled) return;
    for (var s = 0; s < 2; s++) {
      var m = snaps[s]; if (!m) continue; var sn = m.snap;
      if (sn.phase === 'settle') {
        // 校验视角：自己(0号位)名字以 P 开头，且 self===0
        var ok = sn.self === 0 && sn.seats[0].name.indexOf('P') === 0;
        settled = true; clearTimeout(wd); fin(ok); return;
      }
      if (!(sn.canDouble || sn.canPlay)) continue;
      if (m.seq <= lastSeq) return;
      lastSeq = m.seq;
      if (sn.canDouble) { clients[s].send({ type: 'act', action: { type: 'double', yes: false } }); return; }
      var mv = legalMoveIds(sn); clients[s].send({ type: 'act', action: mv.pass ? { type: 'pass' } : { type: 'play', ids: mv.ids } }); return;
    }
  }
  for (var i = 0; i < 2; i++) (function (idx) {
    var c = wsclient.connect(PORT, '127.0.0.1', function () { c.send({ type: 'join', room: '3333', name: 'P' + idx, base: 800 }); });
    c.onMessage = function (text) {
      var msg; try { msg = JSON.parse(text); } catch (e) { return; }
      if (msg.type === 'joined') { seatOf[idx] = msg.seat; if (seatOf[idx] < 2) snaps[seatOf[idx]] = null; joined++; if (joined === 2) setTimeout(function () { clients[0].send({ type: 'start' }); }, 30); }
      else if (msg.type === 'snapshot') { if (seatOf[idx] < 2) snaps[seatOf[idx]] = { seq: msg.seq, snap: msg.snap }; tryAct(); }
    };
    clients[idx] = c;
  })(i);
});

(function run(i) {
  if (i >= steps.length) {
    console.log('\n通过 ' + passes + ' / 失败 ' + fails);
    process.exit(fails ? 1 : 0);
  }
  steps[i](function () { run(i + 1); });
})(0);
