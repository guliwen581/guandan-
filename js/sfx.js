/*
 * sfx.js —— 掼蛋音效（WebAudio 实时合成，无需任何音频素材）
 * 节点安全：无 window/AudioContext 时所有方法静默 no-op。
 * 用法：Sfx.play('card') 等；Sfx.toggle() 切换静音；Sfx.enabled 状态。
 */
(function (root) {
  'use strict';
  var enabled = true, ctx = null, master = null, volLevel = 1;

  function ac() {
    if (typeof window === 'undefined') return null;
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volLevel;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, vol, when) {
    var c = ac(); if (!c || !enabled) return;
    var t = c.currentTime + (when || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
  }

  function sweep(f0, f1, dur, type, vol) {
    var c = ac(); if (!c || !enabled) return;
    var t = c.currentTime;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
  }

  function noise(dur, vol, lp) {
    var c = ac(); if (!c || !enabled) return;
    var t = c.currentTime, n = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = c.createBufferSource(); src.buffer = buf;
    var g = c.createGain(); g.gain.value = vol || 0.2;
    var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 1200;
    src.connect(f); f.connect(g); g.connect(master); src.start(t);
  }

  var Sfx = {
    get enabled() { return enabled; },
    toggle: function () { enabled = !enabled; if (enabled) tone(700, 0.08, 'sine', 0.15); return enabled; },
    setVolume: function (v) { volLevel = Math.max(0, Math.min(1, v)); if (master) master.gain.value = volLevel; return volLevel; },
    getVolume: function () { return volLevel; },
    select: function () { tone(720, 0.045, 'square', 0.09); },
    deselect: function () { tone(420, 0.04, 'square', 0.07); },
    click: function () { tone(480, 0.05, 'triangle', 0.12); },
    card: function () { noise(0.06, 0.18, 3000); tone(220, 0.04, 'triangle', 0.08); },
    pass: function () { sweep(520, 180, 0.22, 'sine', 0.12); },
    bomb: function () { noise(0.45, 0.32, 600); tone(70, 0.4, 'sawtooth', 0.22); tone(110, 0.3, 'square', 0.12, 0.02); },
    double: function () { tone(520, 0.08, 'square', 0.12); tone(780, 0.1, 'square', 0.12, 0.07); },
    tick: function () { tone(900, 0.03, 'sine', 0.06); },
    deal: function () { for (var i = 0; i < 6; i++) noise(0.04, 0.08, 2500, i * 0.05); },
    win: function () { var n = [523, 659, 784, 1047]; for (var i = 0; i < n.length; i++) tone(n[i], 0.22, 'triangle', 0.18, i * 0.12); },
    lose: function () { var n = [392, 330, 262, 196]; for (var i = 0; i < n.length; i++) tone(n[i], 0.24, 'sawtooth', 0.14, i * 0.13); },
    settle: function () { tone(660, 0.12, 'sine', 0.12); tone(990, 0.16, 'sine', 0.12, 0.08); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Sfx;
  else root.Sfx = Sfx;
})(typeof window !== 'undefined' ? window : globalThis);
