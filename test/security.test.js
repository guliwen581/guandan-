'use strict';
/*
 * security.test.js —— 服务器安全加固回归（真实起服务器，端到端）：
 *  S1 单连接缓冲上限（超限断开，防内存耗尽 DoS）
 *  S2 服务端拒绝未掩码的客户端帧（RFC6455）
 *  S3 静态文件路径穿越防护（精确 ROOT 前缀判断）
 *  S4 WS 升级 Origin 同源校验（拦截跨站 WebSocket 劫持）
 *  Q1 分片帧重组 / 控制帧须 FIN=1 且载荷<=125 / 孤立续帧断开
 *  另含 decodeFrame 掩码标志的纯函数校验。
 */
process.env.PORT = '8129';
var net = require('net'), http = require('http'), crypto = require('crypto');
var WS = require('../server/ws.js');

var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }

// ---- 纯函数：decodeFrame 回传 masked / fin ----
(function () {
  var masked = WS.decodeFrame(WS.encodeTextMasked('{"a":1}'));
  var plain = WS.decodeFrame(WS.encodeText('{"a":1}'));
  check('decodeFrame 掩码帧 masked=true', masked && masked.masked === true && masked.fin === true && masked.payload === '{"a":1}');
  check('decodeFrame 非掩码帧 masked=false', plain && plain.masked === false);
})();

require('../server/main.js'); // 监听 8129
var PORT = 8129;

