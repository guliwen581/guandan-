/*
 * voice.js —— 人声解说（浏览器原生 speechSynthesis，零素材，中文 TTS）
 *  - Voice.sync(prev, snap) 由 ui.js 每次渲染调用，按"边沿"触发解说，避免重复/叠音；
 *  - Voice.toggle() 开关，偏好存 localStorage('guandan_voice')；节点/无 TTS 环境静默 no-op。
 *  - 解说只在"事件发生的瞬间"说一句（炸弹/王炸/同花顺/大炸/加倍/轮到你/进贡/抗贡/胜负），
 *    普通出牌不叨叨，保持克制。
 */
(function (root) {
  'use strict';
  var enabled = true, voice = null, last = 0;
  try { if (typeof localStorage !== 'undefined') { if (localStorage.getItem('guandan_voice') === '0') enabled = false; } } catch (e) {}

  function pickVoice() {
    if (typeof speechSynthesis === 'undefined') return null;
    var vs = speechSynthesis.getVoices() || [];
    return vs.filter(function (x) { return /zh|cmn|chinese/i.test(x.lang); })[0]
        || vs.filter(function (x) { return x.default; })[0] || vs[0] || null;
  }
  if (typeof speechSynthesis !== 'undefined') {
    try { speechSynthesis.onvoiceschanged = function () { voice = pickVoice(); }; voice = pickVoice(); } catch (e) {}
  }
  function rnd(a) { return a[Math.floor(Math.random() * a.length)]; }

  var LINES = {
    bomb: ['炸弹！', '开炸！', 'Boom！'], rocket: ['天王炸！', '王炸封顶！'], sf: ['同花顺！漂亮！', '清一色连！'],
    bigbomb: ['大炸弹！', '狠啊！'], double: ['加倍！', '敢加倍，有牌啊'], yourturn: ['该你出牌', '轮到你啦'],
    tribute: ['进贡还贡，稳住'], anti: ['抗贡！霸气！'], win: ['拿下！漂亮', '本局赢了'], lose: ['惜败，下一把'],
    matchwin: ['打通了！冠军！', '赢了整场！'], matchlose: ['对方打通了，再来']
  };

  function say(key) {
    if (!enabled || typeof speechSynthesis === 'undefined') return;
    var now = Date.now(); if (now - last < 700) return; last = now;     // 防叠音
    var line = (typeof key === 'string' && LINES[key]) ? rnd(LINES[key]) : key; if (!line) return;
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(line);
      u.lang = 'zh-CN'; u.rate = 1.05; u.pitch = 1.05; u.volume = 0.9; if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  // 边沿触发：只在状态"刚变成"时说一句
  function sync(prev, snap) {
    if (!prev || !snap) return;
    if (prev.phase !== 'settle' && snap.phase === 'settle' && snap.lastResult) {
      var w = snap.lastResult.winTeam === 0;
      say(snap.lastResult.matchOver ? (w ? 'matchwin' : 'matchlose') : (w ? 'win' : 'lose'));
    }
    if (snap.top && (!prev.top || snap.top.owner !== prev.top.owner || snap.top.play !== prev.top.play)) {
      var p = snap.top.play;
      if (p && p.type === 'rocket') say('rocket');
      else if (p && p.type === 'sf') say('sf');
      else if (p && p.type && p.type.indexOf('bomb') === 0) say((p.power || 0) >= 70 ? 'bigbomb' : 'bomb');
    }
    if (snap.canPlay && !prev.canPlay) say('yourturn');
    if (snap.canDouble && !prev.canDouble) say('double');
    if (snap.canTribute && !prev.canTribute) say('tribute');
    if (snap.tribute && snap.tribute.anti && !(prev.tribute && prev.tribute.anti)) say('anti');
  }

  var Voice = {
    get enabled() { return enabled; },
    toggle: function () {
      enabled = !enabled;
      try { localStorage.setItem('guandan_voice', enabled ? '1' : '0'); } catch (e) {}
      if (!enabled && typeof speechSynthesis !== 'undefined') { try { speechSynthesis.cancel(); } catch (e) {} }
      else say('yourturn');
      return enabled;
    },
    setEnabled: function (v) { enabled = !!v; },
    say: say, sync: sync
  };
  root.Voice = Voice;
})(typeof window !== 'undefined' ? window : globalThis);
