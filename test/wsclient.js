'use strict';
/*
 * wsclient.js —— node 端 WebSocket 客户端（供网络测试用，复用 server/ws.js 的编解码）。
 * 浏览器请用原生 WebSocket（见 js/net.js）。
 */
var net = require('net');
var crypto = require('crypto');
var WS = require('../server/ws.js');

function connect(port, host, onOpen) {
  host = host || '127.0.0.1';
  var socket = net.connect(port, host, function () {
    var key = crypto.randomBytes(16).toString('base64');
    socket.write('GET / HTTP/1.1\r\nHost: ' + host + ':' + port + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  var client = { onMessage: null, onClose: null, _buf: Buffer.alloc(0), _hs: false, _hsBuf: '' };
  function pump(d) {
    client._buf = Buffer.concat([client._buf, d]);
    while (true) {
      var f = WS.decodeFrame(client._buf);
      if (!f) break;
      client._buf = f.rest;
      if (f.opcode === 0x1 && client.onMessage) client.onMessage(f.payload);
    }
  }
  socket.on('data', function (d) {
    if (!client._hs) {
      client._hsBuf += d.toString('binary');
      var idx = client._hsBuf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      var rest = Buffer.from(client._hsBuf.slice(idx + 4), 'binary');
      client._hs = true;
      if (onOpen) onOpen(client);
      if (rest.length) pump(rest);
    } else pump(d);
  });
  socket.on('close', function () { if (client.onClose) client.onClose(); });
  socket.on('error', function () {});
  client.send = function (obj) { try { socket.write(WS.encodeTextMasked(typeof obj === 'string' ? obj : JSON.stringify(obj))); } catch (e) {} };
  client.close = function () { try { socket.end(); } catch (e) {} };
  return client;
}

module.exports = { connect: connect };
