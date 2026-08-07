'use strict';
/*
 * friendroom.test.js —— P1-1 好友房增强：
 *  1) 引擎：限定局数赛制（rounds=4 打完按金币决胜，matchOver）
 *  2) 联机：房主解散房间（dissolved 广播）；非房主解散被忽略
 */
process.env.PORT = '8127';
process.env.FAST = '1';

var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }

// ---- 引擎：限定 4 局 ----
var createGame = require('../js/game.js').createGame;
var G = createGame();
G.init({ render: function () {}, onSettle: function () {}, onLobby: function () {} });
G.sync = true; G.AUTO_ALL = true;
G.setMatchRounds(4);
G.quickStart(800);
var overEarly = false, overAt4 = false, winnerOk = false;
for (var r = 1; r <= 4; r++) {
  var sn = G.snapshot();
  if (sn.phase !== 'settle') break;
  if (r < 4 && sn.matchOver) overEarly = true;
  if (r === 4) {
    overAt4 = sn.matchOver;
    var t0 = sn.seats[0].coins + sn.seats[2].coins, t1 = sn.seats[1].coins + sn.seats[3].coins;
    winnerOk = sn.matchWinner === (t0 >= t1 ? 0 : 1);
  }
  if (!sn.matchOver) G.nextRound();
}
check('限定局数 前3局不终局', !overEarly);
check('限定局数 第4局终局', overAt4);
check('终局胜方=金币多的队', winnerOk);

// ---- 联机：解散 ----
require('../server/main.js');
var wsclient = require('./wsclient.js');
var PORT = 8127, finished = false;

var c0 = null, c1 = null, got0 = false, got1 = false, nonHostDissolved = false, hostSent = false;
var wd = setTimeout(function () { fin(); }, 6000);
function fin() {
  if (finished) return; finished = true; clearTimeout(wd);
  check('非房主解散被忽略', !nonHostDissolved);
  check('房主解散→双方收到 dissolved', got0 && got1);
  try { c0.close(); } catch (e) {}
  try { if (c1) c1.close(); } catch (e) {}
  console.log('\n通过 ' + passes + ' / 失败 ' + fails);
  process.exit(fails ? 1 : 0);
}
c0 = wsclient.connect(PORT, '127.0.0.1', function () { c0.send({ type: 'join', room: 'D100', name: 'Host' }); });
c0.onMessage = function (text) {
  var m; try { m = JSON.parse(text); } catch (e) { return; }
  if (m.type === 'joined') {
    c1 = wsclient.connect(PORT, '127.0.0.1', function () { c1.send({ type: 'join', room: 'D100', name: 'Guest', rounds: 4 }); });
    c1.onMessage = function (t2) {
      var m2; try { m2 = JSON.parse(t2); } catch (e) { return; }
      if (m2.type === 'joined') {
        c1.send({ type: 'dissolve' });                    // 非房主尝试解散 → 应无效
        setTimeout(function () {
          if (got0 || got1) nonHostDissolved = true;      // 若此时已收到 dissolved，说明非房主解散生效了
          hostSent = true;
          c0.send({ type: 'dissolve' });                  // 房主解散
        }, 250);
      } else if (m2.type === 'dissolved') {
        got1 = true; if (got0) setTimeout(fin, 50);
      }
    };
  } else if (m.type === 'dissolved') {
    got0 = true; if (got1) setTimeout(fin, 50);
  }
};
