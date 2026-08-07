'use strict';
/*
 * spectate.test.js —— P2 观战：spectate 加入已开局房间 → 收到只读快照(watch=true)；
 * 观战者 act/start 无效；房主解散时观战者收到 dissolved。
 */
process.env.PORT = '8129';
process.env.FAST = '1';

var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }

require('../server/main.js');
var wsclient = require('./wsclient.js');
var PORT = 8129, finished = false;

var host = null, watcher = null;
var watchSnaps = 0, watchFlagOk = false, dissolvedGot = false, watchSeat = null;
var wd = setTimeout(fin, 8000);
function fin() {
  if (finished) return; finished = true; clearTimeout(wd);
  check('观战者收到快照', watchSnaps >= 1);
  check('观战快照带 watch 标志且座位=-1', watchFlagOk && watchSeat === -1);
  check('解散时观战者收到 dissolved', dissolvedGot);
  try { host.close(); } catch (e) {}
  try { watcher.close(); } catch (e) {}
  console.log('\n通过 ' + passes + ' / 失败 ' + fails);
  process.exit(fails ? 1 : 0);
}

host = wsclient.connect(PORT, '127.0.0.1', function () { host.send({ type: 'join', room: 'W100', name: 'Host' }); });
host.onMessage = function (text) {
  var m; try { m = JSON.parse(text); } catch (e) { return; }
  if (m.type === 'joined') {
    host.send({ type: 'start' });   // 单人开局（其余 AI 补位）
    setTimeout(function () {
      watcher = wsclient.connect(PORT, '127.0.0.1', function () { watcher.send({ type: 'join', room: 'W100', spectate: true }); });
      watcher.onMessage = function (t2) {
        var m2; try { m2 = JSON.parse(t2); } catch (e) { return; }
        if (m2.type === 'joined') { watchSeat = m2.seat; }
        else if (m2.type === 'snapshot') { watchSnaps++; if (m2.watch) watchFlagOk = true; }
        else if (m2.type === 'dissolved') { dissolvedGot = true; setTimeout(fin, 50); }
      };
      // 观战者尝试操作/开局 → 应被服务器忽略（不改变局面，无报错帧）
      setTimeout(function () {
        watcher.send({ type: 'act', action: { type: 'pass' } });
        watcher.send({ type: 'start' });
        setTimeout(function () { host.send({ type: 'dissolve' }); }, 300);
      }, 600);
    }, 400);
  }
};
