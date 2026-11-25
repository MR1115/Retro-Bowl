/* Pixel Gridiron — rendering, input, audio and online multiplayer. */
(() => {
  'use strict';
  const Sim = window.PGSim;
  const W = 480, H = 270, SX = 8, SY = 4.5, FY = 26;
  const FL = Sim.FL, FW = Sim.FW, MID = Sim.MID;
  const STEP = 1 / 60;
  const PREFIX = 'pixgrid-v1-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

  // c = jersey, d = helmet / dark, h = pants & trim
  const COLORS = [
    { c: '#d94141', d: '#8e1f1f', h: '#f1f1f1' },
    { c: '#2f6fd6', d: '#173f86', h: '#f1f1f1' },
    { c: '#2e9b4f', d: '#16592a', h: '#f2d14b' },
    { c: '#ec7a26', d: '#9a4511', h: '#f1f1f1' },
    { c: '#7d47c9', d: '#46217e', h: '#f2d14b' },
    { c: '#1fa7a3', d: '#0f5f5c', h: '#f1f1f1' },
    { c: '#3a3a46', d: '#17171d', h: '#e8b923' },
    { c: '#e8b923', d: '#8f6d0c', h: '#2b2b33' },
  ];
  const CPU_NAMES = ['COMETS', 'IRONCLADS', 'THUNDER', 'GATORS', 'MONARCHS', 'RAPTORS', 'BARONS', 'VIPERS'];

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const wrap = $('wrap');

  // ---------- settings ----------
  const settings = { name: 'HAWKS', color: 0, qlen: 3 };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('pg-settings') || '{}')); } catch (e) { /* ignore */ }
  function saveSettings() { try { localStorage.setItem('pg-settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } }

  // ---------- state ----------
  let S = null;            // game state (authoritative on host/cpu, mirrored on client)
  let mode = 'menu';       // menu | cpu | host | client
  let myTeam = 0, flip = false;
  let inputs = [mkIn(), mkIn()];
  function mkIn() { return { mx: 0, my: 0, events: [] }; }

  // ---------- layout ----------
  function fit() {
    const s = Math.min(innerWidth / W, innerHeight / H);
    wrap.style.width = W * s + 'px';
    wrap.style.height = H * s + 'px';
    wrap.style.setProperty('--u', (s * 0.72).toFixed(3));
  }
  addEventListener('resize', fit);
  fit();

  // ---------- audio ----------
  let AC = null;
  function ac() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(f, dur, type, vol, slideTo, delay) {
    const a = ac(); if (!a) return;
    const t0 = a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol || 0.06, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol) {
    const a = ac(); if (!a) return;
    const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = a.createBufferSource(), g = a.createGain(); g.gain.value = vol || 0.12;
    s.buffer = buf; s.connect(g); g.connect(a.destination); s.start();
  }
  const SFX = {
    hike: () => tone(180, 0.08, 'square', 0.07),
    whistle: () => { tone(2100, 0.1, 'square', 0.035); tone(2300, 0.22, 'square', 0.035, 0, 0.12); },
    throw: () => tone(420, 0.18, 'triangle', 0.1, 900),
    catch: () => { tone(660, 0.06, 'square', 0.06); tone(990, 0.08, 'square', 0.06, 0, 0.06); },
    dive: () => noise(0.12, 0.08),
    juke: () => tone(300, 0.12, 'sawtooth', 0.05, 700),
    int: () => { tone(500, 0.12, 'square', 0.07, 200); tone(300, 0.2, 'square', 0.07, 120, 0.12); },
    kick: () => { noise(0.06, 0.2); tone(140, 0.08, 'square', 0.08); },
    first: () => { tone(523, 0.08, 'square', 0.05); tone(784, 0.12, 'square', 0.05, 0, 0.08); },
    good: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, 'square', 0.05, 0, i * 0.09)),
    bad: () => tone(300, 0.4, 'sawtooth', 0.05, 90),
    td: () => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.14, 'square', 0.06, 0, i * 0.11)),
    final: () => [392, 523, 659, 784].forEach((f, i) => tone(f, 0.3, 'triangle', 0.08, 0, i * 0.2)),
  };
  function playSfx(n) { if (SFX[n]) SFX[n](); }

  // ---------- screens / DOM ----------
  const screens = ['menu', 'lobby', 'help', 'over'];
  function showScreen(name) { for (const s of screens) $(s).classList.toggle('on', s === name); }

  // menu setup
  const sw = $('swatches');
  COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'sw'; b.style.background = `linear-gradient(135deg, ${c.c} 60%, ${c.h} 60%)`;
    b.onclick = () => { settings.color = i; saveSettings(); refreshMenu(); };
    sw.appendChild(b);
  });
  $('tname').value = settings.name;
  $('tname').addEventListener('input', () => { settings.name = $('tname').value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 10); saveSettings(); });
  document.querySelectorAll('#qlen button').forEach((b) => (b.onclick = () => { settings.qlen = +b.dataset.v; saveSettings(); refreshMenu(); }));
  function refreshMenu() {
    [...sw.children].forEach((b, i) => b.classList.toggle('on', i === settings.color));
    document.querySelectorAll('#qlen button').forEach((b) => b.classList.toggle('on', +b.dataset.v === settings.qlen));
  }
  refreshMenu();

  $('bCpu').onclick = () => { ac(); startCpu(false); };
  $('bHost').onclick = () => { ac(); hostGame(); };
  $('bJoin').onclick = () => { ac(); openJoin(); };
  $('bHelp').onclick = () => showScreen('help');
  $('bHelpBack').onclick = () => showScreen('menu');
  $('bBack').onclick = () => { closeNet(); showScreen('menu'); };
  $('bMenu').onclick = () => toMenu();
  $('bQuit').onclick = () => { if (confirm('Quit this game?')) toMenu(); };
  $('bAgain').onclick = () => {
    if (mode === 'cpu') startCpu(S && S.cpu[0]);
    else if (mode === 'host') startHostGame();
    else if (mode === 'client') { send({ t: 'again' }); $('overScore').textContent = 'WAITING FOR HOST...'; }
  };
  $('bConnect').onclick = () => joinGame($('joinCode').value);
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame($('joinCode').value); });
  $('bCopy').onclick = () => {
    const url = location.origin + location.pathname + '?join=' + hostCode;
    const done = () => { $('bCopy').textContent = 'COPIED!'; setTimeout(() => ($('bCopy').textContent = 'COPY INVITE LINK'), 1500); };
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) navigator.share({ title: 'Pixel Gridiron', text: 'Play me in Pixel Gridiron! Code: ' + hostCode, url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link:', url));
    else prompt('Copy this link:', url);
  };
  document.querySelectorAll('#playcall button').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); localEvent({ k: 'choice', v: b.dataset.c }); }));

  function toMenu() {
    closeNet(); mode = 'menu'; S = null; showScreen('menu');
  }

  function pickCpuColor() { let c; do { c = (Math.random() * COLORS.length) | 0; } while (c === settings.color); return c; }

  function startCpu(demo) {
    S = Sim.newGame({
      teams: [{ name: settings.name || 'HOME', color: settings.color }, { name: CPU_NAMES[(Math.random() * CPU_NAMES.length) | 0], color: pickCpuColor() }],
      cpu: [!!demo, true], qlen: settings.qlen * 60,
    });
    mode = 'cpu'; myTeam = 0; flip = false; inputs = [mkIn(), mkIn()];
    showScreen(null);
  }

  // ---------- networking (PeerJS / WebRTC, host-authoritative) ----------
  let peer = null, conn = null, hostCode = '', guest = null, netFx = [], lastSent = '';
  function closeNet() {
    try { if (conn) conn.close(); } catch (e) { /* ignore */ }
    try { if (peer) peer.destroy(); } catch (e) { /* ignore */ }
    conn = null; peer = null; guest = null;
  }
  function send(m) { if (conn && conn.open) { try { conn.send(m); } catch (e) { /* ignore */ } } }
  function lobbyStatus(t) { $('lobbyStatus').textContent = t; }
  function netLost() {
    if (mode === 'host' || mode === 'client') {
      closeNet(); mode = 'menu'; S = null; showScreen('lobby');
      $('lobby').className = 'screen on'; $('lobbyTitle').textContent = 'DISCONNECTED';
      lobbyStatus('Your friend left or the connection dropped.');
    }
  }
  function noPeer() {
    showScreen('lobby'); $('lobby').className = 'screen on'; $('lobbyTitle').textContent = 'ONLINE';
    lobbyStatus('Online play could not load. Check your internet connection.');
  }
  function randCode() { let s = ''; for (let i = 0; i < 5; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]; return s; }

  function hostGame(tries) {
    if (!window.Peer) return noPeer();
    closeNet();
    hostCode = randCode();
    showScreen('lobby'); $('lobby').className = 'screen on host';
    $('lobbyTitle').textContent = 'HOST GAME'; $('roomCode').textContent = '.....';
    lobbyStatus('Creating room...');
    peer = new window.Peer(PREFIX + hostCode, { debug: 0 });
    peer.on('open', () => { $('roomCode').textContent = hostCode; lobbyStatus('Waiting for a friend to join...'); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && (tries || 0) < 3) return hostGame((tries || 0) + 1);
      if (mode === 'host') return; // in-game errors are handled by the connection close
      lobbyStatus('Network error: ' + e.type + '. Try again.');
    });
    peer.on('connection', (c) => {
      if (conn && conn.open) { c.on('open', () => c.close()); return; }
      conn = c;
      c.on('data', onHostData);
      c.on('close', netLost);
      c.on('error', netLost);
    });
  }

  function onHostData(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      guest = { name: String(m.name || 'GUEST').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 10) || 'GUEST', color: clamp(m.color | 0, 0, COLORS.length - 1) };
      startHostGame();
    } else if (m.t === 'i' && mode === 'host') {
      inputs[1].mx = clamp(+m.mx || 0, -1, 1); inputs[1].my = clamp(+m.my || 0, -1, 1);
    } else if (m.t === 'e' && mode === 'host' && m.e && inputs[1].events.length < 16) {
      const e = m.e;
      if (e.k === 'throw') inputs[1].events.push({ k: 'throw', x: +e.x, y: +e.y });
      else if (e.k === 'dive' || e.k === 'tap') inputs[1].events.push({ k: e.k });
      else if (e.k === 'choice') inputs[1].events.push({ k: 'choice', v: String(e.v) });
    } else if (m.t === 'again' && mode === 'host' && S && S.phase === 'over') {
      startHostGame();
    }
  }

  function startHostGame() {
    if (!guest) return;
    let gc = guest.color;
    if (gc === settings.color) gc = (gc + 1) % COLORS.length;
    S = Sim.newGame({ teams: [{ name: settings.name || 'HOST', color: settings.color }, { name: guest.name, color: gc }], cpu: [false, false], qlen: settings.qlen * 60 });
    mode = 'host'; myTeam = 0; flip = false; inputs = [mkIn(), mkIn()];
    showScreen(null);
    send({ t: 'start' });
  }

  function openJoin() {
    if (!window.Peer) return noPeer();
    showScreen('lobby'); $('lobby').className = 'screen on join';
    $('lobbyTitle').textContent = 'JOIN GAME'; lobbyStatus('');
    setTimeout(() => $('joinCode').focus(), 50);
  }

  function joinGame(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 5) return lobbyStatus('Codes are 5 letters.');
    if (!window.Peer) return noPeer();
    closeNet();
    lobbyStatus('Connecting...');
    peer = new window.Peer({ debug: 0 });
    peer.on('open', () => {
      conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('open', () => { send({ t: 'hello', name: settings.name || 'GUEST', color: settings.color }); lobbyStatus('Connected! Starting...'); });
      conn.on('data', onClientData);
      conn.on('close', netLost);
      conn.on('error', netLost);
    });
    peer.on('error', (e) => {
      if (mode === 'client') return netLost();
      lobbyStatus(e.type === 'peer-unavailable' ? 'No game found with that code.' : 'Network error: ' + e.type);
    });
  }

  function onClientData(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'start') {
      mode = 'client'; myTeam = 1; flip = true; inputs = [mkIn(), mkIn()]; disp.clear();
      showScreen(null);
    } else if (m.t === 's' && m.s) {
      if (mode !== 'client') { mode = 'client'; myTeam = 1; flip = true; showScreen(null); }
      S = m.s;
      if (Array.isArray(m.fx)) m.fx.forEach(playSfx);
    }
  }

  const r2 = (v) => Math.round((v || 0) * 100) / 100;
  function snapshot() {
    const k = S.kick;
    return {
      phase: S.phase, phaseT: r2(S.phaseT), teams: S.teams, cpu: S.cpu, quarter: S.quarter, clock: r2(S.clock), poss: S.poss,
      los: r2(S.los), ltg: r2(S.ltg), down: S.down, ballY: r2(S.ballY), msg: S.msg, sub: S.sub, flash: S.flash, flashT: r2(S.flashT),
      ctrl: S.ctrl, ids: S.ids, qlen: S.qlen,
      play: S.play && { type: S.play.type, t: r2(S.play.t), thrown: S.play.thrown, handed: S.play.handed },
      kick: k && { type: k.type, team: k.team, dist: k.dist, win: k.win, n: r2(k.n), done: k.done, good: k.good, from: r2(k.from), tx: r2(k.tx), ty: r2(k.ty) },
      ball: { state: S.ball.state, carrier: S.ball.carrier, x: r2(S.ball.x), y: r2(S.ball.y), z: r2(S.ball.z), tx: r2(S.ball.tx), ty: r2(S.ball.ty) },
      players: S.players.map((p) => ({ id: p.id, team: p.team, role: p.role, num: p.num, x: r2(p.x), y: r2(p.y), vx: r2(p.vx), vy: r2(p.vy), diveT: r2(p.diveT), downT: r2(p.downT) })),
    };
  }

  // auto-join from invite link
  const qp = new URLSearchParams(location.search);
  if (qp.get('join')) { $('joinCode').value = qp.get('join').toUpperCase().slice(0, 5); openJoin(); }

  // ---------- input ----------
  const keys = {};
  let joy = null, aim = null, jmx = 0, jmy = 0;

  function localEvent(ev) {
    if (mode === 'client') send({ t: 'e', e: ev });
    else if (mode === 'cpu' || mode === 'host') inputs[myTeam].events.push(ev);
  }

  addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (!S || e.repeat) return;
    if (e.code === 'Space') localEvent({ k: S.phase === 'kick' ? 'tap' : 'dive' });
    if (S.phase === 'presnap' && S.poss === myTeam) {
      const m = { KeyR: 'run', KeyP: 'pass', KeyK: 'punt', KeyF: 'fg' }[e.code];
      if (m) localEvent({ k: 'choice', v: m });
    }
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  function toLogical(e) {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }
  function screenToWorld(l) {
    let x = (l.x + camX) / SX;
    if (flip) x = FL - x;
    return { x, y: (l.y - FY) / SY };
  }
  function canAim() { return S && (mode !== 'menu') && Sim.canThrow(S, myTeam) && !S.cpu[myTeam]; }

  cv.addEventListener('pointerdown', (e) => {
    if (!S || mode === 'menu') return;
    ac();
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const l = toLogical(e);
    if (S.phase === 'kick') { localEvent({ k: 'tap' }); return; }
    if (canAim()) { aim = { id: e.pointerId, l }; return; }
    joy = { id: e.pointerId, x0: l.x, y0: l.y, t0: performance.now(), moved: false };
  });
  cv.addEventListener('pointermove', (e) => {
    const l = toLogical(e);
    if (aim && e.pointerId === aim.id) { aim.l = l; return; }
    if (joy && e.pointerId === joy.id) {
      const dx = l.x - joy.x0, dy = l.y - joy.y0;
      if (Math.hypot(dx, dy) > 5) joy.moved = true;
      jmx = clamp(dx / 18, -1, 1); jmy = clamp(dy / 18, -1, 1);
      if (Math.hypot(jmx, jmy) < 0.25) { jmx = 0; jmy = 0; }
    }
  });
  function pointerEnd(e) {
    if (aim && e.pointerId === aim.id) {
      if (canAim() && e.type === 'pointerup') { const w = screenToWorld(aim.l); localEvent({ k: 'throw', x: w.x, y: w.y }); }
      aim = null; return;
    }
    if (joy && e.pointerId === joy.id) {
      if (!joy.moved && performance.now() - joy.t0 < 260 && e.type === 'pointerup') localEvent({ k: 'dive' });
      joy = null; jmx = 0; jmy = 0;
    }
  }
  cv.addEventListener('pointerup', pointerEnd);
  cv.addEventListener('pointercancel', pointerEnd);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  let lastMx = 0, lastMy = 0;
  function gatherInput() {
    let mx = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0) + jmx;
    let my = (keys.ArrowDown || keys.KeyS ? 1 : 0) - (keys.ArrowUp || keys.KeyW ? 1 : 0) + jmy;
    mx = clamp(mx, -1, 1); my = clamp(my, -1, 1);
    if (flip) mx = -mx;
    if (mode === 'client') {
      if (Math.abs(mx - lastMx) > 0.05 || Math.abs(my - lastMy) > 0.05) { send({ t: 'i', mx: r2(mx), my: r2(my) }); lastMx = mx; lastMy = my; }
    } else if (mode === 'cpu' || mode === 'host') {
      inputs[myTeam].mx = mx; inputs[myTeam].my = my;
    }
  }

  // ---------- rendering ----------
  let camX = 0;
  const disp = new Map();
  const wpx = (x) => (flip ? FL - x : x) * SX;
  const sx = (x) => Math.round(wpx(x) - camX);
  const sy = (y) => Math.round(FY + y * SY);
  const team = (t) => COLORS[(S.teams[t] && S.teams[t].color) | 0] || COLORS[0];

  function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function text(t, x, y, c, size, align) {
    ctx.font = (size || 8) + "px 'Press Start 2P', monospace";
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#000'; ctx.fillText(t, x + 1, y + 1);
    ctx.fillStyle = c || '#fff'; ctx.fillText(t, x, y);
  }

  function focusX() {
    const b = S.ball, d = Sim.dir(S.poss);
    if (S.phase === 'presnap') return S.los + d * 13;
    if (S.phase === 'kick') return b.x + (S.kick && !S.kick.done ? Sim.dir(S.kick.team) * 14 : 0);
    if (b.state === 'held' && S.players[b.carrier]) {
      const c = S.players[b.carrier];
      if (S.play && S.play.type === 'pass' && !S.play.thrown) return S.los + d * 13;
      return c.x + Sim.dir(c.team) * 7;
    }
    if (b.state === 'air') return b.x;
    return b.x;
  }

  function drawField() {
    rect(0, 0, W, H, '#1a4a1f');
    const top = sy(0), bot = sy(FW);
    for (let x = 10; x < 110; x += 5) {
      const a = sx(x), b = sx(x + 5);
      rect(Math.min(a, b), top, Math.abs(b - a), bot - top, ((x - 10) / 5) % 2 ? '#2f8a3a' : '#349640');
    }
    // end zones
    for (const t of [0, 1]) {
      const own = Sim.ownGoal(t), x0 = t === 0 ? 0 : 110;
      const a = sx(x0), b = sx(x0 + 10), c = team(t);
      rect(Math.min(a, b), top, Math.abs(b - a), bot - top, c.d);
      ctx.save();
      ctx.translate((a + b) / 2, (top + bot) / 2);
      ctx.rotate(((t === 0) !== flip ? -1 : 1) * Math.PI / 2);
      ctx.globalAlpha = 0.85;
      text(S.teams[t].name, 0, -6, c.h, 12, 'center');
      ctx.restore();
      void own;
    }
    // lines
    for (let x = 10; x <= 110; x += 5) rect(sx(x), top, 1, bot - top, 'rgba(255,255,255,.85)');
    for (let x = 11; x < 110; x++) {
      if (x % 5 === 0) continue;
      const X = sx(x);
      rect(X, sy(1), 1, 2, 'rgba(255,255,255,.6)'); rect(X, sy(FW - 1) - 2, 1, 2, 'rgba(255,255,255,.6)');
      rect(X, sy(22.5), 1, 2, 'rgba(255,255,255,.6)'); rect(X, sy(FW - 22.5), 1, 2, 'rgba(255,255,255,.6)');
    }
    rect(sx(0) - (flip ? 1 : 0), top, 1, bot - top, '#fff'); rect(sx(FL), top, 1, bot - top, '#fff');
    rect(Math.min(sx(0), sx(FL)), top - 1, Math.abs(sx(FL) - sx(0)), 2, '#fff');
    rect(Math.min(sx(0), sx(FL)), bot - 1, Math.abs(sx(FL) - sx(0)), 2, '#fff');
    // numbers
    for (let x = 20; x <= 100; x += 10) {
      const n = String(50 - Math.abs(60 - x));
      const X = sx(x);
      if (X < -20 || X > W + 20) continue;
      ctx.globalAlpha = 0.75;
      text(n, X + 1, sy(7) - 4, '#fff', 8, 'center');
      text(n, X + 1, sy(FW - 7) - 4, '#fff', 8, 'center');
      ctx.globalAlpha = 1;
    }
    drawPosts(0); drawPosts(FL);
  }

  function drawPosts(x) {
    const X = sx(x), Y = sy(MID);
    if (X < -20 || X > W + 20) return;
    rect(X, Y - 10, 1, 10, '#e8d23a');
    const a = sy(MID - 3), b = sy(MID + 3);
    ctx.strokeStyle = '#f2df4a'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X + 0.5, a - 10); ctx.lineTo(X + 0.5, b - 10);
    ctx.moveTo(X + 0.5, a - 10); ctx.lineTo(X + 0.5, a - 30);
    ctx.moveTo(X + 0.5, b - 10); ctx.lineTo(X + 0.5, b - 30);
    ctx.stroke();
  }

  function dispPos(p, k) {
    let d = disp.get(p.id);
    if (!d || Math.hypot(d.x - p.x, d.y - p.y) > 4 || mode !== 'client') { d = { x: p.x, y: p.y }; disp.set(p.id, d); }
    else { d.x += (p.x - d.x) * k; d.y += (p.y - d.y) * k; }
    return d;
  }

  function drawPlayer(p, now, pos) {
    const X = sx(pos.x), Y = sy(pos.y);
    if (X < -12 || X > W + 12) return;
    const c = team(p.team);
    let face = Math.abs(p.vx) > 0.3 ? Math.sign(p.vx) : Sim.dir(p.team);
    if (flip) face = -face;
    rect(X - 4, Y - 1, 9, 2, 'rgba(0,0,0,.28)');
    const mine = S.ctrl && S.ctrl[myTeam] === p.id && !S.cpu[myTeam] && (S.phase === 'live' || S.phase === 'presnap');
    if (mine) {
      const bob = Math.floor(now / 200) % 2;
      rect(X - 5, Y, 11, 1, '#ffe14d');
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath(); ctx.moveTo(X - 3, Y - 21 - bob); ctx.lineTo(X + 4, Y - 21 - bob); ctx.lineTo(X + 0.5, Y - 17 - bob); ctx.fill();
    }
    if (p.diveT > 0 || p.downT > 0) {
      const f = face;
      rect(X - 5, Y - 4, 10, 3, c.c);
      rect(f > 0 ? X - 7 : X + 5, Y - 4, 3, 3, c.h);
      rect(f > 0 ? X + 5 : X - 8, Y - 5, 4, 4, c.d);
      return;
    }
    const moving = Math.hypot(p.vx, p.vy) > 0.6;
    const ph = moving ? Math.floor(now / 110 + p.id) % 2 : 0;
    rect(X - 2, Y - 5, 2, ph ? 4 : 5, c.h);
    rect(X + 1, Y - 5, 2, ph ? 5 : 4, c.h);
    rect(X - 3, Y - 10, 7, 5, c.c);
    rect(X - 3, Y - 8, 7, 1, c.h);
    rect(X - 4, Y - 9 + ph, 1, 3, c.d); rect(X + 4, Y - 9 + (1 - ph), 1, 3, c.d);
    rect(X - 2, Y - 14, 5, 4, c.d);
    rect(X, Y - 14, 1, 4, c.h);
    rect(face > 0 ? X + 3 : X - 3, Y - 13, 1, 2, '#cfcfcf');
  }

  function drawBall(x, y, z) {
    const X = sx(x), Y = sy(y);
    rect(X - 1, Y - 1, 3, 1, 'rgba(0,0,0,.35)');
    const by = Y - 3 - Math.round(z * 4);
    rect(X - 2, by - 1, 4, 3, '#7a3e12');
    rect(X - 1, by - 2, 2, 1, '#7a3e12'); rect(X - 1, by + 2, 2, 1, '#7a3e12');
    rect(X - 1, by, 2, 1, '#f4f4f4');
  }

  function drawHUD(now) {
    rect(0, 0, W, 22, '#0b1016');
    rect(0, 22, W, 1, '#2a3442');
    const clockLeft = Math.max(0, S.clock - (S.phase === 'live' && S.play ? S.play.t : 0));
    const mm = Math.floor(clockLeft / 60), ss = Math.floor(clockLeft % 60);
    const left = flip ? 1 : 0, right = 1 - left;
    for (const [t, side] of [[left, 0], [right, 1]]) {
      const c = team(t), x = side === 0 ? 6 : W - 6;
      rect(side === 0 ? x : x - 10, 5, 10, 12, c.c); rect(side === 0 ? x : x - 10, 5, 10, 3, c.h);
      const nm = S.teams[t].name + (t === myTeam && mode !== 'cpu' ? ' (YOU)' : '');
      text(nm, side === 0 ? x + 14 : x - 14, 4, '#fff', 8, side === 0 ? 'left' : 'right');
      text(String(S.teams[t].score), side === 0 ? x + 14 : x - 14, 13, '#e8b923', 8, side === 0 ? 'left' : 'right');
      if (S.poss === t && S.phase !== 'over') {
        const bx = side === 0 ? x + 14 + 8 * (String(S.teams[t].score).length + 1) : x - 14 - 8 * (String(S.teams[t].score).length + 1) - 6;
        rect(bx, 15, 6, 4, '#7a3e12'); rect(bx + 2, 16, 2, 1, '#fff');
      }
    }
    const q = S.quarter >= 5 ? 'OT' : 'Q' + S.quarter;
    text(q + ' ' + mm + ':' + String(ss).padStart(2, '0'), W / 2, 4, '#fff', 8, 'center');
    if (S.phase === 'presnap' || S.phase === 'live') text(Sim.downText(S) + '  ' + Sim.yardText(S), W / 2, 13, '#9fd3ff', 8, 'center');
    void now;
  }

  function hint() {
    if (!S || S.cpu[myTeam]) return '';
    const touch = matchMedia('(pointer: coarse)').matches;
    if (S.phase === 'presnap') return S.poss === myTeam ? '' : 'DEFENSE: WAITING FOR THE SNAP';
    if (S.phase === 'kick' && S.kick && !S.kick.done) return S.kick.team === myTeam ? (touch ? 'TAP TO KICK!' : 'CLICK OR SPACE TO KICK!') : 'OPPONENT IS KICKING';
    if (S.phase !== 'live') return '';
    if (Sim.canThrow(S, myTeam)) return touch ? 'TAP WHERE TO THROW' : 'CLICK WHERE TO THROW  (ARROWS: SCRAMBLE)';
    const b = S.ball, c = b.state === 'held' ? S.players[b.carrier] : null;
    if (c && c.team === myTeam) return touch ? 'DRAG TO STEER - TAP TO DIVE' : 'ARROWS/WASD STEER - SPACE DIVES';
    if (S.poss !== myTeam || (c && c.team !== myTeam)) return touch ? 'DRAG TO MOVE - TAP TO DIVE' : 'ARROWS/WASD MOVE - SPACE DIVES';
    return '';
  }

  function drawKickMeter() {
    const K = S.kick;
    if (!K) return;
    const bw = 180, bx = (W - bw) / 2, by = H - 34;
    rect(bx - 3, by - 14, bw + 6, 26, 'rgba(0,0,0,.6)');
    const label = K.type === 'punt' ? 'PUNT POWER' : K.type === 'xp' ? 'EXTRA POINT' : K.dist + ' YD FIELD GOAL';
    text(label, W / 2, by - 11, '#fff', 8, 'center');
    rect(bx, by, bw, 8, '#5a1f1f');
    if (K.type === 'punt') {
      for (let i = 0; i < bw; i++) { const n = Math.abs(i / bw * 2 - 1); rect(bx + i, by, 1, 8, n < 0.3 ? '#3fcf5a' : n < 0.65 ? '#e8b923' : '#c0392b'); }
    } else {
      const w = K.win * bw / 2;
      rect(bx + bw / 2 - w, by, w * 2, 8, '#3fcf5a');
    }
    const nx = bx + bw / 2 + K.n * bw / 2;
    rect(Math.round(nx) - 1, by - 3, 3, 14, '#fff');
  }

  function render(now, dt) {
    ctx.imageSmoothingEnabled = false;
    if (!S) { drawAttract(now); return; }
    const tx = clamp(wpx(focusX()) - W / 2, -30, FL * SX - W + 30);
    camX += (tx - camX) * Math.min(1, dt * 4);
    if (Math.abs(tx - camX) > 400) camX = tx;
    drawField();
    if (S.phase === 'presnap' || S.phase === 'live') {
      rect(sx(S.los), sy(0), 1, sy(FW) - sy(0), '#4aa3ff');
      if (S.ltg !== Sim.goalX(S.poss)) rect(sx(S.ltg), sy(0), 1, sy(FW) - sy(0), '#ffd23a');
    }
    const k = Math.min(1, dt * 18);
    const list = S.players.map((p) => ({ p, d: dispPos(p, k) })).sort((a, b) => a.d.y - b.d.y);
    for (const o of list) drawPlayer(o.p, now, o.d);
    const b = S.ball;
    if (b.state === 'held' && S.players[b.carrier]) {
      const c = S.players[b.carrier], d = disp.get(c.id) || c;
      let face = Math.abs(c.vx) > 0.3 ? Math.sign(c.vx) : Sim.dir(c.team);
      if (flip) face = -face;
      if (!(c.diveT > 0 || c.downT > 0)) drawBall(d.x + face * 0.35, d.y + 0.2, 1.1);
      else drawBall(d.x + face * 0.6, d.y, 0.2);
    } else if (b.state === 'air' || b.state === 'kick' || b.state === 'spot' || b.state === 'dead') {
      drawBall(b.x, b.y, b.z || 0);
      if (b.state === 'air') {
        const X = sx(b.tx), Y = sy(b.ty);
        ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.strokeRect(X - 3.5, Y - 1.5, 7, 3);
      }
    }
    // aim
    if (aim && canAim()) {
      const qb = S.players[S.ball.carrier], w = screenToWorld(aim.l);
      let dx = w.x - qb.x, dy = w.y - qb.y, m = Math.hypot(dx, dy);
      if (m > 58) { dx *= 58 / m; dy *= 58 / m; }
      const ax = sx(qb.x), ay = sy(qb.y) - 10, bx = sx(qb.x + dx), by = sy(qb.y + dy);
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      for (let i = 1; i < 14; i++) {
        const t = i / 14, h = Math.sin(Math.PI * t) * Math.min(40, m * 0.6);
        ctx.fillRect(Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t - h), 2, 2);
      }
      ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(bx + 0.5, by + 0.5, 5, 0, Math.PI * 2); ctx.stroke();
      rect(bx, by - 7, 1, 4, '#ffe14d'); rect(bx, by + 4, 1, 4, '#ffe14d'); rect(bx - 7, by, 4, 1, '#ffe14d'); rect(bx + 4, by, 4, 1, '#ffe14d');
    }
    if (S.phase === 'kick') drawKickMeter();
    drawHUD(now);
    if (S.flashT > 0 && S.flash && S.phase === 'live') text(S.flash, W / 2, 34, '#ffe14d', 8, 'center');
    if (S.phase === 'result') {
      rect(0, H / 2 - 26, W, 46, 'rgba(0,0,0,.55)');
      text(S.msg, W / 2, H / 2 - 18, S.msg.indexOf('TOUCHDOWN') >= 0 ? '#ffe14d' : '#fff', 16, 'center');
      if (S.sub) text(S.sub, W / 2, H / 2 + 4, '#9fd3ff', 8, 'center');
    }
    if (S.phase === 'presnap' && S.poss === myTeam && !S.cpu[myTeam]) text('CALL A PLAY', W / 2, H - 60, '#fff', 8, 'center');
    const h = hint();
    if (h) { rect(0, H - 12, W, 12, 'rgba(0,0,0,.55)'); text(h, W / 2, H - 10, '#fff', 8, 'center'); }
  }

  function drawAttract(now) {
    rect(0, 0, W, H, '#1a4a1f');
    for (let i = 0; i < 12; i++) rect(i * 40 - ((now / 30) % 40), 0, 20, H, '#1e5424');
  }

  // ---------- DOM sync ----------
  let uiKey = '';
  function syncUI() {
    const inGame = !!S && mode !== 'menu';
    const showCall = inGame && S.phase === 'presnap' && S.poss === myTeam && !S.cpu[myTeam];
    const opts = showCall ? Sim.options(S) : [];
    const over = inGame && S.phase === 'over';
    const key = [inGame, showCall, opts.join(), over, mode].join('|');
    if (key !== uiKey) {
      uiKey = key;
      $('playcall').classList.toggle('on', showCall);
      document.querySelectorAll('#playcall button').forEach((b) => { b.disabled = !opts.includes(b.dataset.c); });
      $('bQuit').classList.toggle('on', inGame && !over);
      if (over) {
        showScreen('over');
        $('overTitle').textContent = S.msg || 'FINAL';
        $('overScore').textContent = S.teams[0].name + ' ' + S.teams[0].score + '  -  ' + S.teams[1].score + ' ' + S.teams[1].name;
      } else if (inGame && $('over').classList.contains('on')) showScreen(null);
    }
  }

  // ---------- main loop ----------
  let last = performance.now(), acc = 0, frame = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (S && (mode === 'cpu' || mode === 'host')) {
      gatherInput();
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 8) {
        Sim.step(S, inputs, STEP);
        inputs[0].events.length = 0; inputs[1].events.length = 0;
        for (const f of S.sfx) { playSfx(f); if (mode === 'host') netFx.push(f); }
        S.sfx.length = 0;
        acc -= STEP; n++;
      }
      if (acc > STEP * 8) acc = 0;
      if (mode === 'host' && conn && conn.open && ++frame % 2 === 0) {
        const msg = { t: 's', s: snapshot() };
        if (netFx.length) { msg.fx = netFx; netFx = []; }
        send(msg);
      }
    } else if (S && mode === 'client') {
      gatherInput();
    }
    render(now, dt);
    syncUI();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  void lastSent;

  // debug / demo hook: ?demo watches CPU vs CPU
  if (qp.has('demo')) startCpu(true);
  window.__pg = { get S() { return S; }, get mode() { return mode; }, get inputs() { return inputs; }, get camX() { return camX; }, startCpu };
})();
