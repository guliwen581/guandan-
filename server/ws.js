'use strict';
/*
 * ws.js —— 极简 WebSocket（RFC6455）实现，零依赖。
 *  - 服务端：握手(acceptKey) + WsConnection(解客户端带掩码帧 / 发不带掩码帧)
 *  - encodeTextMasked / decodeFrame 也供 node 测试客户端复用。
 */
var crypto = require('crypto');
var GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// 单连接接收缓冲上限（字节）。合法游戏消息为 KB 级；超限即视为恶意/异常并断开，
// 防止攻击者声明一个超大帧长（len 低 32 位最大 ~4GB）缓慢喂数据导致内存耗尽。
var MAX_BUFFER = 1 << 20; // 1 MiB

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

// 服务端发送：文本帧，不加掩码
function encodeText(str) {
  var payload = Buffer.from(str, 'utf8'), len = payload.length, header;
  if (len < 126) { header = Buffer.alloc(2); header[0] = 0x81; header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  return Buffer.concat([header, payload]);
}

// 客户端发送：文本帧，加掩码（浏览器必须掩码；node 测试客户端用）
function encodeTextMasked(str) {
  var payload = Buffer.from(str, 'utf8'), len = payload.length, header;
  if (len < 126) { header = Buffer.alloc(2); header[0] = 0x81; header[1] = 0x80 | len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  var mask = Buffer.from([0x12, 0x34, 0x56, 0x78]), masked = Buffer.alloc(len);
  for (var i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

// 编码控制帧（pong=0xA / close=0x8），服务端不带掩码
function encodeControl(opcode, payloadStr) {
  var payload = Buffer.from(payloadStr || '', 'utf8');
  var header = Buffer.alloc(2);
  header[0] = 0x80 | opcode; header[1] = payload.length;
  return Buffer.concat([header, payload]);
}

// 从缓冲区解析一帧；数据不足返回 null。返回 {opcode, payload, rest}
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  var fin = (buf[0] & 0x80) !== 0, opcode = buf[0] & 0x0f;
  var b1 = buf[1], masked = (b1 & 0x80) !== 0, len = b1 & 0x7f, offset = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = buf.readUInt32BE(6); offset = 10; } // 忽略高 32 位
  var mask = null;
  if (masked) { if (buf.length < offset + 4) return null; mask = buf.slice(offset, offset + 4); offset += 4; }
  if (buf.length < offset + len) return null;
  var payload = buf.slice(offset, offset + len);
  if (masked) { var out = Buffer.alloc(len); for (var i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]; payload = out; }
  // payload=解码后字符串(单帧便捷用)；payloadBuf=原始字节(分片重组用，避免跨帧切断多字节字符)
  return { opcode: opcode, masked: masked, fin: fin, payload: payload.toString('utf8'), payloadBuf: payload, rest: buf.slice(offset + len) };
}

// 服务端连接包装：粘包处理 + ping/pong/close
function WsConnection(socket) {
  this.socket = socket;
  this.buf = Buffer.alloc(0);
  this.onMessage = null;
  this.onClose = null;
  this._closed = false;
  this._frag = null;                 // 分片消息累积区（Buffer 数组），null=当前无未完成消息
  var self = this;
  socket.on('data', function (d) { self._onData(d); });
  socket.on('close', function () { self._fireClose(); });
  socket.on('error', function () { self._fireClose(); });
}
WsConnection.prototype._fireClose = function () {
  if (this._closed) return; this._closed = true;
  if (this.onClose) this.onClose();
};
WsConnection.prototype._deliver = function (buf) {
  if (this.onMessage) { try { this.onMessage(buf.toString('utf8')); } catch (e) { /* 单条消息出错不断连 */ } }
};
WsConnection.prototype._onData = function (d) {
  this.buf = Buffer.concat([this.buf, d]);
  if (this.buf.length > MAX_BUFFER) { this.close(); return; }       // 缓冲超限：防内存耗尽
  while (true) {
    var f = decodeFrame(this.buf);
    if (!f) break;
    this.buf = f.rest;
    if (!f.masked) { this.close(); return; }                        // RFC6455：客户端帧必须带掩码
    if (f.opcode >= 0x8) {                                          // 控制帧
      if (!f.fin || f.payloadBuf.length > 125) { this.close(); return; } // 控制帧须 FIN=1 且载荷<=125
      if (f.opcode === 0x8) { this.close(); return; }               // close
      if (f.opcode === 0x9) { this._sendRaw(encodeControl(0xA, f.payload)); } // ping → pong
      continue;                                                     // pong(0xA) 等忽略
    }
    if (f.opcode === 0x0) {                                         // 续帧
      if (!this._frag) { this.close(); return; }                    // 无起始帧的续帧 -> 协议错误
      this._frag.push(f.payloadBuf);
      if (f.fin) { var msg = Buffer.concat(this._frag); this._frag = null; this._deliver(msg); }
    } else {                                                        // 数据帧 text(0x1)/binary(0x2)
      if (this._frag) { this.close(); return; }                     // 上一消息未结束又来新数据帧 -> 协议错误
      if (f.fin) { this._deliver(f.payloadBuf); }
      else { this._frag = [f.payloadBuf]; }                         // 起始分片，等待续帧
    }
  }
};
WsConnection.prototype._sendRaw = function (buf) {
  if (this._closed) return;
  try { this.socket.write(buf); } catch (e) {}
};
WsConnection.prototype.send = function (obj) {
  this._sendRaw(encodeText(typeof obj === 'string' ? obj : JSON.stringify(obj)));
};
WsConnection.prototype.close = function () {
  this._sendRaw(encodeControl(0x8, ''));
  try { this.socket.end(); } catch (e) {}
  this._fireClose();
};

module.exports = {
  acceptKey: acceptKey, encodeText: encodeText, encodeTextMasked: encodeTextMasked,
  encodeControl: encodeControl, decodeFrame: decodeFrame, WsConnection: WsConnection,
  MAX_BUFFER: MAX_BUFFER
};
