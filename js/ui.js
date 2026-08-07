/*
 * ui.js —— 掼蛋界面与交互（事件委托，读 Game.snapshot 渲染）
 *  理牌对齐原版：Rules.organize 给出"锁定栏 + 余牌按点数竖叠(仅炸弹挂牌)"；
 *  锁牌/恢复 切换；出牌·不出·提示 为桌中大按钮，底栏=牌型名+花色筛选，右下=锁牌/一键理/聊天。
 *  音效+音量 / 记牌器 / 不洗牌菜单 / 队伍等级+局数 / 进贡·还贡·抗贡 / 比赛胜负+彩带 / SVG 头像。
 *  ?demo 自动开打。
 */
(function () {
  'use strict';
  var app = document.getElementById('app');
  function sfx(n) { if (typeof Sfx !== 'undefined' && Sfx && Sfx[n]) Sfx[n](); }
  function muted() { return !(typeof Sfx !== 'undefined' && Sfx && Sfx.enabled); }
  function voiceOn() { return typeof Voice !== 'undefined' && Voice && Voice.enabled; }
  var _toastEl = null;
  function toast(msg) {   // 全局状态提示（挂在 body，不被 render 重写 #app 冲掉）
    if (typeof document === 'undefined') return;
    if (!_toastEl) { _toastEl = document.createElement('div'); _toastEl.className = 'gd-toast'; document.body.appendChild(_toastEl); }
    _toastEl.textContent = msg; _toastEl.classList.add('show');
    clearTimeout(_toastEl._t); _toastEl._t = setTimeout(function () { _toastEl.classList.remove('show'); }, 1600);
  }
  function vol() { try { return +(localStorage.getItem('guandan_vol') || 100); } catch (e) { return 100; } }

  var selected = new Set(), locks = [];
  var lastSnap = null, selectedBase = 800, hintIdx = -1, lastRoundNo = null;
  var SORTS = ['size', 'count', 'suit'], SORT_NAME = { size: '按大小', count: '按张数', suit: '按花色' };
  function sortMode() { try { var m = localStorage.getItem('gd_sort'); return SORTS.indexOf(m) >= 0 ? m : 'size'; } catch (e) { return 'size'; } }
  function cycleSort() {
    var m = SORTS[(SORTS.indexOf(sortMode()) + 1) % SORTS.length];
    try { localStorage.setItem('gd_sort', m); } catch (e) {}
    toast('手牌排序：' + SORT_NAME[m]); render(lastSnap);
  }
  var showCounter = false, dealShown = false;
  var timerKey = null, timeLeft = 0, timerInt = null;
  var demo = /demo/.test(location.search);
  var G = Game; // 后端：默认本机 Game（人机）；联机时由 net.js 切成 Net.backend
  var GLOBAL = (typeof window !== 'undefined') ? window : globalThis;
  function hasNet() { return typeof Net !== 'undefined' && Net; }

  var ROOMS = [
    { n: '初级场', b: 800, p: '19196', r: '1000~10万', c: 'g', f: '' },
    { n: '中级场', b: 2500, p: '2253', r: '2万~40万', c: 'b', f: '' },
    { n: '高级场', b: 10000, p: '324', r: '10万~200万', c: 'p', f: '🤴' },
    { n: '土豪场', b: 20000, p: '107', r: '100万+', c: 'o', f: '🐉' }
  ];
  var MODES = [
    { n: '翻倍玩法', m: null }, { n: '经典玩法', m: 'classic' }, { n: '经典过A', m: null },
    { n: '不洗牌', m: 'noshuffle' }, { n: '团团转', m: null }, { n: '二人掼蛋', m: null }
  ];
  var BODY = ['#ffd24a', '#ff9a4a', '#9ad0ff', '#c0a0ff'];

  // ---- 商城 / 会员（商业化外壳；演示=本地记账，真实环境在 shopBuy 调起支付）----
  var shop = null;
  function gem() { try { return +(localStorage.getItem('gd_gem') || 0); } catch (e) { return 0; } }
  function vip() { try { return localStorage.getItem('gd_vip') === '1'; } catch (e) { return false; } }
  function addGem(n) { try { localStorage.setItem('gd_gem', gem() + n); } catch (e) {} }
  function setVip(v) { try { localStorage.setItem('gd_vip', v ? '1' : '0'); } catch (e) {} }
  function shopBuy(plan) {   // 演示购买：记录订单 + 模拟到账（接入支付后在此替换为真实下单）
    if (plan === 'vip') { setVip(true); addGem(300); toast('演示：月卡已开通 · 💎+300（接入支付后生效）'); }
    else if (plan === 'first') { addGem(600); toast('演示：首充礼包已发放 · 💎+600'); }
    else { addGem(120); toast('演示：钻石包已到账 · 💎+120'); }
    shop = null;
  }
  function shopClaim(kind) {
    if (kind === 'ad') { addGem(30); toast('演示：看完广告 · 💎+30'); shop = null; return; }
    var k = 'gd_free_' + new Date().toDateString();
    try { if (localStorage.getItem(k)) { toast('今日已领取，明天再来～'); return; } localStorage.setItem(k, '1'); } catch (e) {}
    addGem(88); toast('演示：每日免费钻石 +88 已领取'); shop = null;
  }
  GLOBAL.GDShopClose = function () { shop = null; render(lastSnap); };   // 供弹窗遮罩内联点击关闭
  // ---- P2 桌布主题 / 设置面板 / 战绩 / 签到 ----
  var THEMES = [{ k: 'classic', n: '经典' }, { k: 'modern', n: '现代' }, { k: 'gufeng', n: '古风' }, { k: 'xiaguang', n: '霞光' }];
  var panel = null;   // 'settings' | 'hist'
  function themeCur() { try { var t = localStorage.getItem('gd_theme'); return THEMES.some(function (x) { return x.k === t; }) ? t : 'classic'; } catch (e) { return 'classic'; } }
  function applyTheme() { try { document.body.dataset.theme = themeCur(); } catch (e) {} }
  GLOBAL.GDPanelClose = function () { panel = null; render(lastSnap); };
  // ---- P2 赛季（经验→等级→解锁桌布）+ 每日任务 ----
  var SEASON_LV = [30, 80, 150];                       // Lv1/2/3 经验门槛
  var THEME_LV = { classic: 0, modern: 1, gufeng: 2, xiaguang: 3 };
  function seasonInfo() {
    var xp = 0; try { xp = +(localStorage.getItem('gd_xp') || 0); } catch (e) {}
    var lv = 0; for (var i = 0; i < SEASON_LV.length; i++) if (xp >= SEASON_LV[i]) lv = i + 1;
    return { xp: xp, lv: lv, next: lv < SEASON_LV.length ? SEASON_LV[lv] : null };
  }
  function seasonAdd(win) {
    try { var xp = (+(localStorage.getItem('gd_xp') || 0)) + 10 + (win ? 5 : 0); localStorage.setItem('gd_xp', String(xp)); } catch (e) {}
  }
  function todayStr() { return new Date().toDateString(); }
  function taskState() {
    var hist = histList(), today = todayStr();
    var played = hist.filter(function (e) { return new Date(e.t).toDateString() === today; }).length;
    var wins = hist.filter(function (e) { return new Date(e.t).toDateString() === today && e.w; }).length;
    var signed = false; try { signed = localStorage.getItem('gd_sign_date') === today; } catch (e) {}
    var claimed = {}; try { claimed = JSON.parse(localStorage.getItem('gd_taskclaim_' + today) || '{}'); } catch (e) {}
    return [
      { id: 't1', n: '完成 1 局对局', p: Math.min(played, 1), goal: 1, done: played >= 1 },
      { id: 't2', n: '赢得 1 局胜利', p: Math.min(wins, 1), goal: 1, done: wins >= 1 },
      { id: 't3', n: '完成每日签到', p: signed ? 1 : 0, goal: 1, done: signed }
    ].map(function (t) { t.claimed = !!claimed[t.id]; return t; });
  }
  function taskClaim(id) {
    var st = taskState().filter(function (t) { return t.id === id; })[0];
    if (!st || !st.done || st.claimed) { toast('该任务不可领取'); return; }
    try {
      var k = 'gd_taskclaim_' + todayStr();
      var claimed = JSON.parse(localStorage.getItem(k) || '{}'); claimed[id] = 1;
      localStorage.setItem(k, JSON.stringify(claimed));
    } catch (e) {}
    addGem(30); toast('任务完成 · 💎+30'); render(lastSnap);
  }
  // ---- P2 邮件（本地模板邮件 + 一次性附件领取）----
  function mailList() {
    var si = seasonInfo();
    return [
      { id: 'welcome', icon: '📮', t: '欢迎来到掼蛋经典', body: '免费无内购网页版：完整规则引擎、联机好友房、回放与记牌器。祝把把头游！', gem: 66 },
      { id: 'season', icon: '🏆', t: '赛季奖励', body: '当前赛季等级 Lv.' + si.lv + '（经验 ' + si.xp + '）。继续对局提升等级，解锁更多桌布主题。', gem: si.lv * 20 }
    ];
  }
  function mailClaimed() { try { return JSON.parse(localStorage.getItem('gd_mail_claim') || '{}'); } catch (e) { return {}; } }
  function mailClaim(id) {
    var m = mailList().filter(function (x) { return x.id === id; })[0];
    var cl = mailClaimed();
    if (!m || cl[id]) { toast('该邮件已领取'); return; }
    cl[id] = 1; try { localStorage.setItem('gd_mail_claim', JSON.stringify(cl)); } catch (e) {}
    addGem(m.gem); toast('附件已领取 · 💎+' + m.gem); render(lastSnap);
  }
  function histList() { try { return JSON.parse(localStorage.getItem('gd_hist') || '[]'); } catch (e) { return []; } }
  function histSave(snap) {
    if (!snap.lastResult) return;
    var r = snap.lastResult, mode = snap.mode && snap.mode.match ? '积分赛' : snap.mode && snap.mode.gold ? '金币场' : '晋级场';
    var e = { t: new Date().toLocaleString('zh-CN', { hour12: false }), m: mode, w: r.winTeam === 0, c: r.comboName, mu: snap.mult, d: r.delta };
    try { var h = histList(); h.unshift(e); localStorage.setItem('gd_hist', JSON.stringify(h.slice(0, 20))); } catch (er) {}
    seasonAdd(r.winTeam === 0);   // 赛季经验：完局+10，胜利+5
  }
  function doSign() {
    var today = new Date().toDateString(), k = 'gd_sign_date';
    try {
      if (localStorage.getItem(k) === today) { toast('今日已签到，明天再来～'); return; }
      var yest = new Date(Date.now() - 86400000).toDateString();
      var streak = (localStorage.getItem(k) === yest) ? (+(localStorage.getItem('gd_sign_streak') || 0) + 1) : 1;
      localStorage.setItem(k, today); localStorage.setItem('gd_sign_streak', String(streak));
      addGem(20 + Math.min(streak, 7) * 5);
      toast('签到成功 · 连续' + streak + '天 · 💎+' + (20 + Math.min(streak, 7) * 5));
    } catch (e) { toast('签到失败'); }
    panel = null; render(lastSnap);
  }
  function panelHtml() {
    if (panel === 'privacy') {
      return '<div class="modal" onclick="if(event.target===this&&window.GDPanelClose)window.GDPanelClose()"><div class="mbox"><h3>隐私政策与用户协议</h3><div class="msub">免费无内购网页版 · 请仔细阅读</div>' +
        '<div class="pptext">1. 本游戏为免费在线网页游戏，不设账号体系，不提供任何付费、虚拟货币兑换或抽奖服务。<br><br>' +
        '2. 我们仅在您的浏览器本地存储游戏进度、设置与战绩（localStorage），不收集、不上传任何个人信息。联机对战仅传输昵称、出牌动作等对局必需数据。<br><br>' +
        '3. 请勿沉迷。建议未成年人合理安排游戏时间，在监护人指导下使用。<br><br>' +
        '4. 禁止利用本游戏进行任何形式的赌博或变相赌博活动。<br><br>' +
        '5. 本游戏玩法基于掼蛋通用规则独立实现，界面与素材均为原创，与其他掼蛋产品无关。</div>' +
        '<div class="mbtns"><button class="mclose" data-act="panel-close">我知道了</button></div></div></div>';
    }
    if (panel === 'mail') {
      var cl = mailClaimed();
      var rows = mailList().map(function (m) {
        var btn = cl[m.id] ? '<span class="pp">已领</span>' : '<span class="pp claim" data-mail-claim="' + m.id + '">领💎' + m.gem + '</span>';
        return '<div class="plan"><div class="pi">' + m.icon + '</div><div class="pt"><b>' + m.t + '</b><span>' + m.body + '</span></div>' + btn + '</div>';
      }).join('');
      return '<div class="modal" onclick="if(event.target===this&&window.GDPanelClose)window.GDPanelClose()"><div class="mbox"><h3>📮 邮件</h3><div class="msub">附件仅可领取一次</div>' + rows + '<div class="mbtns"><button class="mclose" data-act="panel-close">关闭</button></div></div></div>';
    }
    if (panel === 'task') {
      var ts = taskState();
      var rows = ts.map(function (t) {
        var btn = t.claimed ? '<span class="pp">已领</span>' : t.done ? '<span class="pp claim" data-task-claim="' + t.id + '">领取</span>' : '<span class="pp">' + t.p + '/' + t.goal + '</span>';
        return '<div class="plan"><div class="pi">' + (t.claimed ? '✅' : t.done ? '🎁' : '⏳') + '</div><div class="pt"><b>' + t.n + '</b><span>奖励 💎30 · ' + t.p + '/' + t.goal + '</span></div>' + btn + '</div>';
      }).join('');
      return '<div class="modal" onclick="if(event.target===this&&window.GDPanelClose)window.GDPanelClose()"><div class="mbox"><h3>每日任务</h3><div class="msub">每日 0 点刷新</div>' + rows + '<div class="mbtns"><button class="mclose" data-act="panel-close">关闭</button></div></div></div>';
    }
    if (panel === 'season') {
      var si = seasonInfo();
      var bar = si.next ? Math.min(100, Math.round(si.xp / si.next * 100)) : 100;
      var lvtxt = si.next ? 'Lv.' + si.lv + ' · ' + si.xp + '/' + si.next + ' 经验' : 'Lv.' + si.lv + '（满级）';
      var desc = '<div class="plan"><div class="pi">🎨</div><div class="pt"><b>等级奖励：解锁桌布主题</b><span>Lv.1 现代 · Lv.2 古风 · Lv.3 霞光（每局+10经验，胜利+5）</span></div></div>';
      return '<div class="modal" onclick="if(event.target===this&&window.GDPanelClose)window.GDPanelClose()"><div class="mbox"><h3>🏆 赛季等级</h3><div class="msub">' + lvtxt + '</div><div class="xpbar"><i style="width:' + bar + '%"></i></div>' + desc + '<div class="mbtns"><button class="mclose" data-act="panel-close">关闭</button></div></div></div>';
    }
    if (panel === 'settings') {
      var cur = themeCur(), slv = seasonInfo().lv;
      var sw = THEMES.map(function (t) { var locked = THEME_LV[t.k] > slv; return '<span class="thsw' + (t.k === cur ? ' on' : '') + (locked ? ' lock' : '') + '" data-theme-pick="' + t.k + '">' + (locked ? '🔒' : '') + t.n + '</span>'; }).join('');
      return '<div class="modal" onclick="if(event.target===this&&window.GDPanelClose)window.GDPanelClose()"><div class="mbox"><h3>更多设置</h3><div class="msub">桌布主题 · 操作习惯</div>' +
        '<div class="plan"><div class="pi">🎨</div><div class="pt"><b>桌布主题</b><span class="thsws">' + sw + '</span></div></div>' +
        '<div class="plan" data-act="btnpos-reset"><div class="pi">🧭</div><div class="pt"><b>按钮组位置复位</b><span>长按桌中时钟可拖动按钮组</span></div><div class="pp">复位</div></div>' +
        '<div class="plan"><div class="pi">ℹ️</div><div class="pt"><b>关于</b><span>掼蛋经典 · 网页版 · v1.1 · 免费无内购</span></div></div>' +
        '<div class="mbtns"><button class="mclose" data-act="panel-close">关闭</button></div></div></div>';
    }
    if (panel === 'hist') {
      var list = histList();
      var rows = list.length ? list.map(function (e) { return '<div class="plan"><div class="pi">' + (e.w ? '🏆' : '💧') + '</div><div class="pt"><b>' + e.m + ' · ' + e.c + '</b><span>' + esc(e.t) + '</span></div><div class="pp">' + (e.w ? '+' : '') + e.d + '</div></div>'; }).join('') : '<div class="msub">暂无战绩，快去打一局吧</div>';
      return '<div class="modal" onclick="if(event.target===this&&window.GDPanelClose)window.GDPanelClose()"><div class="mbox"><h3>我的战绩</h3><div class="msub">最近 20 局</div>' + rows + '<div class="mbtns"><button class="mclose" data-act="panel-close">关闭</button></div></div></div>';
    }
    return '';
  }
  function shopHtml() {
    var title = shop === 'vip' ? '月卡会员' : shop === 'first' ? '首充礼包' : '免费福利';
    var plans = '';
    if (shop === 'free') {
      plans = '<div class="plan" data-act="shop-claim"><div class="pi">🎁</div><div class="pt"><b>每日免费钻石</b><span>签到即领，培养每日回流</span></div><div class="pp">领</div></div>' +
              '<div class="plan" data-act="shop-ad"><div class="pi">📺</div><div class="pt"><b>看广告得钻石</b><span>激励视频，零氪友好</span></div><div class="pp">+30</div></div>';
    } else if (shop === 'first') {
      plans = '<div class="plan" data-act="shop-buy" data-plan="first"><div class="pi">💰</div><div class="pt"><b>首充任意金额</b><span>双倍返还 + 限定头像框</span></div><div class="pp">¥6</div></div>';
    } else {
      plans = '<div class="plan" data-act="shop-buy" data-plan="vip"><div class="pi">👑</div><div class="pt"><b>月卡 · 30 天</b><span>每日领钻 + 专属 VIP 标识</span></div><div class="pp">¥30</div></div>' +
              '<div class="plan" data-act="shop-buy" data-plan="coin"><div class="pi">💎</div><div class="pt"><b>钻石包 600</b><span>即时到账</span></div><div class="pp">¥68</div></div>';
    }
    return '<div class="modal" onclick="if(event.target===this&&window.GDShopClose)window.GDShopClose()"><div class="mbox">' +
      '<h3>' + title + '</h3><div class="msub">余额 💎 ' + gem() + (vip() ? '　<i class="vip">VIP</i>' : '') + '　·　演示环境</div>' +
      plans + '<div class="mbtns"><button class="mclose" data-act="shop-close">关闭</button></div></div></div>';
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function rankIdx(label) { var i = Game.RANK_LABEL.indexOf(label); return i < 0 ? 3 : i; }
  function famOf(t) { return t === 'sf' ? 'sf' : (t.indexOf('bomb') === 0 || t === 'rocket') ? 'bomb' : t === 'straight' ? 'straight' : t === 'pairs' ? 'pairs' : t === 'plate' ? 'plate' : t === 'triple2' ? 'triple2' : 'bomb'; }
  function chipClass(col) { return col.locked ? famOf(col.type || '') : 'bomb'; }

  function faceSVG(id) {
    var b = BODY[id % 4];
    return '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">' +
      '<ellipse cx="20" cy="31" rx="15" ry="9" fill="#fff7e6" stroke="#e6c98a" stroke-width="1.2"/>' +
      '<circle cx="20" cy="17" r="12" fill="' + b + '"/>' +
      '<circle cx="15" cy="15" r="2.3" fill="#2a2a2a"/><circle cx="25" cy="15" r="2.3" fill="#2a2a2a"/>' +
      '<circle cx="15.7" cy="14.2" r=".8" fill="#fff"/><circle cx="25.7" cy="14.2" r=".8" fill="#fff"/>' +
      '<path d="M17 19 L23 19 L20 23 Z" fill="#f0832a"/>' +
      '<circle cx="11.5" cy="19" r="2" fill="#ff9a9a" opacity=".55"/><circle cx="28.5" cy="19" r="2" fill="#ff9a9a" opacity=".55"/></svg>';
  }
  function cardHtml(c, extra, withData, level, badge) {
    var cls = 'card ' + (extra || ''), data = withData ? ' data-card-id="' + c.id + '"' : '', lk = badge ? '<i class="lk">🔒</i>' : '';
    if (c.s === 'W') {
      var big = c.r === 'BJ';
      return '<div class="' + cls + ' joker ' + (big ? 'jbig' : 'jsmall') + '"' + data + '><div class="jk">' + (big ? '大王' : '小王') + '</div><div class="jksmall">JOKER</div>' + lk + '</div>';
    }
    var es = c.asSuit || c.s; // 万能牌在同花顺里按其充当的花色显示
    var red = Cards.SUIT_RED[es] ? ' red' : '', wild = Cards.isWild(c, level) ? '<i class="wildmark">★</i>' : '';
    return '<div class="' + cls + red + '"' + data + '><div class="corner"><span class="rk">' + esc(c.asRank || c.r) + '</span><span class="st">' + Cards.SUIT_SYM[es] + '</span></div>' +
      '<div class="center">' + Cards.SUIT_SYM[es] + '</div>' + wild + lk + '</div>';
  }
  function cardsRow(cards, level, type) {
    var show = cards;
    if ((type === 'sf' || type === 'straight') && cards && cards.length === 5 && Rules.runEffective) { var eff = Rules.runEffective(cards, level); if (eff) show = eff; }
    return show.map(function (c) { return cardHtml(c, '', false, level); }).join('');
  }
  function confettiHtml() {
    var cols = ['#ffd24a', '#ff6b6b', '#5ad17a', '#5aa8ff', '#c08bff', '#ff9a4a'], s = '<div class="confetti">';
    for (var i = 0; i < 28; i++) s += '<span style="left:' + (Math.random() * 100) + '%;background:' + cols[i % 6] + ';animation-delay:' + (Math.random() * 0.8).toFixed(2) + 's;animation-duration:' + (1.4 + Math.random()).toFixed(2) + 's"></span>';
    return s + '</div>';
  }

  function lobbyHtml(snap) {
    var coins = snap ? snap.seats[0].coins : 10000, ns = snap && snap.mode && snap.mode.noShuffle;
    var rooms = ROOMS.map(function (rm) {
      return '<div class="room ' + rm.c + (rm.b === selectedBase ? ' sel' : '') + '" data-act="room" data-base="' + rm.b + '"><div class="rn">' + rm.n + '</div><div class="base">底分 <b>' + rm.b + '</b></div><div class="face">' + rm.f + '</div><div class="info"><span>👤 ' + rm.p + '</span><span>🪙 ' + rm.r + '</span></div></div>';
    }).join('');
    var modes = MODES.map(function (md) { var on = md.m === 'classic' ? !ns : md.m === 'noshuffle' ? ns : false; return '<li class="' + (on ? 'on' : '') + '" data-mode="' + (md.m || '') + '">' + md.n + '</li>'; }).join('');
    var selRoom = ROOMS.filter(function (r) { return r.b === selectedBase; })[0] || ROOMS[0];
    var goldOn = snap && snap.mode && snap.mode.gold, matchOn = snap && snap.mode && snap.mode.match;
    var noneOn = !goldOn && !matchOn;
    var goldtoggle = '<div class="goldtoggle"><span data-gold=""' + (noneOn ? ' class="on"' : '') + '>🏆 晋级场<div class="gt-sub">打2→A 升级赛制</div></span><span data-gold="1"' + (goldOn ? ' class="on"' : '') + '>🪙 金币场<div class="gt-sub">无限局·底分×倍数结算</div></span><span data-gold="match"' + (matchOn ? ' class="on"' : '') + '>🏟️ 积分赛<div class="gt-sub">4局·积分排名决胜</div></span></div>';
    return '<div class="lobby"><div class="clouds"></div><div class="deco"></div><div class="topbar"><div class="back">‹ 掼蛋经典' + (vip() ? '<i class="vip">VIP</i>' : '') + ' <i class="vip" data-act="season">⭐Lv.' + seasonInfo().lv + '</i></div><div class="currency"><span>🪙 <b>' + coins + '</b></span><span>💎 <b>' + gem() + '</b></span></div><div class="shop"><span data-act="signin">每日签到</span><span data-act="task">每日任务</span><span data-act="mail">邮件</span><span data-act="hist">战绩</span><span data-act="shop-free">免费福利</span></div></div><div class="lobby-body">' + goldtoggle + '<ul class="modes">' + modes + '</ul><div class="rooms">' + rooms + '</div></div><button class="quickstart" data-act="quick">快速开始<div class="sub">' + (matchOn ? '积分赛' : goldOn ? '金币场' : '经典玩法') + '·' + selRoom.n + (ns ? '·不洗牌' : '') + '</div></button><button class="quickstart onlinebtn" data-act="online">🌐 联机对战<div class="sub">创建/加入房间·和朋友同屏</div></button><div class="footlinks"><span data-act="privacy">隐私政策与用户协议</span> · <span data-act="privacy">健康游戏，禁止赌博</span></div></div>' + (shop ? shopHtml() : '') + panelHtml();
  }

  function onlineEntryHtml() {
    var name = (hasNet() && Net.name) || '玩家';
    var err = (hasNet() && Net.lastError) ? '<div class="oerr">' + esc(Net.lastError) + '</div>' : '';
    var rounds = hasNet() ? (Net.roundsChoice || 0) : 0;
    var roundsel = '<div class="orow roundsel"><label>局数</label>' + [0, 4, 8, 16].map(function (n) {
      return '<span data-rounds="' + n + '"' + (rounds === n ? ' class="on"' : '') + '>' + (n === 0 ? '不限' : n + '局') + '</span>';
    }).join('') + '</div>';
    return '<div class="online"><div class="clouds"></div><div class="obox"><h2>🌐 联机对战</h2>' +
      '<div class="orow"><label>昵称</label><input id="o-name" maxlength="8" value="' + esc(name) + '"/></div>' + roundsel +
      '<button class="obtn primary" data-act="o-create">创建房间</button>' +
      '<div class="orow join"><input id="o-code" maxlength="6" placeholder="输入房间号"/><button class="obtn" data-act="o-join">加入</button><button class="obtn" data-act="o-watch">👁观战</button></div>' +
      '<p class="otip">把房间号发给朋友，4 人入座即可开打，空位由电脑补；输入他人房间号可观战。</p>' + err +
      '<button class="obtn ghost" data-act="o-leave">返回大厅</button>' +
      '</div></div>';
  }
  function onlineRoomHtml() {
    var info = (hasNet() && Net.roomInfo) || { code: '', seats: [] };
    var err = (hasNet() && Net.lastError) ? '<div class="oerr">' + esc(Net.lastError) + '</div>' : '';
    var seats = [0, 1, 2, 3].map(function (i) {
      var s = (info.seats || [])[i] || {};
      var me = hasNet() && Net.seat === i;
      return '<div class="oseat' + (s.connected ? ' full' : '') + (me ? ' me' : '') + '"><div class="oface">' + faceSVG(i) + '</div><div class="onm">' + (s.name ? esc(s.name) + (me ? '（你）' : '') : '空位') + '</div><div class="oteam">' + (i % 2 === 0 ? 'A 队' : 'B 队') + '</div></div>';
    }).join('');
    var isHost = hasNet() && Net.seat === 0;
    var meta = (info.gold ? ' <span class="vip">🪙金币场</span>' : '') + (info.rounds ? ' <span class="vip">' + info.rounds + '局制</span>' : '');
    return '<div class="online"><div class="clouds"></div><div class="obox wide"><h2>房间号 ' + esc(info.code) + meta + '</h2>' +
      '<div class="oseats">' + seats + '</div>' +
      '<p class="otip">朋友打开同样网址，点"联机对战 → 加入"，输入 <b>' + esc(info.code) + '</b> 入座。</p>' + err +
      '<div class="obtns"><button class="obtn primary" data-act="o-start">开始游戏</button>' + (isHost ? '<button class="obtn danger" data-act="o-dissolve">解散房间</button>' : '') + '<button class="obtn ghost" data-act="o-leave">离开房间</button></div>' +
      '</div></div>';
  }

  function clockHtml(seatId, snap) {
    if (seatId === 0) return ''; // 自己的钟放在桌中
    if (snap.turn !== seatId || (snap.phase !== 'play' && snap.phase !== 'double')) return '';
    return '<div class="clock"><div class="face"></div></div>';
  }
  function seatHtml(seat, snap) {
    var rk = seat.rank ? '<span class="rank r' + rankIdx(seat.rank) + '">' + seat.rank + '</span>' : '';
    var dbl = seat.doubled ? '<span class="dbl">加倍</span>' : '';
    dbl += seat.alarm ? '<span class="alarm">🔔' + seat.alarm + '</span>' : '';
    return '<div class="seat ' + seat.pos + (snap.turn === seat.id ? ' active' : '') + '"><div class="avatar">' + faceSVG(seat.id) + '<span class="badge">' + seat.handCount + '</span>' + dbl + rk + '</div><div class="plate"><span class="nm"><i class="gem"></i>' + esc(seat.name) + '</span><span class="cn">🪙 ' + seat.coins + '</span></div>' + clockHtml(seat.id, snap) + '</div>';
  }
  function pzHtml(seat, snap) {
    var inner = '';
    if (snap.top && snap.top.owner === seat.id) inner = cardsRow(snap.top.play.cards, snap.level, snap.top.play.type);
    else if (seat.passed) inner = '<div class="buhchu">不出</div>';
    return '<div class="playzone pz-' + seat.pos + '">' + inner + '</div>';
  }

  function handHtml(snap) {
    var self = snap.seats[0], level = snap.level, hand = self.cards || [];
    var interactive = snap.canPlay || snap.canTribute, dis = interactive ? '' : 'disabled';
    var tbc = {};   // 进贡候选牌高亮（P0-1：只能从并列最大的牌里选）
    if (snap.tribute && snap.tribute.giveCandidates) snap.tribute.giveCandidates.forEach(function (id) { tbc[id] = 1; });
    var org = Rules.organize(hand, level, locks);
    var sm = sortMode();
    if (sm !== 'size') {   // P1-4 排序模式：锁定栏保持前置，余栏重排
      var lockedCols = org.columns.filter(function (c) { return c.locked; });
      var free = org.columns.filter(function (c) { return !c.locked; });
      var suitOrd = { S: 0, H: 1, C: 2, D: 3 };
      if (sm === 'count') free.sort(function (a, b) { return b.cards.length - a.cards.length; });
      else free.sort(function (a, b) { var sa = a.cards[0] ? (a.cards[0].s === 'W' ? 9 : suitOrd[a.cards[0].s]) : 9, sb = b.cards[0] ? (b.cards[0].s === 'W' ? 9 : suitOrd[b.cards[0].s]) : 9; return sa - sb; });  // 稳定排序=同花色内保持点数序
      org.columns = lockedCols.concat(free);
    }
    var li = -1;
    var cols = org.columns.map(function (col) {
      if (col.locked) li++;
      var ga = col.locked ? ' data-grp="' + li + '"' : '';
      var cards = col.cards.map(function (c) { return cardHtml(c, (selected.has(c.id) ? 'sel ' : '') + (tbc[c.id] ? 'tbcand ' : '') + dis, interactive, level, col.locked); }).join('');
      var chip = col.chip ? '<span class="chip ' + chipClass(col) + '"' + ga + '>' + col.chip + '</span>' : '';
      return '<div class="rail' + (col.locked ? ' locked' : '') + '">' + cards + chip + '</div>';
    }).join('');
    return '<div class="hand rails' + (dealShown ? '' : ' dealin') + '">' + cols + '</div>';
  }

  function stripHtml(snap) {
    if (!snap.canPlay) return '';
    var self = snap.seats[0], level = snap.level, hand = self.cards || [], selType = '';
    if (selected.size) { var sc = Rules.sortHand(hand, level).filter(function (c) { return selected.has(c.id); }); var cl = Rules.classify(sc, level); selType = cl ? Rules.TYPE_NAME[cl.type] : '无效牌型'; }
    var lockedIds = {}; locks.forEach(function (l) { l.ids.forEach(function (i) { lockedIds[i] = 1; }); });
    var pool = hand.filter(function (c) { return !lockedIds[c.id]; });
    function pip(s) {
      var locked = locks.filter(function (l) { return l.suit === s; })[0];
      var enabled = !locked && !!Rules.findSF(pool, level, s);
      var cls = (locked ? 'on' : enabled ? 'avail' : 'off') + (Cards.SUIT_RED[s] ? ' red' : '');
      var data = (locked || enabled) ? ' data-suit="' + s + '"' : '';
      return '<button class="' + cls + '"' + data + '>' + Cards.SUIT_SYM[s] + '</button>';
    }
    return '<div class="strip"><span class="seltype">' + (selType || '同花顺') + '</span><div class="pips">' + pip('S') + pip('H') + pip('C') + pip('D') + '</div></div>';
  }
  var btnPos = null;   // P2 按钮组拖拽位置（长按桌中时钟拖动）
  function loadBtnPos() { try { var p = JSON.parse(localStorage.getItem('gd_btnpos') || 'null'); if (p && typeof p.x === 'number' && typeof p.y === 'number') btnPos = p; } catch (e) {} }
  function caStyle() { return btnPos ? ' style="transform:translate(' + btnPos.x + 'px,' + btnPos.y + 'px)"' : ''; }
  function centerHtml(snap) {
    if (snap.canTribute && snap.tribute && snap.tribute.tributeKind === 'give') {
      var multi = (snap.tribute.giveCandidates || []).length > 1;
      return '<div class="center-actions"><div class="tbtxt">' + (multi ? '请从最大的牌中选 1 张进贡' : '请确认进贡这张最大的牌') + '</div><button class="ca-play go" data-act="tribute-give"' + (selected.size === 1 ? '' : ' disabled') + '>进贡</button></div>';
    }
    if (snap.canTribute) { var p = snap.tribute.pairs.filter(function (x) { return x.receiver === 0; })[0]; return '<div class="center-actions"><div class="tbtxt">你收到 ' + cardHtml(p.held, '', false, snap.level) + ' ，请选 1 张还贡</div><button class="ca-play go" data-act="tribute"' + (selected.size === 1 ? '' : ' disabled') + '>还贡</button></div>'; }
    if (snap.phase === 'tribute') {   // 进贡阶段但无需本家操作：给等待态文案，避免看起来"卡住/不能操作"
      var wn = snap.tribute && snap.tribute.givenByHuman ? '已自动进贡，等待对方还贡…' : '进贡 / 还贡进行中…';
      return '<div class="center-actions"><div class="tbtxt">' + wn + '</div></div>';
    }
    if (!snap.canPlay) return '';
    var clk = '<div class="clock' + (timeLeft <= 5 ? ' low' : '') + '" title="长按可拖动按钮组"><div class="face">' + timeLeft + '</div></div>';
    var leg = selIsLegal(snap);
    return '<div class="center-actions"' + caStyle() + '>' + (snap.leading ? '' : '<button class="ca-pass" data-act="pass">不出</button>') + clk + '<button class="ca-hint" data-act="hint">提示</button><button class="ca-play' + (leg ? ' go' : '') + '" data-act="play"' + (selected.size ? '' : ' disabled') + '>出牌</button></div>';
  }
  function cornerHtml(snap) {
    if (!snap.canPlay) return '<div class="corner-actions"><button class="chatbtn" data-act="chat">💬</button></div>';
    return '<div class="corner-actions"><button class="ca-lock" data-act="lock">' + (locks.length ? '恢复' : '锁牌') + '</button><button class="ca-arrange" data-act="rails">⚡一键理</button><button class="ca-sort" data-act="sort">' + SORT_NAME[sortMode()] + '</button><button class="chatbtn" data-act="chat">💬</button></div>';
  }

  function tableHtml(snap) {
    var seats = snap.seats, self = seats[0], level = snap.level;
    var order = { top: 2, left: 3, right: 1 };
    var others = ['top', 'left', 'right'].map(function (pos) { var s = seats[order[pos]]; return seatHtml(s, snap) + pzHtml(s, snap); }).join('');
    var selfPz = '';
    if (snap.top && snap.top.owner === 0) selfPz = cardsRow(snap.top.play.cards, level, snap.top.play.type);
    else if (self.passed) selfPz = '<div class="buhchu">不出</div>';
    var reveal = '';
    if (self.finished && seats[2].cards && seats[2].cards.length) reveal = '<div class="playzone pz-top" style="top:30%"><div class="buhchu" style="font-size:14px">对家手牌</div></div><div class="playzone pz-top" style="top:36%">' + cardsRow(seats[2].cards, level) + '</div>';
    var banner = '';
    var tribShow = snap.phase !== 'play' && snap.phase !== 'settle';   // 进贡横幅仅在进贡/加倍阶段短暂展示，打牌期不挂屏（修"一直显示"）
    if (snap.tribute && tribShow) {
      if (snap.tribute.anti) banner = '<div class="banner">抗贡！本局无人进贡</div>';
      else if (snap.tribute.givenByHuman && snap.tribute.gotByHuman && !snap.canTribute) banner = '<div class="banner">你进贡 ' + cardHtml(snap.tribute.givenByHuman, '', false, level) + ' 收回 ' + cardHtml(snap.tribute.gotByHuman, '', false, level) + '</div>';  // gotByHuman 空值防护，修渲染崩溃
    }
    var selfMeta = '<div class="selfmeta' + (snap.turn === 0 ? ' active' : '') + '"><div class="avatar">' + faceSVG(0) + (self.doubled ? '<span class="dbl">加倍</span>' : '') + (self.alarm ? '<span class="alarm">🔔' + self.alarm + '</span>' : '') + (self.rank ? '<span class="rank r' + rankIdx(self.rank) + '">' + self.rank + '</span>' : '') + '</div><span class="nm"><i class="gem"></i>' + esc(self.name) + '</span><span class="cn">🪙 ' + self.coins + '</span></div>';
    var doublebar = snap.canDouble ? '<div class="doublebar"><button class="yes" data-act="dbl-yes">加倍</button><button class="no" data-act="dbl-no">不加倍</button></div>' : '';
    var counterPanel = '';
    if (showCounter && snap.counter) { var cells = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', 'SJ', 'BJ'].map(function (r) { var n = snap.counter[r], jk = r === 'SJ' || r === 'BJ'; var lab = jk ? (r === 'BJ' ? '大' : '小') : r; return '<div class="cell' + (n <= 0 ? ' zero' : '') + (jk ? ' jk' : '') + '"><div class="r">' + lab + '</div><div class="n">' + n + '</div></div>'; }).join('');
      var lamps = '';
      if (snap.sfHint) { lamps = '<div class="sflamps">' + ['S', 'H', 'C', 'D'].map(function (s) { return '<span class="' + (snap.sfHint[s] ? 'on' : 'off') + (Cards.SUIT_RED[s] ? ' red' : '') + '">' + Cards.SUIT_SYM[s] + '</span>'; }).join('') + '<i>花色灯=剩余牌仍可能组成该花色同花顺</i></div>'; }
      counterPanel = '<div class="counter"><h4>记牌器<span>剩余张数</span></h4><div class="grid">' + cells + '</div>' + lamps + '</div>'; }

    return '<div class="table"><div class="sky"></div><div class="mtn"></div><div class="pag l">🏯</div><div class="pag r">🏯</div>' +
      '<div class="hud"><span>本局打 <b>' + esc(level) + '</b></span><span>倍数 <b>' + snap.mult + '</b></span><span>第' + snap.roundNo + (snap.mode && snap.mode.rounds ? '/' + snap.mode.rounds : '') + '局</span>' + (hasNet() && Net.active && Net.seat === -1 ? '<span class="watchtag">👁 观战中</span>' : '') + '</div>' +
      (snap.mode && snap.mode.match
        ? '<div class="tlv"><i class="t0">🏟️ 积分赛</i><i class="t1">我方 ' + (snap.seats[0].score + snap.seats[2].score) + ' : ' + (snap.seats[1].score + snap.seats[3].score) + ' 对方</i></div>'
        : snap.mode && snap.mode.gold
        ? '<div class="tlv"><i class="t0">🪙 金币场</i><i class="t1">底分 ' + snap.base + ' · 封顶50000倍</i></div>'
        : '<div class="tlv"><i class="t0">我方 ' + snap.teamLevel[0] + '级</i><i class="t1">对方 ' + snap.teamLevel[1] + '级</i></div>') +
      '<div class="tools"><button data-act="counter" class="' + (showCounter ? 'on' : '') + '">记牌器</button><span class="volwrap">🔊<input type="range" min="0" max="100" value="' + vol() + '" data-vol></span><button data-act="voice" class="voice' + (voiceOn() ? ' on' : '') + '" title="人声解说">' + (voiceOn() ? '🗣️' : '🔈') + '</button><button data-act="mute">' + (muted() ? '🔇' : '') + '</button>' + (hasNet() && Net.active && Net.seat === 0 ? '<button data-act="o-dissolve" class="dangerbtn">解散</button>' : '') + '<button data-act="more">更多</button></div>' +
      banner +
      '<div class="felt"><div class="watermark"><div class="wm-org">绍兴市人工智能协会</div><div class="wm-title">掼蛋比赛</div></div></div>' +
      others + reveal + '<div class="playzone pz-self">' + selfPz + '</div>' + counterPanel +
      centerHtml(snap) +
      '<div class="handbar">' + selfMeta + handHtml(snap) + '</div>' +
      stripHtml(snap) + cornerHtml(snap) + doublebar + '</div>';
  }

  function settleHtml(r) {
    var win = r.winTeam === 0, isMatch = !!(lastSnap.mode && lastSnap.mode.match && r.scores);
    var title = r.matchOver ? (win ? '🏆 比赛胜利！' : '比赛失利') : '本局结算';
    var order = isMatch ? [0, 1, 2, 3].sort(function (a, b) { return r.scores[b] - r.scores[a]; }) : r.finishOrder;
    var rows = order.map(function (sid, i) { var seat = lastSnap.seats[sid], w = seat.team === r.winTeam, d = r.deltas[sid];
      var val = isMatch ? '<span class="dl ' + (r.scores[sid] >= 2000 ? 'plus' : 'minus') + '">' + r.scores[sid] + '分</span>'
                        : '<span class="dl ' + (d >= 0 ? 'plus' : 'minus') + '">' + (d >= 0 ? '+' : '') + d + '</span>';
      var rl = isMatch ? '第' + (i + 1) + '名' : Game.RANK_LABEL[r.pos[sid] - 1];
      return '<div class="row ' + (w ? 'win' : '') + '" style="animation-delay:' + (i * 0.08) + 's"><span class="fc">' + faceSVG(sid) + '</span><span class="nm">' + esc(seat.name) + (sid === 0 ? '（你）' : '') + '</span><span class="rl">' + rl + '</span>' + val + '</div>'; }).join('');
    var extra = r.matchOver ? (win ? ' · 打通A，赢得整局！' : ' · 对方打通A') : (r.newLevel ? ' · 我方升至' + r.newLevel : '');
    if (lastSnap.mode && lastSnap.mode.gold) extra = ' · 底分' + lastSnap.base + ' × 倍数' + lastSnap.mult + ' × 排名' + (r.rankMult || 1) + '（双下4/一三游2/一四游1）';
    if (isMatch) extra = ' · 底分' + lastSnap.base + ' × 倍数' + lastSnap.mult + ' × 排名' + (r.rankMult || 1) + ' · 4局积分排名';
    return '<div class="settle">' + (win ? confettiHtml() : '') + '<div class="box"><h2>' + title + '</h2><div class="combo">' + (win ? '我方胜 🎉' : '对方胜') + ' · ' + r.comboName + ' · 倍数×' + lastSnap.mult + extra + '</div>' + rows + '<div class="btns"><button class="again" data-act="again">' + (r.matchOver ? '新比赛' : '再来一局') + '</button>' + (r.replay ? '<button class="back2" data-act="replay">🎬 回放本局</button>' : '') + '<button class="back2" data-act="lobby">返回大厅</button></div></div></div>';
  }
  // P1-3 回放：按手逐步还原本局公共事件
  var replayIdx = -1;
  function replayEvText(ev) {
    if (!lastSnap) return '';
    function nm(s) { return lastSnap.seats[s] ? esc(lastSnap.seats[s].name) : '?'; }
    if (ev.t === 'dbl') return nm(ev.seat) + (ev.yes ? ' 加倍' : ' 不加倍');
    if (ev.t === 'give') return nm(ev.from) + ' 向 ' + nm(ev.to) + ' 进贡';
    if (ev.t === 'back') return nm(ev.from) + ' 还贡给 ' + nm(ev.to);
    if (ev.t === 'pass') return nm(ev.seat) + ' 不出';
    if (ev.t === 'play') return nm(ev.seat) + ' 出 ' + (Rules.TYPE_NAME[ev.type] || ev.type);
    if (ev.t === 'settle') return '本局结算：' + (ev.combo || '');
    return '';
  }
  function replayHtml() {
    var r = lastSnap && lastSnap.lastResult;
    if (!r || !r.replay || !r.replay.length) return '';
    if (replayIdx < 0) replayIdx = 0; if (replayIdx >= r.replay.length) replayIdx = r.replay.length - 1;
    var ev = r.replay[replayIdx];
    var body = '<div class="rpev">' + replayEvText(ev) + '</div>';
    if (ev.t === 'play' && ev.cards) body += '<div class="rpcards">' + ev.cards.map(function (c) { return cardHtml(c, '', false, lastSnap.level); }).join('') + '</div>';
    else if ((ev.t === 'give' || ev.t === 'back') && ev.card) body += '<div class="rpcards">' + cardHtml(ev.card, '', false, lastSnap.level) + '</div>';
    return '<div class="modal"><div class="mbox rpbox"><h3>🎬 回放本局</h3><div class="rpprog">' + (replayIdx + 1) + ' / ' + r.replay.length + ' 手</div>' + body +
      '<div class="mbtns"><button class="mclose" data-act="rp-prev"' + (replayIdx === 0 ? ' disabled' : '') + '>‹ 上一手</button><button class="mclose" data-act="rp-next"' + (replayIdx >= r.replay.length - 1 ? ' disabled' : '') + '>下一手 ›</button><button class="mclose" data-act="rp-close">关闭</button></div></div></div>';
  }

  function diffSfx(prev, snap) {
    if (!prev) return;
    if (prev.phase !== 'settle' && snap.phase === 'settle' && snap.lastResult) { sfx('settle'); setTimeout(function () { sfx(snap.lastResult.winTeam === 0 ? 'win' : 'lose'); }, 200); }
    if (snap.top && (!prev.top || snap.top.owner !== prev.top.owner || snap.top.play !== prev.top.play)) { sfx('card'); if (Rules.isBomb(snap.top.play)) setTimeout(function () { sfx('bomb'); }, 30); }
    for (var i = 0; i < 4; i++) if (snap.seats[i].passed && !prev.seats[i].passed) sfx('pass');
    for (var j = 0; j < 4; j++) if (snap.seats[j].alarm && !prev.seats[j].alarm) { sfx('tick'); break; }  // P0-3 报警音
  }
  function render(snap) {
    if (hasNet() && Net.active && !Net.started) {
      app.innerHTML = Net.roomInfo ? onlineRoomHtml() : onlineEntryHtml();
      return;
    }
    if (!snap) return;
    if (snap.roundNo !== lastRoundNo) { lastRoundNo = snap.roundNo; locks = []; selected.clear(); hintIdx = -1; } // 换局清锁/清选，防跨局残留
    var prev = lastSnap;
    if (snap.phase !== 'play') dealShown = false;
    if (snap.phase === 'play' && !dealShown) { dealShown = true; sfx('deal'); }
    diffSfx(prev, snap); lastSnap = snap;
    if (typeof Voice !== 'undefined' && Voice) Voice.sync(prev, snap);   // 人声解说（边沿触发，不重复）
    if (snap.phase === 'settle' && prev && prev.phase !== 'settle' && snap.lastResult && !demo) histSave(snap);   // P2 战绩记录（进结算瞬间一次）
    app.innerHTML = snap.phase === 'lobby' ? lobbyHtml(snap) : (tableHtml(snap) + (snap.phase === 'settle' && snap.lastResult ? settleHtml(snap.lastResult) : '') + (replayIdx >= 0 ? replayHtml() : '') + panelHtml());
    manageTimer(snap);
    if (demo && (snap.canPlay || snap.canDouble || snap.canTribute)) setTimeout(demoStep, 350);
  }
  function manageTimer(snap) {
    var need = snap.canPlay || snap.canDouble || snap.canTribute;
    var key = snap.phase + '|' + snap.turn + '|' + snap.canPlay + '|' + snap.canDouble + '|' + snap.canTribute;
    if (key !== timerKey) {
      timerKey = key; if (timerInt) { clearInterval(timerInt); timerInt = null; }
      if (need) {
        timeLeft = 20;
        timerInt = setInterval(function () {
          timeLeft--; var el = app.querySelector('.clock .face'); if (el) el.textContent = timeLeft;
          var clk = app.querySelector('.clock'); if (clk) clk.classList.toggle('low', timeLeft <= 5);
          if (timeLeft <= 5) sfx('tick');
          if (timeLeft <= 0) { clearInterval(timerInt); timerInt = null; if (lastSnap.canPlay) G.humanTimeout(); else if (lastSnap.canDouble) G.humanDouble(false); else if (lastSnap.canTribute) G.humanTimeout(); }   // 进/还贡超时交给引擎代选
        }, 1000);
      }
    }
  }

  function toggleSelect(id) { if (selected.has(id)) { selected.delete(id); sfx('deselect'); } else { selected.add(id); sfx('select'); } hintIdx = -1; }
  function toggleGroup(ids) { // 整组勾选/取消（点锁定列的标签）
    var allSel = ids.length > 0 && ids.every(function (i) { return selected.has(i); });
    if (allSel) { ids.forEach(function (i) { selected.delete(i); }); sfx('deselect'); }
    else { ids.forEach(function (i) { selected.add(i); }); sfx('select'); }
    hintIdx = -1;
  }
  function flashHand() { var h = app.querySelector('.handbar'); if (h) { h.classList.add('flash'); setTimeout(function () { h.classList.remove('flash'); }, 400); } }
  function toggleSuit(s) { var hand = lastSnap.seats[0].cards || [], of = hand.filter(function (c) { return c.s === s; }); var allSel = of.length && of.every(function (c) { return selected.has(c.id); }); of.forEach(function (c) { if (allSel) selected.delete(c.id); else selected.add(c.id); }); sfx(allSel ? 'deselect' : 'select'); render(lastSnap); }
  function selIsLegal(snap) {
    if (!selected.size || !snap || !snap.canPlay) return false;
    var hand = snap.seats[0].cards || [], level = snap.level;
    var sc = Rules.sortHand(hand, level).filter(function (c) { return selected.has(c.id); });
    var cl = Rules.classify(sc, level);
    if (!cl || cl.cards.length !== sc.length) return false;
    if (snap.top && !Rules.canBeat(cl, snap.top.play)) return false;
    return true;
  }
  function lockBreak(P) { // 这手牌拆了几个"锁定组合"的牌（整组出=0，拆一部分=罚）
    if (!locks.length) return 0;
    var ids = {}; P.cards.forEach(function (c) { ids[c.id] = 1; });
    var pen = 0;
    for (var i = 0; i < locks.length; i++) {
      var lk = locks[i], used = 0;
      for (var j = 0; j < lk.ids.length; j++) if (ids[lk.ids[j]]) used++;
      if (used > 0 && used < lk.ids.length) pen += used;
    }
    return pen;
  }
  function legalMovesForSelf(snap) {
    var cards = snap.seats[0].cards, level = snap.level, all = Rules.generateAllPlays(cards, level), legal, leading = !snap.top;
    if (leading) legal = all.filter(function (p) { return !Rules.isBomb(p); });
    else legal = all.filter(function (p) { return Rules.canBeat(p, snap.top.play); });
    var ordered = (typeof AI !== 'undefined' && AI && AI.smartSort) ? AI.smartSort(cards, level, legal, leading) : legal.sort(function (a, b) { return Rules.playKey(a) - Rules.playKey(b); });
    if (!locks.length) return ordered;
    var deco = ordered.map(function (p, i) { return { p: p, lb: lockBreak(p), i: i }; });
    deco.sort(function (a, b) { return a.lb - b.lb || a.i - b.i; });   // 优先不拆锁定组合的牌
    return deco.map(function (d) { return d.p; });
  }
  function doPlay() {
    if (!lastSnap || !lastSnap.canPlay) return; var ids = Array.from(selected); if (!ids.length) return;
    var idset = {}; ids.forEach(function (i) { idset[i] = true; });
    locks = locks.filter(function (lk) { return !lk.ids.some(function (i) { return idset[i]; }); }); // 打出的牌若被锁，解散该锁
    if (G.humanPlay(ids)) { selected.clear(); hintIdx = -1; } else flashHand();
  }
  function doLock() {
    if (locks.length) { locks = []; selected.clear(); sfx('click'); render(lastSnap); return; }
    if (selected.size < 2) { flashHand(); return; }
    var ids = Array.from(selected), lockedIds = {}; locks.forEach(function (l) { l.ids.forEach(function (i) { lockedIds[i] = 1; }); });
    if (ids.some(function (i) { return lockedIds[i]; })) { flashHand(); return; }
    var cards = Rules.sortHand(lastSnap.seats[0].cards, lastSnap.level).filter(function (c) { return selected.has(c.id); });
    var cl = Rules.classify(cards, lastSnap.level);
    if (!cl || cl.cards.length !== cards.length) { flashHand(); return; }
    var label = cl.type.indexOf('bomb') === 0 ? Rules.bombLabel(cl.cards.length) : (Rules.TYPE_NAME[cl.type] || cl.type);
    var suit = null; if (cl.type === 'sf') { var nsf = cards.filter(function (c) { return !Cards.isWild(c, lastSnap.level); }); suit = nsf.length ? nsf[0].s : null; }
    locks.push({ ids: ids, type: cl.type, label: label, suit: suit }); selected.clear(); sfx('select'); render(lastSnap);
  }
  function toggleSFSuit(s) {
    if (!lastSnap || !lastSnap.canPlay) return;
    var hand = lastSnap.seats[0].cards || [], level = lastSnap.level;
    var existing = locks.filter(function (l) { return l.suit === s; })[0];
    if (existing) { locks = locks.filter(function (l) { return l !== existing; }); selected.clear(); sfx('deselect'); render(lastSnap); return; }
    var lockedIds = {}; locks.forEach(function (l) { l.ids.forEach(function (i) { lockedIds[i] = 1; }); });
    var pool = hand.filter(function (c) { return !lockedIds[c.id]; });
    var sf = Rules.findSF(pool, level, s); if (!sf) return;
    locks.push({ ids: sf.map(function (c) { return c.id; }), type: 'sf', label: '同花顺', suit: s }); selected.clear(); sfx('select'); render(lastSnap);
  }
  function doHint() { if (!lastSnap || !lastSnap.canPlay) return; var legal = legalMovesForSelf(lastSnap); if (!legal.length) { selected.clear(); render(lastSnap); return; } hintIdx = (hintIdx + 1) % legal.length; selected = new Set(legal[hintIdx].cards.map(function (c) { return c.id; })); sfx('select'); render(lastSnap); }
  function demoStep() {
    if (!lastSnap) return;
    if (lastSnap.canTribute) {
      if (lastSnap.tribute && lastSnap.tribute.tributeKind === 'give') { var gc = lastSnap.tribute.giveCandidates; if (gc && gc.length) G.humanTributeGive(gc[0]); }
      else G.humanTimeout();   // 引擎代选最小合规还贡牌
      return;
    }
    if (lastSnap.canDouble) { G.humanDouble(false); return; }
    if (lastSnap.canPlay) { var legal = legalMovesForSelf(lastSnap); if (!lastSnap.top || legal.length) { if (legal.length) G.humanPlay(legal[0].cards.map(function (c) { return c.id; })); else G.humanPass(); } else G.humanPass(); }
  }

  app.addEventListener('click', function (e) {
    if (demo) return; var t = e.target;
    var card = t.closest('[data-card-id]');
    if (card && lastSnap && (lastSnap.canPlay || lastSnap.canTribute)) {
      var cid = +card.dataset.cardId;
      toggleSelect(cid);   // 锁牌仅"分组展示"：点牌始终自由勾选，便于把钢板/顺子/炸弹拆开打；整组出请点该栏标签
      render(lastSnap); return;
    }
    var grpEl = t.closest('[data-grp]');
    if (grpEl && lastSnap && lastSnap.canPlay) { var gl = locks[+grpEl.dataset.grp]; if (gl) { toggleGroup(gl.ids); render(lastSnap); } return; }
    var pipEl = t.closest('[data-suit]');
    if (pipEl && lastSnap && lastSnap.canPlay) { toggleSFSuit(pipEl.dataset.suit); return; }
    var act = t.closest('[data-act]'); if (!act) return; sfx('click');
    switch (act.dataset.act) {
      case 'quick': G.quickStart(selectedBase); break;
      case 'more': panel = 'settings'; render(lastSnap); break;
      case 'hist': panel = 'hist'; render(lastSnap); break;
      case 'task': panel = 'task'; render(lastSnap); break;
      case 'mail': panel = 'mail'; render(lastSnap); break;
      case 'privacy': panel = 'privacy'; render(lastSnap); break;
      case 'season': panel = 'season'; render(lastSnap); break;
      case 'signin': doSign(); break;
      case 'panel-close': panel = null; render(lastSnap); break;
      case 'btnpos-reset': try { localStorage.removeItem('gd_btnpos'); } catch (e) {} toast('按钮组位置已复位'); panel = null; render(lastSnap); break;
      case 'shop-vip': shop = 'vip'; render(lastSnap); break;
      case 'shop-first': shop = 'first'; render(lastSnap); break;
      case 'shop-free': shop = 'free'; render(lastSnap); break;
      case 'shop-close': shop = null; render(lastSnap); break;
      case 'shop-buy': shopBuy(act.dataset.plan); render(lastSnap); break;
      case 'shop-claim': shopClaim(); render(lastSnap); break;
      case 'shop-ad': shopClaim('ad'); render(lastSnap); break;
      case 'room': selectedBase = +act.dataset.base; render(lastSnap); break;
      case 'play': doPlay(); break;
      case 'pass': if (G.humanPass()) selected.clear(); break;
      case 'hint': doHint(); break;
      case 'tribute': if (selected.size === 1 && G.humanTribute(Array.from(selected)[0])) selected.clear(); else flashHand(); break;
      case 'tribute-give': if (selected.size === 1 && G.humanTributeGive(Array.from(selected)[0])) selected.clear(); else flashHand(); break;
      case 'lock': doLock(); break;
      case 'rails':
        selected.clear();
        var rh = lastSnap && lastSnap.seats[0] && lastSnap.seats[0].cards;
        locks = (rh && rh.length) ? Rules.autoPlan(rh, lastSnap.level).map(function (g) { return { ids: g.ids, type: g.type, label: g.label, suit: g.suit }; }) : [];
        render(lastSnap);
        break;
      case 'counter': showCounter = !showCounter; render(lastSnap); break;
      case 'sort': cycleSort(); break;
      case 'voice': if (typeof Voice !== 'undefined' && Voice) toast(Voice.toggle() ? '🗣️ 人声解说 开' : '🔈 人声解说 关'); render(lastSnap); break;
      case 'mute': if (typeof Sfx !== 'undefined' && Sfx) Sfx.toggle(); render(lastSnap); break;
      case 'dbl-yes': sfx('double'); G.humanDouble(true); break;
      case 'dbl-no': G.humanDouble(false); break;
      case 'replay': replayIdx = 0; render(lastSnap); break;
      case 'rp-prev': if (replayIdx > 0) replayIdx--; render(lastSnap); break;
      case 'rp-next': replayIdx++; render(lastSnap); break;
      case 'rp-close': replayIdx = -1; render(lastSnap); break;
      case 'again': selected.clear(); locks = []; replayIdx = -1; if (lastSnap && lastSnap.matchOver) G.quickStart(selectedBase); else G.nextRound(); break;
      case 'lobby': selected.clear(); locks = []; replayIdx = -1; G.toLobby(); break;
      case 'online': if (hasNet()) Net.enterOnline(); break;
      case 'o-create': if (hasNet()) { var nm = app.querySelector('#o-name'); Net.createRoom(nm ? nm.value : ''); } break;
      case 'o-join': if (hasNet()) { var nm2 = app.querySelector('#o-name'); var cd = app.querySelector('#o-code'); Net.joinRoom(cd ? cd.value : '', nm2 ? nm2.value : ''); } break;
      case 'o-watch': if (hasNet()) { var cdw = app.querySelector('#o-code'); Net.spectateRoom(cdw ? cdw.value : ''); } break;
      case 'o-start': if (hasNet()) Net.startGame(); break;
      case 'o-dissolve': if (hasNet()) Net.dissolve(); break;
      case 'o-leave': if (hasNet()) Net.leaveRoom(); break;
    }
  });
  app.addEventListener('input', function (e) { var v = e.target.closest && e.target.closest('[data-vol]'); if (v) { var val = +v.value; if (typeof Sfx !== 'undefined' && Sfx && Sfx.setVolume) Sfx.setVolume(val / 100); try { localStorage.setItem('guandan_vol', val); } catch (er) {} } });
  app.addEventListener('click', function (e) { if (demo) return; var m = e.target.closest && e.target.closest('[data-theme-pick]'); if (!m) return;
    var need = THEME_LV[m.dataset.themePick] || 0;
    if (seasonInfo().lv < need) { toast('该桌布需赛季等级 Lv.' + need + ' 解锁'); return; }
    try { localStorage.setItem('gd_theme', m.dataset.themePick); } catch (er) {} applyTheme(); sfx('click'); render(lastSnap); });
  app.addEventListener('click', function (e) { if (demo) return; var m = e.target.closest && e.target.closest('[data-task-claim]'); if (!m) return; sfx('click'); taskClaim(m.dataset.taskClaim); });
  app.addEventListener('click', function (e) { if (demo) return; var m = e.target.closest && e.target.closest('[data-mail-claim]'); if (!m) return; sfx('click'); mailClaim(m.dataset.mailClaim); });
  // P2 按钮组拖拽：长按(300ms)桌中时钟后拖动整个操作按钮组，松手保存位置
  var dragSt = null;
  app.addEventListener('pointerdown', function (e) {
    if (demo) return;
    var clk = e.target.closest && e.target.closest('.center-actions .clock');
    if (!clk) return;
    var ca = clk.closest('.center-actions');
    dragSt = { x0: e.clientX, y0: e.clientY, bx: btnPos ? btnPos.x : 0, by: btnPos ? btnPos.y : 0, ca: ca, pid: e.pointerId, active: false, nx: null,
      hold: setTimeout(function () { if (dragSt) { dragSt.active = true; try { clk.setPointerCapture(dragSt.pid); } catch (er) {} } }, 300) };
  });
  app.addEventListener('pointermove', function (e) {
    if (!dragSt || !dragSt.active || e.pointerId !== dragSt.pid) return;
    dragSt.nx = dragSt.bx + (e.clientX - dragSt.x0); dragSt.ny = dragSt.by + (e.clientY - dragSt.y0);
    if (dragSt.ca) dragSt.ca.style.transform = 'translate(' + dragSt.nx + 'px,' + dragSt.ny + 'px)';
  });
  function endDrag() {
    if (!dragSt) return;
    clearTimeout(dragSt.hold);
    if (dragSt.active && dragSt.nx !== null) {
      btnPos = { x: dragSt.nx, y: dragSt.ny };
      try { localStorage.setItem('gd_btnpos', JSON.stringify(btnPos)); } catch (er) {}
      toast('按钮组位置已保存 · 更多里可复位');
    }
    dragSt = null;
  }
  app.addEventListener('pointerup', endDrag);
  app.addEventListener('pointercancel', endDrag);
  app.addEventListener('click', function (e) { if (demo) return; var m = e.target.closest && e.target.closest('[data-mode]'); if (!m || !lastSnap || lastSnap.phase !== 'lobby') return; var mode = m.dataset.mode, cur = lastSnap.mode && lastSnap.mode.noShuffle; if (mode === 'classic') G.setNoShuffle(false); else if (mode === 'noshuffle') G.setNoShuffle(!cur); });
  app.addEventListener('click', function (e) { if (demo) return; var m = e.target.closest && e.target.closest('[data-gold]'); if (!m || !lastSnap || lastSnap.phase !== 'lobby') return; sfx('click');
    if (m.dataset.gold === '1') G.setGoldMode(true); else if (m.dataset.gold === 'match') G.setMatchMode(true); else { G.setGoldMode(false); G.setMatchMode(false); } });
  app.addEventListener('click', function (e) { if (demo) return; var m = e.target.closest && e.target.closest('[data-rounds]'); if (!m || !hasNet() || !Net.active || Net.started) return; Net.roundsChoice = +m.dataset.rounds; sfx('click'); render(); });

  var UI = { render: render, onLobby: function () { selected.clear(); locks = []; hintIdx = -1; dealShown = false; panel = null; }, onSettle: function () {} };
  GLOBAL.GDRender = render;                 // net.js 用：推送服务器快照来渲染
  GLOBAL.GDToast = toast;                   // net.js 用：系统消息提示
  GLOBAL.GDSetBackend = function (b) { G = b; }; // net.js 用：把动作后端切到网络代理
  Game.init(UI);
  applyTheme();
  loadBtnPos();
  if (typeof Sfx !== 'undefined' && Sfx && Sfx.setVolume) Sfx.setVolume(vol() / 100);
  if (demo) G.quickStart(800);
})();
