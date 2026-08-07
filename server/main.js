'use strict';
/*
 * main.js —— 掼蛋联机服务器（零依赖，node 直接运行）
 *   node server/main.js   （默认端口 8100，可用 PORT=xxxx 覆盖）
 *
 * 职责：
 *  1) 同端口托管静态页面（index.html / js / css），浏览器开 http://127.0.0.1:8100 即玩；
 *  2) 同端口处理 WebSocket 升级，承载房间制联机对战；
 *  3) 每个房间一个独立 createGame() 实例（权威状态在服务器），按各客户端视角
 *     下发 snapshotFor(seat) 旋转快照；空位由引擎 AI 自动补。
 *
 * 协议（JSON 文本帧）：
 *  客户端→服务器：
 *    {type:'join', room:'CODE', name:'昵称', base:800}   创建/加入房间
 *    {type:'start'}                                       房主开始（空位补 AI）
 *    {type:'act', action:{type:'play',ids:[..]}|{type:'pass'}|{type:'double',yes:bool}|{type:'tribute',id:..}}
 *    {type:'next'}                                        结算后来一局
 *    {type:'chat', text:'...'}
 *  服务器→客户端：
 *    {type:'joined', room, seat}
 *    {type:'room', code, base, started, seats:[{seat,name,connected}]}
 *    {type:'snapshot', snap}    （该客户端视角的完整快照）
 *    {type:'chat', seat, text}
 *    {type:'error', msg}
 */
var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');
var WS = require('./ws.js');
var createGame = require('../js/game.js').createGame;

var PORT = process.env.PORT || 8100;
var ROOT = path.join(__dirname, '..');

var rooms = {};

// 资源上限：防止单个客户端批量建房/挂连接耗尽内存（S5）。
var MAX_ROOMS = 1000;   // 同时存在的房间数上限
var MAX_CONNS = 500;    // 同时在线 WebSocket 连接数上限
var conns = 0;          // 当前活跃连接数