// 建连并完成 WS 握手（不带 Origin，模拟非浏览器客户端），cb(socket) 在握手成功后调用
function wsConnect(cb) {
  var socket = net.connect(PORT, '127.0.0.1', function () {
    var key = crypto.randomBytes(16).toString('base64');
    socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:' + PORT + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  var hsBuf = '', done = false;
  socket.on('data', function onData(d) {
    if (done) return;
    hsBuf += d.toString('binary');
    if (hsBuf.indexOf('\r\n\r\n') >= 0) { done = true; socket.removeListener('data', onData); cb(socket); }
  });
  socket.on('error', function () {});
  return socket;
}

// 构造"带掩码"的任意帧（可指定 fin/opcode），用于分片/控制帧测试
function encFrame(fin, opcode, str) {
  var payload = Buffer.from(str, 'utf8'), len = payload.length;
  var header = Buffer.alloc(2);
  header[0] = (fin ? 0x80 : 0) | opcode;
  header[1] = 0x80 | len;                       // 掩码位 + 长度(<126)
  var mask = Buffer.from([1, 2, 3, 4]), masked = Buffer.alloc(len);
  for (var i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}
// 带掩码、载荷>125 的控制帧（用 16 位长度编码）
function encBigControl(opcode, n) {
  var payload = Buffer.alloc(n, 0x61);
  var header = Buffer.alloc(4);
  header[0] = 0x80 | opcode; header[1] = 0x80 | 126; header.writeUInt16BE(n, 2);
  var mask = Buffer.from([1, 2, 3, 4]), masked = Buffer.alloc(n);
  for (var i = 0; i < n; i++) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

// 期望服务器在 timeout 内主动断开
function expectClose(name, drive, next) {
  var finished = false;
  var socket = wsConnect(function (s) { drive(s); });
  var timer = setTimeout(function () { if (!finished) { finished = true; check(name, false); try { socket.destroy(); } catch (e) {} next(); } }, 3000);
  socket.on('close', function () { if (!finished) { finished = true; clearTimeout(timer); check(name, true); next(); } });
}

// 发送若干帧，期望服务器组装处理后回送含 matchStr 的消息
function expectReply(name, frames, matchStr, next) {
  var finished = false, acc = Buffer.alloc(0);
  var socket = wsConnect(function (s) { frames.forEach(function (f) { s.write(f); }); });
  var timer = setTimeout(function () { if (!finished) { finished = true; check(name, false); try { socket.destroy(); } catch (e) {} next(); } }, 3000);
  socket.on('data', function (d) {
    acc = Buffer.concat([acc, d]);
    while (true) {
      var f = WS.decodeFrame(acc); if (!f) break; acc = f.rest;
      if (f.payload.indexOf(matchStr) >= 0 && !finished) {
        finished = true; clearTimeout(timer); check(name, true); try { socket.destroy(); } catch (e) {} next();
      }
    }
  });
  socket.on('error', function () {});
}

// 握手时附带额外头，回传 HTTP 状态码
function handshakeStatus(extraHeaders, cb) {
  var socket = net.connect(PORT, '127.0.0.1', function () {
    var key = crypto.randomBytes(16).toString('base64');
    socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:' + PORT + '\r\n' + extraHeaders + 'Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  var buf = '', done = false;
  var t = setTimeout(function () { if (!done) { done = true; cb(-1); try { socket.destroy(); } catch (e) {} } }, 3000);
  socket.on('data', function (d) {
    if (done) return; buf += d.toString('binary');
    if (buf.indexOf('\r\n') >= 0) { done = true; clearTimeout(t); cb(parseInt(buf.split(' ')[1], 10) || -1); try { socket.destroy(); } catch (e) {} }
  });
  socket.on('error', function () {});
}

function httpStatus(pathname, cb) {
  http.get({ host: '127.0.0.1', port: PORT, path: pathname }, function (res) { res.resume(); cb(res.statusCode); }).on('error', function () { cb(-1); });
}

var steps = [];

// S2：未掩码文本帧 -> 断开
steps.push(function (next) { expectClose('S2 未掩码客户端帧被断开', function (s) { s.write(WS.encodeText('{"type":"join","room":"new"}')); }, next); });
// S1：灌超上限数据 -> 断开
steps.push(function (next) { expectClose('S1 缓冲超过上限被断开', function (s) { s.write(Buffer.alloc(WS.MAX_BUFFER + 1024, 0)); }, next); });
// Q1：孤立续帧(无起始帧) -> 断开
steps.push(function (next) { expectClose('Q1 孤立续帧被断开', function (s) { s.write(encFrame(true, 0x0, 'x')); }, next); });
// Q1：超大控制帧(ping 载荷>125) -> 断开
steps.push(function (next) { expectClose('Q1 超大控制帧被断开', function (s) { s.write(encBigControl(0x9, 200)); }, next); });
// Q1：合法分片消息被正确组装并处理（拆成两片发的 join 能得到 joined 回执）
steps.push(function (next) {
  var msg = '{"type":"join","room":"FRAG","name":"X","base":800}';
  var half = Math.floor(msg.length / 2);
  var frames = [encFrame(false, 0x1, msg.slice(0, half)), encFrame(true, 0x0, msg.slice(half))];
  expectReply('Q1 分片帧被正确组装处理', frames, '"joined"', next);
});
// S4：Origin 同源校验
steps.push(function (next) { handshakeStatus('', function (c) { check('S4 无 Origin(非浏览器) 放行 101', c === 101); next(); }); });
steps.push(function (next) { handshakeStatus('Origin: http://127.0.0.1:' + PORT + '\r\n', function (c) { check('S4 同源 Origin 放行 101', c === 101); next(); }); });
steps.push(function (next) { handshakeStatus('Origin: http://evil.com\r\n', function (c) { check('S4 跨站 Origin 拒绝 403', c === 403); next(); }); });
// S3：路径穿越
steps.push(function (next) { httpStatus('/../../etc/passwd', function (c) { check('S3 穿越请求返回403', c === 403); next(); }); });
steps.push(function (next) { httpStatus('/index.html', function (c) { check('S3 合法路径返回200', c === 200); next(); }); });
steps.push(function (next) { httpStatus('/js/rules.js', function (c) { check('S3 子目录合法文件200', c === 200); next(); }); });

(function run(i) {
  if (i >= steps.length) {
    console.log('\n通过 ' + passes + ' / 失败 ' + fails);
    process.exit(fails ? 1 : 0);
  }
  steps[i](function () { run(i + 1); });
})(0);
