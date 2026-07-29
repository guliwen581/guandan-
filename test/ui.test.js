'use strict';
// 最小 DOM 桩，真实执行 ui.js 渲染路径，捕获运行时错误并校验标记
var fails = 0, passes = 0;
function check(n, c) { if (c) passes++; else { fails++; console.log('  ✗ FAIL: ' + n); } }

var appObj = { _h: '', addEventListener: function () {}, querySelector: function () { return null; } };
Object.defineProperty(appObj, 'innerHTML', { get: function () { return this._h; }, set: function (v) { this._h = v; } });
global.document = { getElementById: function () { return appObj; } };
global.location = { search: '' };

global.Cards = require('../js/cards.js');
global.Rules = require('../js/rules.js');
global.AI = require('../js/ai.js');
global.Game = require('../js/game.js');
require('../js/ui.js'); // IIFE：自动 Game.init 并渲染大厅

function html() { return appObj._h; }
function count(sub) { return html().split(sub).length - 1; }

// ---- 大厅 ----
check('大厅渲染', /class="lobby"/.test(html()) && html().indexOf('快速开始') >= 0 && html().indexOf('初级场') >= 0);
check('大厅含4张场子', count('data-act="room"') === 4);

// ---- 全自动整局：渲染 double/play/settle 不抛错，结算浮层出现 ----
Game.AUTO_ALL = true; Game.sync = true;
Game.quickStart(800);
check('整局后为牌桌', /class="table"/.test(html()));
check('结算浮层出现', html().indexOf('本局结算') >= 0 && html().indexOf('再来一局') >= 0);
check('结算4行', count('class="row') === 4);
check('渲染含手牌容器', html().indexOf('class="hand') >= 0);

// ---- 人类路径：加倍栏 -> 手牌27张 -> 出牌 -> 结算 ----
Game.AUTO_ALL = false; Game.sync = true;
Game.quickStart(800);
check('加倍栏显示', html().indexOf('data-act="dbl-yes"') >= 0);
Game.humanDouble(false);
check('轮到人类可出牌', html().indexOf('出牌') >= 0);
check('手牌27张', count('data-card-id="') === 27);
check('红牌标记存在', html().indexOf(' red') >= 0); // 手里几乎必有红桃/方块
check('默认分栏理牌', html().indexOf('class="rail') >= 0);
check('一键理/锁牌/静音/记牌器按钮', html().indexOf('data-act="rails"') >= 0 && html().indexOf('data-act="lock"') >= 0 && html().indexOf('data-act="mute"') >= 0 && html().indexOf('data-act="counter"') >= 0);
check('四方均显示名字(三方+自己=4)', count('class="nm"') >= 4);

// 人类机器人打到结算
function move(sn) {
  var cards = sn.seats[0].cards, level = sn.level;
  var all = Rules.generateAllPlays(cards, level);
  if (!sn.top) { var nb = all.filter(function (p) { return !Rules.isBomb(p); }).sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); }); return { play: (nb[0] || all[0]).cards.map(function (c) { return c.id; }) }; }
  var beats = all.filter(function (p) { return Rules.canBeat(p, sn.top.play); });
  var nb2 = beats.filter(function (p) { return !Rules.isBomb(p); }).sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); });
  return nb2.length ? { play: nb2[0].cards.map(function (c) { return c.id; }) } : { pass: true };
}
var guard = 0, threw = false;
try {
  while (Game.snapshot().phase !== 'settle' && guard++ < 5000) {
    var sn = Game.snapshot();
    if (!sn.canPlay) break;
    var mv = move(sn);
    if (mv.pass) Game.humanPass(); else Game.humanPlay(mv.play);
  }
} catch (e) { threw = true; console.log('  人类路径抛错:', e.message); }
check('人类路径无运行时错误', !threw);
check('人类路径打到结算', Game.snapshot().phase === 'settle' && html().indexOf('本局结算') >= 0);

// ---- C: 进贡/还贡 UI 分支 + 队伍等级 HUD（弱化对手，确保人类收贡）----
var AI = global.AI, _oc = AI.choose;
AI.choose = function (ctx) {
  if (ctx.self === 1 || ctx.self === 3) {
    if (ctx.top) return null;
    var s = Rules.generateAllPlays(ctx.hand, ctx.level).filter(function (p) { return p.type === 'single'; });
    s.sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); }); return s[0] || _oc(ctx);
  }
  return _oc(ctx);
};
var sawTributeUI = false, sawHUD = false, mC = 0;
while (!sawTributeUI && mC++ < 8) {
  Game.quickStart(800); var g = 0;
  while (g++ < 1200) {
    var sn2 = Game.snapshot();
    if (sn2.phase !== 'lobby' && sn2.phase !== 'settle' && html().indexOf('级') >= 0) sawHUD = true;
    if (sn2.matchOver) break;
    if (sn2.canTribute) {
      if (html().indexOf('data-act="tribute"') >= 0) sawTributeUI = true;
      var hh = sn2.seats[0].cards, lv = sn2.level, lo = hh[0];
      for (var j = 1; j < hh.length; j++) if (Cards.cmpValue(hh[j].r, lv) < Cards.cmpValue(lo.r, lv)) lo = hh[j];
      Game.humanTribute(lo.id); break;
    }
    if (sn2.canDouble) { Game.humanDouble(false); continue; }
    if (sn2.canPlay) { var mv2 = move(sn2); if (mv2.pass) Game.humanPass(); else Game.humanPlay(mv2.play); continue; }
    if (sn2.phase === 'settle') { Game.nextRound(); continue; }
    break;
  }
}
AI.choose = _oc;
check('队伍等级HUD渲染', sawHUD);
check('还贡交互UI渲染', sawTributeUI);

// ---- D: 联机入口/房间 屏幕渲染（假 Net 走 DOM 桩，校验结构与标记）----
global.Net = { active: true, started: false, seat: 0, roomInfo: null, name: '测试', lastError: null };
global.GDRender(null);
check('联机入口屏渲染', html().indexOf('联机对战') >= 0 && html().indexOf('data-act="o-create"') >= 0 && html().indexOf('data-act="o-join"') >= 0);
global.Net.roomInfo = { code: '1234', started: false, seats: [{ seat: 0, name: '测试', connected: true }, { seat: 1, name: null, connected: false }, { seat: 2, name: null, connected: false }, { seat: 3, name: null, connected: false }] };
global.GDRender(null);
check('联机房间屏渲染', html().indexOf('房间号 1234') >= 0 && count('class="oteam"') === 4 && html().indexOf('data-act="o-start"') >= 0);
check('自己的座位高亮', html().indexOf('oseat full me') >= 0);
delete global.Net;

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