function Room(code, base, gold, rounds) {
  this.code = code;
  this.base = base || 800;
  this.gold = !!gold;   // 金币场（P0-4）：建房时确定，整场有效
  this.rounds = (rounds === 4 || rounds === 8 || rounds === 16) ? rounds : 0;  // 好友房限定局数（P1-1），0=不限
  this.seats = [null, null, null, null]; // {conn, name}
  this.watchers = [];                    // 观战连接列表（只读快照，seat=-1）
  this.started = false;
  this.game = createGame();
  if (process.env.FAST) this.game.sync = true; // 测试用：AI 同步秒出
  var self = this;
  this.game.init({
    render: function () { self.broadcast(); },
    onSettle: function () { self.broadcast(); },
    onLobby: function () {}
  });
}
Room.prototype.humanSeats = function () {
  var a = []; for (var s = 0; s < 4; s++) if (this.seats[s] && this.seats[s].conn) a.push(s); return a;
};
Room.prototype.names = function () {
  return this.seats.map(function (o, i) { return o ? o.name : '电脑' + (i + 1); });
};
Room.prototype.broadcast = function () {
  if (!this.started) return;
  this.seq = (this.seq || 0) + 1;
  for (var s = 0; s < 4; s++) {
    var o = this.seats[s];
    if (o && o.conn) o.conn.send({ type: 'snapshot', seq: this.seq, snap: this.game.snapshotFor(s) });
  }
  for (var w = 0; w < this.watchers.length; w++) {   // 观战位：0号位视角只读快照
    try { this.watchers[w].send({ type: 'snapshot', seq: this.seq, snap: this.game.snapshotFor(0), watch: true }); } catch (e) {}
  }
  this.scheduleTimeouts();   // P0-2 服务器权威计时：每个待行动真人 20s，超时引擎代打
};
Room.prototype.TIMEOUT_MS = 20000;
Room.prototype.clearTimeouts = function () {
  if (this._timers) for (var k in this._timers) clearTimeout(this._timers[k]);
  this._timers = {};
};
Room.prototype.scheduleTimeouts = function () {
  this.clearTimeouts();
  var self = this;
  for (var s = 0; s < 4; s++) {
    var o = this.seats[s];
    if (!o || !o.conn) continue;
    var sn = this.game.snapshotFor(s);
    if (sn.canPlay || sn.canDouble || sn.canTribute) {
      this._timers[s] = setTimeout(function (seat) {
        self.game.act(seat, { type: 'timeout' });   // 引擎代出/代过/不加倍/代选贡
      }, this.TIMEOUT_MS, s);
    }
  }
};
Room.prototype.roomInfo = function () {
  return {
    type: 'room', code: this.code, base: this.base, gold: this.gold, rounds: this.rounds, started: this.started,
    seats: this.seats.map(function (o, i) { return { seat: i, name: o ? o.name : null, connected: !!(o && o.conn) }; })
  };
};
Room.prototype.broadcastRoom = function () {
  var info = this.roomInfo();
  for (var s = 0; s < 4; s++) { var o = this.seats[s]; if (o && o.conn) o.conn.send(info); }
  for (var w = 0; w < this.watchers.length; w++) { try { this.watchers[w].send(info); } catch (e) {} }
};
Room.prototype.removeWatcher = function (conn) {
  this.watchers = this.watchers.filter(function (c) { return c !== conn; });
};
Room.prototype.freeSeat = function () { for (var s = 0; s < 4; s++) if (!this.seats[s]) return s; return -1; };
Room.prototype.start = function () {
  if (this.started) return;
  if (!this.humanSeats().length) return;
  this.started = true;
  this.game.setNames(this.names());
  this.game.setGoldMode(this.gold);
  this.game.setMatchRounds(this.rounds);
  this.game.setHumanSeats(this.humanSeats()); // 未坐人的位由 AI 补
  this.game.quickStart(this.base);
};
Room.prototype.next = function () {
  if (!this.started) return;
  var sn = this.game.snapshot();
  if (sn.matchOver) { // 整场结束：重开一场
    this.game.setNames(this.names());
    this.game.setHumanSeats(this.humanSeats());
    this.game.quickStart(this.base);
    return;
  }
  this.game.nextRound();
};
Room.prototype.onLeave = function (seat) {
  if (!this.seats[seat]) return;
  this.seats[seat] = null;
  this.clearTimeouts();    // 座位变化后由下一次 broadcast 重建计时
  var self = this;
  function notifyWatchersEnd() { self.watchers.forEach(function (c) { try { c.send({ type: 'dissolved' }); } catch (e) {} }); self.watchers = []; }
  if (this.started) {
    this.game.setHumanSeats(this.humanSeats()); // 离开者的位交给 AI 续玩
    this.game.resume();
    this.broadcast();
    if (!this.humanSeats().length) { notifyWatchersEnd(); delete rooms[this.code]; } // 全走了，回收房间
  } else {
    this.broadcastRoom();
    if (!this.humanSeats().length) { notifyWatchersEnd(); delete rooms[this.code]; }
  }
};

function genCode() {
  var c; do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms[c]);
  return c;
}

function handleConn(conn) {
  var room = null, seat = -1, watching = false;
  conn.onMessage = function (text) {
    var msg; try { msg = JSON.parse(text); } catch (e) { return; }
    if (msg.type === 'join') {
      if (room) return; // 一个连接只进一个房间
      var code = msg.room === 'new' ? genCode() : String(msg.room || '').toUpperCase();
      if (!/^[0-9A-Z]{3,8}$/.test(code)) { conn.send({ type: 'error', msg: '房间号无效' }); return; }
      if (msg.spectate) {   // 观战：只进已存在的房间，只读快照（P2 观战）
        if (!rooms[code]) { conn.send({ type: 'error', msg: '房间不存在' }); return; }
        room = rooms[code]; watching = true; seat = -1;
        if (room.watchers.length >= 50) { conn.send({ type: 'error', msg: '观战人数已满' }); room = null; watching = false; return; }
        room.watchers.push(conn);
        conn.send({ type: 'joined', room: room.code, seat: -1 });
        room.broadcastRoom();
        if (room.started) room.broadcast();   // 已在打：立即推一帧当前局面
        return;
      }
      if (!rooms[code]) {
        if (Object.keys(rooms).length >= MAX_ROOMS) { conn.send({ type: 'error', msg: '服务器房间已满' }); return; }
        rooms[code] = new Room(code, msg.base || 800, !!msg.gold, msg.rounds);
      }
      room = rooms[code];
      if (room.started) { conn.send({ type: 'error', msg: '该局已开始，无法加入' }); room = null; return; }
      seat = room.freeSeat();
      if (seat < 0) { conn.send({ type: 'error', msg: '房间已满' }); room = null; return; }
      room.seats[seat] = { conn: conn, name: (msg.name || '玩家' + (seat + 1)).slice(0, 8) };
      conn.send({ type: 'joined', room: room.code, seat: seat });
      room.broadcastRoom();
    } else if (msg.type === 'start') {
      if (room && seat >= 0) room.start();   // 观战者不能开局
    } else if (msg.type === 'act') {
      if (room && seat >= 0) room.game.act(seat, msg.action || {});   // 观战者不能操作
    } else if (msg.type === 'next') {
      if (room && seat >= 0) room.next();
    } else if (msg.type === 'dissolve') {
      if (room && seat === 0) {   // 仅房主(0号位)可解散（P1-1）
        room.clearTimeouts();
        for (var ds = 0; ds < 4; ds++) { var dso = room.seats[ds]; if (dso && dso.conn) dso.conn.send({ type: 'dissolved' }); }
        for (var dw = 0; dw < room.watchers.length; dw++) { try { room.watchers[dw].send({ type: 'dissolved' }); } catch (e) {} }
        delete rooms[room.code];
        room = null; seat = -1; watching = false;
      }
    } else if (msg.type === 'chat') {
      if (!room || seat < 0) return;   // 观战者禁言
      var m = { type: 'chat', seat: seat, text: String(msg.text || '').slice(0, 60) };
      for (var s = 0; s < 4; s++) { var o = room.seats[s]; if (o && o.conn) o.conn.send(m); }
    } else if (msg.type === 'leave' && watching && room) {
      room.removeWatcher(conn); room = null; watching = false;
    }
  };
  conn.onClose = function () {
    if (room && watching) room.removeWatcher(conn);
    else if (room && seat >= 0) room.onLeave(seat);
  };
}

// ---- 静态文件 ----
var CT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
function serveStatic(req, res) {
  var p = decodeURIComponent(url.parse(req.url).pathname);
  if (p === '/') p = '/index.html';
  var file = path.normalize(path.join(ROOT, p));
  // 精确前缀判断：必须等于 ROOT 或位于 ROOT 子目录下，避免 /ROOT-evil 同前缀目录绕过（S3）
  if (file !== ROOT && file.indexOf(ROOT + path.sep) !== 0) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 not found'); return; }
    res.writeHead(200, { 'Content-Type': (CT[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
    res.end(data);
  });
}

var server = http.createServer(serveStatic);
server.on('upgrade', function (req, socket) {
  if (conns >= MAX_CONNS) { socket.destroy(); return; }            // 连接数上限（S5）
  // Origin 同源校验（S4）：浏览器联机必带 Origin，其 host 须与本站 Host 一致，
  // 否则视为跨站 WebSocket 劫持予以拒绝；不带 Origin 的非浏览器客户端（如 node 测试）放行。
  var origin = req.headers['origin'];
  if (origin) {
    var oHost; try { oHost = url.parse(origin).host; } catch (e) { oHost = null; }
    if (oHost !== req.headers.host) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  }
  var key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  conns++;
  socket.on('close', function () { conns--; });
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + WS.acceptKey(key) + '\r\n\r\n');
  handleConn(new WS.WsConnection(socket));
});

server.listen(PORT, function () {
  console.log('掼蛋联机服务器已启动：http://127.0.0.1:' + PORT + '  （WebSocket 同端口）');
});

module.exports = { server: server, rooms: rooms, Room: Room };
