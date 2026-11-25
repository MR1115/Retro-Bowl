/* Pixel Gridiron — game simulation (no DOM). Runs on the host / single-player device. */
(function (root) {
  'use strict';

  const FL = 120, FW = 53.3, MID = FW / 2;
  const SPD = { QB: 6.6, RB: 7.7, WR: 8.0, OL: 4.8, DL: 5.7, LB: 7.3, CB: 7.7, S: 7.6, K: 4 };

  // Route waypoints: [yards downfield from LOS, yards toward the middle of the field]
  const WR_ROUTES = [
    { pts: [[42, 0]], cont: true },               // go
    { pts: [[3, 0], [20, 12]], cont: true },      // slant
    { pts: [[8, 0], [7, -5]], cont: false },      // out
    { pts: [[11, 0], [11, 22]], cont: true },     // dig
    { pts: [[13, 0], [10.5, 1]], cont: false },   // curl
    { pts: [[11, 0], [40, 12]], cont: true },     // post
    { pts: [[11, 0], [32, -4]], cont: true },     // corner
    { pts: [[16, 0], [13, -3]], cont: false },    // comeback
  ];
  // RB routes: second number is yards toward the middle (negative = outside)
  const RB_ROUTES = [
    { pts: [[1, -6], [3, -14]], cont: true },     // flat
    { pts: [[4, 0], [6, 1]], cont: false },       // check-down
    { pts: [[2, -8], [30, -11]], cont: true },    // wheel
    { pts: [[2, -3], [7, 6]], cont: true },       // angle
  ];

  let S = null;
  let inputs = null;

  // ---------- helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  function norm(x, y) { const m = Math.hypot(x, y); return m < 1e-6 ? { x: 0, y: 0 } : { x: x / m, y: y / m }; }
  function vec(x, y, s) { const n = norm(x, y); return { x: n.x * s, y: n.y * s }; }
  function seek(p, tx, ty, s) {
    const dx = tx - p.x, dy = ty - p.y, m = Math.hypot(dx, dy);
    if (m < 0.15) return { x: 0, y: 0 };
    const k = m < 0.6 ? (s * m) / 0.6 : s;
    return { x: (dx / m) * k, y: (dy / m) * k };
  }
  const dir = (t) => (t === 0 ? 1 : -1);
  const goalX = (t) => (t === 0 ? 110 : 10);   // goal line team t attacks
  const ownGoal = (t) => (t === 0 ? 10 : 110); // goal line team t defends
  const clampLos = (x) => clamp(x, 11, 109);
  const sfx = (n) => S.sfx.push(n);
  function flash(t) { S.flash = t; S.flashT = 1.3; }

  function setLtg() {
    const d = dir(S.poss);
    S.ltg = S.los + d * 10;
    if ((S.ltg - goalX(S.poss)) * d >= 0) S.ltg = goalX(S.poss);
  }
  function newPoss(team, yards) {
    S.poss = team; S.los = ownGoal(team) + dir(team) * yards; S.down = 1; S.ballY = MID; setLtg();
  }
  function behindLos(p) { return (p.x - S.los) * dir(S.poss) <= 0.4; }
  function fgDist() { return Math.round(Math.abs(goalX(S.poss) - S.los) + 17); }
  function options() {
    const o = ['run', 'pass', 'punt'];
    if (fgDist() <= 62) o.push('fg');
    return o;
  }

  // ---------- game flow ----------
  function newGame(cfg) {
    const first = cfg.firstPoss != null ? cfg.firstPoss : (Math.random() < 0.5 ? 0 : 1);
    S = {
      time: 0,
      teams: cfg.teams.map((t) => ({ name: String(t.name || 'TEAM').slice(0, 10).toUpperCase(), color: t.color | 0, score: 0 })),
      cpu: cfg.cpu.slice(), qlen: cfg.qlen, quarter: 1, clock: cfg.qlen, firstPoss: first,
      poss: first, los: 35, ltg: 45, down: 1, ballY: MID,
      phase: 'result', phaseT: 2.6, msg: 'KICKOFF', sub: '', next: 'snap',
      players: [], ball: { state: 'none', carrier: -1, x: 60, y: MID, z: 0 },
      ctrl: [-1, -1], ids: {}, play: null, kick: null, flash: '', flashT: 0, sfx: [], kickTeam: 0,
    };
    newPoss(first, 25);
    S.sub = S.teams[first].name + ' BALL';
    setupPlay();
    return S;
  }

  function addPlayer(P, team, role, num, x, y) {
    const p = {
      id: P.length, team, role, num, x, y: clamp(y, 1.5, FW - 1.5), vx: 0, vy: 0,
      spd: SPD[role] * rnd(0.97, 1.03), diveT: 0, downT: 0, shed: 0.6, stun: 0, imm: {},
      link: -1, route: null, mx: 0, my: 0, lag: 3,
    };
    P.push(p);
    return p;
  }

  function setupPlay() {
    const off = S.poss, def = 1 - off, d = dir(off), L = S.los, by = S.ballY;
    const P = [];
    const at = (f) => L + d * f;
    const ol = [addPlayer(P, off, 'OL', 60, at(-0.7), by), addPlayer(P, off, 'OL', 66, at(-0.7), by - 1.6), addPlayer(P, off, 'OL', 52, at(-0.7), by + 1.6)];
    const qb = addPlayer(P, off, 'QB', 12, at(-4.5), by);
    const side = Math.random() < 0.5 ? -1 : 1;
    const rb = addPlayer(P, off, 'RB', 28, at(-5), by + side * 1.8);
    const w1 = addPlayer(P, off, 'WR', 81, at(-0.8), 6), w2 = addPlayer(P, off, 'WR', 84, at(-0.8), FW - 6);
    const dl = [addPlayer(P, def, 'DL', 94, at(1.1), by), addPlayer(P, def, 'DL', 91, at(1.1), by - 2.6), addPlayer(P, def, 'DL', 97, at(1.1), by + 2.6)];
    const lb = addPlayer(P, def, 'LB', 54, at(5), by);
    const c1 = addPlayer(P, def, 'CB', 21, at(6), 6), c2 = addPlayer(P, def, 'CB', 24, at(6), FW - 6);
    const sf = addPlayer(P, def, 'S', 33, at(14), MID);
    ol.forEach((o, i) => (o.link = dl[i].id));
    c1.link = w1.id; c2.link = w2.id; w1.link = c1.id; w2.link = c2.id;
    dl.forEach((p) => (p.shed = rnd(2.0, 3.6)));
    [lb, c1, c2, sf].forEach((p) => (p.shed = rnd(0.5, 1.1)));
    [c1, c2].forEach((c) => { const w = P[c.link]; c.mx = w.x; c.my = w.y; c.lag = rnd(3.5, 6.5); });
    S.players = P;
    S.ids = { qb: qb.id, rb: rb.id, lb: lb.id, side };
    S.ball = { state: 'spot', carrier: -1, x: L, y: by, z: 0 };
    S.ctrl = [-1, -1]; S.ctrl[off] = qb.id; S.ctrl[def] = lb.id;
  }

  function setupKickPlayers(team, from) {
    const d = dir(team), P = [];
    const line = from + d * 7;
    for (let i = -2; i <= 2; i++) addPlayer(P, team, 'OL', 60 + i + 2, line - d * 0.6, MID + i * 1.5);
    addPlayer(P, team, 'K', 3, from - d * 1.5, MID - 1);
    for (let i = -2; i <= 2; i++) addPlayer(P, 1 - team, 'DL', 90 + i + 2, line + d * 1.2, MID + i * 1.6 + 0.8);
    S.players = P; S.ids = {}; S.ctrl = [-1, -1];
  }

  function presnap() { S.phase = 'presnap'; S.phaseT = 0; S.play = null; S.kick = null; setupPlay(); }

  function showResult(msg, sub, t) { S.phase = 'result'; S.phaseT = t || 2.1; S.msg = msg; S.sub = sub || ''; }

  function addScore(t, n) { S.teams[t].score += n; }

  function afterResult() {
    if (S.next === 'xp') return startKick('xp');
    if (S.next === 'over') return gameOver();
    if (checkQuarter()) return;
    presnap();
  }

  function checkQuarter() {
    if (S.clock > 0) return false;
    const q = S.quarter;
    S.next = 'snap';
    if (q === 1 || q === 3) { S.quarter++; S.clock = S.qlen; showResult('END OF Q' + q, ''); return true; }
    if (q === 2) {
      S.quarter = 3; S.clock = S.qlen; newPoss(1 - S.firstPoss, 25); setupPlay();
      showResult('HALFTIME', S.teams[S.poss].name + ' BALL', 3); return true;
    }
    if (q === 4 && S.teams[0].score === S.teams[1].score) {
      S.quarter = 5; S.clock = S.qlen; newPoss(Math.random() < 0.5 ? 0 : 1, 25); setupPlay();
      showResult('OVERTIME', 'NEXT SCORE WINS', 3); return true;
    }
    gameOver();
    return true;
  }

  function gameOver() {
    S.phase = 'over'; S.ball.state = 'none';
    const a = S.teams[0].score, b = S.teams[1].score;
    S.msg = a === b ? 'TIE GAME' : (a > b ? S.teams[0].name : S.teams[1].name) + ' WIN!';
    sfx('final');
  }

  // ---------- presnap ----------
  function cpuChoice() {
    const off = S.poss, toGoal = Math.abs(goalX(off) - S.los), togo = Math.abs(S.ltg - S.los);
    const behind = S.teams[1 - off].score - S.teams[off].score;
    const late = (S.quarter === 2 || S.quarter >= 4) && S.clock < 20;
    if (late && fgDist() <= 50 && (S.quarter === 2 || (behind >= 0 && behind <= 3))) return 'fg';
    if (S.down === 4) {
      if (S.quarter >= 4 && S.clock < 150 && behind > 3) return togo <= 3 && Math.random() < 0.5 ? 'run' : 'pass';
      if (fgDist() <= 52) return 'fg';
      if (togo <= 1.5 && toGoal < 55) return 'run';
      return 'punt';
    }
    if (togo <= 3) return Math.random() < 0.55 ? 'run' : 'pass';
    return Math.random() < 0.3 ? 'run' : 'pass';
  }

  function updPresnap(dt) {
    S.phaseT += dt;
    const off = S.poss;
    let choice = null;
    for (const e of inputs[off].events) if (e.k === 'choice') choice = e.v;
    if (S.cpu[off] && S.phaseT > 1.3) choice = cpuChoice();
    if (!choice || !options().includes(choice)) return;
    if (choice === 'punt' || choice === 'fg') startKick(choice);
    else snap(choice);
  }

  function snap(type) {
    const off = S.poss, d = dir(off);
    S.play = { type, t: 0, thrown: false, handed: false, intended: -1, int: false };
    S.phase = 'live';
    const qb = S.players[S.ids.qb];
    S.ball = { state: 'held', carrier: qb.id, lastTeam: off, x: qb.x, y: qb.y, z: 1 };
    for (const p of S.players) {
      if (p.team !== off) continue;
      if (type === 'pass' && p.role === 'WR') {
        assignRoute(p, WR_ROUTES[(Math.random() * WR_ROUTES.length) | 0], Math.sign(MID - p.y) || 1, d);
      } else if (type === 'pass' && p.role === 'RB') {
        assignRoute(p, RB_ROUTES[(Math.random() * RB_ROUTES.length) | 0], -S.ids.side, d);
      }
    }
    sfx('hike');
  }

  function assignRoute(p, def, inward, d) {
    const pts = def.pts.map(([f, dy]) => ({ x: S.los + d * f, y: clamp(p.y + inward * dy, 1.5, FW - 1.5) }));
    const a = pts.length > 1 ? pts[pts.length - 2] : { x: p.x, y: p.y };
    const z = pts[pts.length - 1];
    const n = norm(z.x - a.x, z.y - a.y);
    p.route = { pts, i: 0, cont: def.cont, dx: n.x, dy: n.y };
  }

  // ---------- live play ----------
  function canThrow(t) {
    const P = S.play;
    if (S.phase !== 'live' || !P || P.type !== 'pass' || P.thrown || S.ball.state !== 'held') return false;
    const c = S.players[S.ball.carrier];
    return !!c && c.role === 'QB' && c.team === t && behindLos(c);
  }

  function nearestTo(p, team, skipDL) {
    let best = -1, bd = 1e9;
    for (const q of S.players) {
      if (q.team !== team || q.downT > 0) continue;
      const dd = dist(q, p) + (skipDL && q.role === 'DL' ? 4 : 0);
      if (dd < bd) { bd = dd; best = q.id; }
    }
    return best;
  }

  function giveBall(id) {
    const p = S.players[id];
    S.ball.state = 'held'; S.ball.carrier = id; S.ball.lastTeam = p.team; S.ball.z = 1;
    S.ctrl[p.team] = id;
    S.ctrl[1 - p.team] = nearestTo(p, 1 - p.team, true);
  }

  function throwBall(tx, ty) {
    const qb = S.players[S.ball.carrier];
    let dx = tx - qb.x, dy = ty - qb.y, dd = Math.hypot(dx, dy);
    const MAX = 58;
    if (dd > MAX) { tx = qb.x + (dx / dd) * MAX; ty = qb.y + (dy / dd) * MAX; dd = MAX; }
    if (dd < 1) return;
    const dur = 0.3 + dd / 25;
    let best = -1, bd = 1e9;
    for (const p of S.players) {
      if (p.team !== qb.team || (p.role !== 'WR' && p.role !== 'RB')) continue;
      // how far the receiver would still be from the spot when the ball arrives
      const now = Math.hypot(p.x - tx, p.y - ty);
      const pred = Math.hypot(p.x + p.vx * dur - tx, p.y + p.vy * dur - ty);
      const e = Math.min(pred, Math.max(0, now - p.spd * dur));
      if (e < bd) { bd = e; best = p.id; }
    }
    S.play.intended = bd < 8 ? best : -1;
    S.play.thrown = true;
    S.ball = { state: 'air', carrier: -1, lastTeam: qb.team, sx: qb.x, sy: qb.y, tx, ty, t: 0, dur, h: 0.8 + dd * 0.11, x: qb.x, y: qb.y, z: 1 };
    sfx('throw');
  }

  function cpuQB() {
    const P = S.play, qb = S.players[S.ball.carrier], d = dir(S.poss);
    if (P.cpuWait === undefined) P.cpuWait = rnd(1.2, 2.3);
    let pressure = false;
    for (const q of S.players) if (q.team !== qb.team && dist(q, qb) < 2.0) pressure = true;
    if (P.t < P.cpuWait && !(pressure && P.t > 0.8)) return;
    let best = null, bs = -1e9;
    for (const r of S.players) {
      if (r.team !== qb.team || (r.role !== 'WR' && r.role !== 'RB')) continue;
      let px = r.x, py = r.y, ft = 0;
      for (let i = 0; i < 3; i++) { ft = 0.3 + Math.hypot(px - qb.x, py - qb.y) / 25; px = r.x + r.vx * ft; py = r.y + r.vy * ft; }
      py = clamp(py, 1, FW - 1);
      const dd = Math.hypot(px - qb.x, py - qb.y);
      if (dd > 56) continue;
      let open = 99;
      for (const q of S.players) {
        if (q.team === qb.team || q.role === 'DL') continue;
        open = Math.min(open, Math.hypot(q.x + q.vx * ft * 0.8 - px, q.y + q.vy * ft * 0.8 - py));
      }
      const ahead = (px - S.los) * d;
      let sc = Math.min(open, 6) * 1.3 + ahead * 0.09;
      if (open < 1.8) sc -= 6;
      if (ahead < 0) sc -= 1;
      if (sc > bs) { bs = sc; best = { px, py, open, dd }; }
    }
    if (!best) return;
    if (best.open > 2.0 || P.t > 3.6 || (pressure && P.t > 1.0)) {
      const err = best.dd * 0.025;
      throwBall(best.px + rnd(-err, err), best.py + rnd(-err, err));
    }
  }

  function startDive(p, inp) {
    if (p.diveT > 0 || p.downT > 0) return;
    const P = S.play, b = S.ball;
    const car = b.state === 'held' ? S.players[b.carrier] : null;
    if (car === p && p.role === 'QB' && P.type === 'pass' && !P.thrown && behindLos(p)) return;
    if (car === p && P.type === 'run' && !P.handed) return;
    let dx, dy;
    const has = inp && Math.hypot(inp.mx, inp.my) > 0.2;
    if (car === p) { dx = dir(p.team); dy = has ? inp.my * 0.6 : 0; }
    else if (has) { dx = inp.mx; dy = inp.my; }
    else if (car && car.team !== p.team) { dx = car.x + car.vx * 0.15 - p.x; dy = car.y + car.vy * 0.15 - p.y; }
    else if (b.state === 'air') { dx = b.tx - p.x; dy = b.ty - p.y; }
    else { dx = p.vx || dir(p.team); dy = p.vy; }
    const n = norm(dx, dy);
    p.vx = n.x * 11; p.vy = n.y * 11; p.diveT = 0.3;
    sfx('dive');
  }

  function carrierAI(p, spd) {
    const td = dir(p.team);
    let vx = td * 1.2, vy = 0;
    for (const q of S.players) {
      if (q.team === p.team || q.downT > 0) continue;
      const rx = q.x - p.x, ry = q.y - p.y, ahead = rx * td;
      if (ahead < -2) continue;
      const dd = Math.hypot(rx, ry);
      if (dd > 8) continue;
      const w = 1 / Math.max(dd * dd, 0.6);
      vy -= (Math.abs(ry) < 0.05 ? (p.id % 2 ? 1 : -1) : Math.sign(ry)) * w * 5;
      if (ahead > 0) vx -= td * w * 1.5;
    }
    if (p.y < 5) vy += (5 - p.y) * 0.25;
    if (p.y > FW - 5) vy -= (p.y - (FW - 5)) * 0.25;
    vx = td * Math.max(0.35, vx * td);
    return vec(vx, vy, spd);
  }

  function followRoute(p) {
    const R = p.route;
    if (R.i < R.pts.length) { const t = R.pts[R.i]; if (Math.hypot(t.x - p.x, t.y - p.y) < 0.7) R.i++; }
    if (R.i < R.pts.length) { const t = R.pts[R.i]; return seek(p, t.x, t.y, p.spd); }
    if (R.cont) {
      const dy = (p.y < 2 && R.dy < 0) || (p.y > FW - 2 && R.dy > 0) ? 0 : R.dy;
      return vec(R.dx || dir(p.team), dy, p.spd);
    }
    return { x: 0, y: 0 };
  }

  function ai(p, car, runner, dt) {
    const P = S.play, off = S.poss, d = dir(off), b = S.ball;
    const isOff = p.team === off;
    if (b.state === 'air') {
      if (p.id === P.intended) return seek(p, b.tx, b.ty, p.spd);
      if (!isOff && p.role !== 'DL' && Math.hypot(p.x - b.tx, p.y - b.ty) < 9) return seek(p, b.tx, b.ty, p.spd * 0.97);
    }
    if (runner) {
      if (p.team !== car.team) {
        const dd = dist(p, car), lead = Math.min(dd / p.spd, 1.2) * 0.8;
        return seek(p, car.x + car.vx * lead, car.y + car.vy * lead, p.spd * 1.04);
      }
      if (p.role === 'QB') {
        if (P.type === 'run') return seek(p, S.los - d * 5, p.y, 3);
        return { x: 0, y: 0 };
      }
      let best = null, bs = 1e9;
      for (const q of S.players) {
        if (q.team === p.team || q.downT > 0) continue;
        const s = dist(q, car) + dist(q, p) * 0.6;
        if (s < bs) { bs = s; best = q; }
      }
      return best ? seek(p, best.x, best.y, p.spd * 0.95) : { x: 0, y: 0 };
    }
    if (isOff) {
      if (p.role === 'OL') {
        const t = S.players[p.link], qb = S.players[S.ids.qb];
        if (!t || !qb) return { x: 0, y: 0 };
        const n = norm(qb.x - t.x, qb.y - t.y);
        return seek(p, t.x + n.x * 0.9, t.y + n.y * 0.9, p.spd);
      }
      if ((p.role === 'WR' || p.role === 'RB') && p.route) return followRoute(p);
      return { x: 0, y: 0 };
    }
    switch (p.role) {
      case 'DL': { const t = car || S.players[S.ids.qb]; return seek(p, t.x, t.y, p.spd); }
      case 'LB': {
        const rb = S.players[S.ids.rb], qb = S.players[S.ids.qb];
        if (P.type === 'pass' && rb.route && (rb.x - S.los) * d > 0.5) return seek(p, rb.x + d * 0.8, rb.y, p.spd);
        return seek(p, S.los + d * 4.5, qb.y, p.spd * 0.6);
      }
      case 'CB': {
        const w = S.players[p.link], k = Math.min(1, dt * p.lag);
        p.mx += (w.x - p.mx) * k; p.my += (w.y - p.my) * k;
        const cush = Math.max(1.1, 6 - P.t * 2.5);
        return seek(p, p.mx + d * cush, p.my, p.spd);
      }
      case 'S': {
        let deep = null, dv = -1e9;
        for (const q of S.players) {
          if (q.team !== off || (q.role !== 'WR' && q.role !== 'RB')) continue;
          const a = (q.x - S.los) * d;
          if (a > dv) { dv = a; deep = q; }
        }
        return seek(p, S.los + d * Math.max(13, dv + 5), deep ? (MID + deep.y) / 2 : MID, p.spd * 0.9);
      }
    }
    return { x: 0, y: 0 };
  }

  function desired(p, car, runner, dt) {
    const P = S.play, d = dir(S.poss);
    const human = !S.cpu[p.team] && S.ctrl[p.team] === p.id;
    const inp = inputs[p.team];
    const has = human && Math.hypot(inp.mx, inp.my) > 0.2;
    const spd = p.spd + (human ? 0.3 : 0);
    if (car === p) {
      const td = dir(p.team);
      if (P.type === 'run' && !P.handed) return seek(p, S.los - d * 5, p.y, 3);
      if (!runner) {
        if (has) return vec(inp.mx, inp.my, spd * 0.85);
        return seek(p, S.los - d * 6.5, p.y, 4.2);
      }
      if (human) {
        if (has) return vec(Math.abs(inp.mx) > 0.2 ? inp.mx : td, inp.my, spd * 0.95);
        return vec(td, 0, spd * 0.95);
      }
      return carrierAI(p, spd * 0.92);
    }
    if (has) return vec(inp.mx, inp.my, spd);
    return ai(p, car, runner, dt);
  }

  function engaged(p, car, runner) {
    if (p.shed <= 0) return false;
    const bteam = car ? car.team : S.poss;
    if (p.team === bteam) return false;
    for (const q of S.players) {
      if (q.team !== bteam || q === car || q.downT > 0 || q.diveT > 0) continue;
      if (!(q.role === 'OL' || (runner && q.role !== 'QB'))) continue;
      if (Math.abs(q.x - p.x) < 0.95 && Math.abs(q.y - p.y) < 0.95) return true;
    }
    return false;
  }

  function separate(car) {
    const P = S.players;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      if (a === car || a.downT > 0 || a.diveT > 0) continue;
      for (let j = i + 1; j < P.length; j++) {
        const b = P[j];
        if (b === car || b.team === a.team || b.downT > 0 || b.diveT > 0) continue;
        const dx = b.x - a.x, dy = b.y - a.y, m = Math.hypot(dx, dy);
        if (m < 0.65 && m > 1e-4) {
          const push = (0.65 - m) / 2;
          a.x -= (dx / m) * push; a.y -= (dy / m) * push;
          b.x += (dx / m) * push; b.y += (dy / m) * push;
        }
      }
    }
  }

  function updLive(dt) {
    const P = S.play, off = S.poss;
    P.t += dt;
    for (let t = 0; t < 2; t++) {
      for (const ev of inputs[t].events) {
        if (ev.k === 'throw' && canThrow(t) && isNum(ev.x) && isNum(ev.y)) throwBall(ev.x, ev.y);
        else if (ev.k === 'dive' && !S.cpu[t]) { const p = S.players[S.ctrl[t]]; if (p) startDive(p, inputs[t]); }
      }
    }
    if (P.type === 'run' && !P.handed && P.t > 0.4 && S.ball.state === 'held') { P.handed = true; giveBall(S.ids.rb); }
    if (S.cpu[off] && canThrow(off)) cpuQB();
    const b = S.ball;
    const car = b.state === 'held' ? S.players[b.carrier] : null;
    const runner = !!car && !(car.role === 'QB' && P.type === 'pass' && !P.thrown && behindLos(car));

    for (const p of S.players) {
      for (const k in p.imm) { p.imm[k] -= dt; if (p.imm[k] <= 0) delete p.imm[k]; }
      if (p.stun > 0) p.stun -= dt;
      if (p.diveT > 0) {
        p.diveT -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.diveT <= 0) { p.downT = 0.7; if (p === car) p.diveDone = true; }
        continue;
      }
      if (p.downT > 0) { p.downT -= dt; p.vx *= 0.85; p.vy *= 0.85; p.x += p.vx * dt; p.y += p.vy * dt; continue; }
      const v = desired(p, car, runner, dt);
      if (engaged(p, car, runner)) { p.shed -= dt; v.x *= 0.15; v.y *= 0.15; }
      if (p.stun > 0) { v.x *= 0.5; v.y *= 0.5; }
      const a = Math.min(1, dt * 7.5);
      p.vx += (v.x - p.vx) * a; p.vy += (v.y - p.vy) * a;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p !== car) { p.y = clamp(p.y, -1, FW + 1); p.x = clamp(p.x, -1, FL + 1); }
      const humanCtl = !S.cpu[p.team] && S.ctrl[p.team] === p.id;
      if (runner && car !== p && car.team !== p.team && !humanCtl && dist(p, car) < 1.8 && Math.random() < dt * 1.3) startDive(p, null);
    }
    separate(car);

    if (b.state === 'air') {
      b.t += dt / b.dur;
      const a = Math.min(1, b.t);
      b.x = b.sx + (b.tx - b.sx) * a; b.y = b.sy + (b.ty - b.sy) * a; b.z = 1 + b.h * 4 * a * (1 - a);
      if (b.t >= 1) resolveCatch();
    } else if (b.state === 'held') {
      const c = S.players[b.carrier];
      b.x = c.x; b.y = c.y; b.z = 1;
      checkCarrier(c);
    }
  }

  function checkCarrier(c) {
    const td = dir(c.team);
    if ((td > 0 && c.x >= 110) || (td < 0 && c.x <= 10)) return endPlay('td', c.x, c.team, c.y);
    if (c.y < 0 || c.y > FW) return endPlay('oob', c.x, c.team, c.y);
    if (c.x < 0 || c.x > FL) return endPlay('tackle', c.x, c.team, c.y);
    if (c.diveDone) return endPlay('tackle', c.x, c.team, c.y);
    for (const q of S.players) {
      if (q.team === c.team || q.downT > 0) continue;
      const r = q.diveT > 0 ? 1.2 : 0.9;
      if (Math.abs(q.x - c.x) > r || Math.abs(q.y - c.y) > r || dist(q, c) > r) continue;
      if (c.imm[q.id]) continue;
      let brk = q.diveT > 0 ? 0.06 : q.role === 'DL' ? 0.08 : 0.15;
      if (c.role === 'QB') brk *= 0.6;
      if (c.diveT > 0) brk = 0;
      if (Math.random() < brk) {
        c.imm[q.id] = 0.8; c.stun = 0.35; q.downT = 0.5; q.diveT = 0;
        sfx('juke'); flash('BROKE A TACKLE!');
        continue;
      }
      const sack = c.role === 'QB' && S.play.type === 'pass' && !S.play.thrown;
      return endPlay(sack ? 'sack' : 'tackle', c.x, c.team, c.y);
    }
  }

  function resolveCatch() {
    const b = S.ball, off = b.lastTeam, T = { x: b.tx, y: b.ty };
    if (T.y < 0 || T.y > FW || T.x < 0 || T.x > FL) return endPlay('inc');
    let o = null, od = 1e9, df = null, ddf = 1e9;
    for (const p of S.players) {
      if (p.downT > 0 && p.diveT <= 0) continue;
      const e = dist(p, T);
      if (p.team === off) { if ((p.role === 'WR' || p.role === 'RB') && e < od) { od = e; o = p; } }
      else if (e < ddf) { ddf = e; df = p; }
    }
    const dr = df && df.diveT > 0 ? 1.7 : 1.3;
    if (df && ddf < dr && (ddf < od - 0.2 || od > 1.7)) {
      if (Math.random() < (df.diveT > 0 ? 0.55 : 0.4)) {
        S.play.int = true; df.diveT = 0; df.downT = 0;
        giveBall(df.id); flash('INTERCEPTED!'); sfx('int');
        return;
      }
      flash('BROKEN UP!');
      return endPlay('inc');
    }
    if (o && od < 1.7) {
      let pc = 0.97;
      if (df) pc -= clamp((3.2 - ddf) * 0.26, 0, 0.7);
      if (Math.random() < pc) { giveBall(o.id); sfx('catch'); return; }
      flash('DROPPED!');
    }
    endPlay('inc');
  }

  function yardText() {
    const y = Math.round((S.los - ownGoal(S.poss)) * dir(S.poss));
    if (y === 50) return 'MIDFIELD';
    return y < 50 ? 'OWN ' + y : 'OPP ' + (100 - y);
  }
  function downText() {
    const ord = ['', '1ST', '2ND', '3RD', '4TH'][Math.min(4, S.down)] || '4TH';
    const goal = S.ltg === goalX(S.poss);
    return ord + ' & ' + (goal ? 'GOAL' : Math.max(1, Math.round(Math.abs(S.ltg - S.los))));
  }

  function endPlay(kind, x, team, y) {
    if (S.phase !== 'live') return;
    const P = S.play, off = S.poss, d = dir(off);
    S.ball.state = 'dead';
    sfx(kind === 'td' ? 'td' : 'whistle');
    let runoff = 4, msg = '', sub = '';
    if (kind === 'tackle' || kind === 'sack' || kind === 'oob') {
      const td = dir(team);
      if ((td > 0 && x <= 10) || (td < 0 && x >= 110)) kind = team === off ? 'safety' : 'touchback';
    }
    S.next = 'snap';
    if (kind === 'td') {
      addScore(team, 6); msg = 'TOUCHDOWN!'; sub = S.teams[team].name;
      S.kickTeam = team; S.next = S.quarter >= 5 ? 'over' : 'xp'; runoff = 0;
    } else if (kind === 'safety') {
      addScore(1 - team, 2); msg = 'SAFETY!'; sub = '+2 ' + S.teams[1 - team].name;
      newPoss(1 - team, 25); if (S.quarter >= 5) S.next = 'over'; runoff = 0;
    } else if (kind === 'touchback') {
      msg = 'TOUCHBACK'; newPoss(team, 20); sub = S.teams[team].name + ' BALL';
    } else if (kind === 'inc') {
      msg = 'INCOMPLETE'; S.down++;
    } else {
      runoff = kind === 'oob' ? 4 : 20;
      if (isNum(y)) S.ballY = clamp(y, 20, FW - 20);
      if (team !== off) {
        msg = P.int ? 'INTERCEPTION' : 'TURNOVER';
        S.poss = team; S.los = clampLos(x); S.down = 1; setLtg();
        sub = S.teams[team].name + ' BALL';
      } else {
        const gain = Math.round((x - S.los) * d);
        msg = kind === 'sack' ? 'SACKED!' : kind === 'oob' ? 'OUT OF BOUNDS' : 'TACKLED';
        sub = gain > 0 ? 'GAIN OF ' + gain : gain < 0 ? 'LOSS OF ' + -gain : 'NO GAIN';
        if ((x - S.ltg) * d >= 0) { S.los = clampLos(x); S.down = 1; setLtg(); msg = 'FIRST DOWN!'; sfx('first'); }
        else { S.los = clampLos(x); S.down++; }
      }
    }
    if (S.next === 'snap' && S.down > 4) {
      msg = 'TURNOVER ON DOWNS'; S.poss = 1 - S.poss; S.down = 1; setLtg();
      sub = S.teams[S.poss].name + ' BALL';
    }
    S.clock = Math.max(0, S.clock - (P.t + runoff));
    showResult(msg, sub);
  }

  // ---------- kicking ----------
  function startKick(type) {
    const team = type === 'xp' ? S.kickTeam : S.poss, d = dir(team);
    let from, dist;
    if (type === 'xp') { from = goalX(team) - d * 15; dist = 33; }
    else { from = S.los - d * 7; dist = fgDist(); }
    const win = type === 'punt' ? 0 : clamp(0.62 - (dist - 20) * 0.011, 0.12, 0.62);
    S.kick = { type, team, dist, win, from, t: 0, n: 0, done: false, good: false, anim: 0, sp: type === 'punt' ? 3.2 : 2.6 + dist * 0.035, tx: 0, ty: MID, h: 9, kickLos: S.los };
    S.phase = 'kick'; S.phaseT = 0; S.play = null;
    setupKickPlayers(team, from);
    S.ball = { state: 'kick', carrier: -1, x: from, y: MID, z: 0.3 };
  }

  function resolveKick(n) {
    const K = S.kick, d = dir(K.team);
    K.done = true; K.n = n;
    if (K.type === 'punt') {
      const power = 1 - Math.abs(n);
      const len = Math.round(30 + 22 * power);
      K.tx = K.kickLos + d * len; K.ty = clamp(MID + n * 10, 3, FW - 3); K.len = len; K.h = 14;
    } else {
      K.good = Math.abs(n) < K.win;
      K.tx = goalX(K.team) + d * 10;
      K.ty = MID + (K.good ? (n / K.win) * 2.4 : Math.sign(n || 1) * (3.6 + (Math.abs(n) - K.win) * 8));
      K.h = 9;
    }
    K.dur = 1.4;
    sfx('kick');
  }

  function updKick(dt) {
    const K = S.kick;
    if (!K.done) {
      K.t += dt;
      K.n = Math.sin(K.t * K.sp);
      if (S.cpu[K.team]) {
        if (K.cpuT === undefined) K.cpuT = rnd(1.0, 2.0);
        if (K.t > K.cpuT) {
          if (K.type === 'punt') resolveKick(rnd(-0.5, 0.5));
          else {
            const good = Math.random() < clamp(K.win * 1.55, 0.3, 0.97);
            resolveKick(good ? rnd(-K.win * 0.85, K.win * 0.85) : (Math.random() < 0.5 ? -1 : 1) * rnd(K.win * 1.1, Math.min(1, K.win + 0.35)));
          }
        }
      } else if (K.t > 0.3 && inputs[K.team].events.some((e) => e.k === 'tap' || e.k === 'dive')) {
        resolveKick(K.n);
      }
      return;
    }
    K.anim += dt / K.dur;
    const a = Math.min(1, K.anim);
    S.ball.x = K.from + (K.tx - K.from) * a; S.ball.y = MID + (K.ty - MID) * a; S.ball.z = 0.3 + K.h * 4 * a * (1 - a);
    if (K.anim >= 1.15) finishKick();
  }

  function finishKick() {
    const K = S.kick, t = K.team, d = dir(t);
    S.next = 'snap';
    if (K.type === 'punt') {
      const land = K.tx;
      if ((d > 0 && land >= 110) || (d < 0 && land <= 10)) { newPoss(1 - t, 20); showResult('PUNT ' + K.len + ' YDS', 'TOUCHBACK'); }
      else { S.poss = 1 - t; S.los = clampLos(land); S.down = 1; S.ballY = MID; setLtg(); showResult('PUNT ' + K.len + ' YDS', S.teams[1 - t].name + ' BALL'); }
      S.clock = Math.max(0, S.clock - 8);
    } else if (K.type === 'fg') {
      if (K.good) { addScore(t, 3); sfx('good'); showResult("IT'S GOOD!", K.dist + ' YD FIELD GOAL'); newPoss(1 - t, 25); if (S.quarter >= 5) S.next = 'over'; }
      else { sfx('bad'); showResult('NO GOOD!', 'MISSED ' + K.dist + ' YD FG'); S.poss = 1 - t; S.los = clampLos(K.from); S.down = 1; S.ballY = MID; setLtg(); }
      S.clock = Math.max(0, S.clock - 6);
    } else {
      if (K.good) { addScore(t, 1); sfx('good'); showResult('EXTRA POINT', 'GOOD'); }
      else { sfx('bad'); showResult('EXTRA POINT', 'NO GOOD'); }
      newPoss(1 - t, 25);
    }
  }

  function coast(dt) {
    for (const p of S.players) {
      p.vx *= 0.9; p.vy *= 0.9; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.downT > 0) p.downT -= dt;
      if (p.diveT > 0) p.diveT -= dt;
    }
  }

  function update(dt) {
    S.time += dt;
    if (S.flashT > 0) S.flashT -= dt;
    switch (S.phase) {
      case 'presnap': updPresnap(dt); break;
      case 'live': updLive(dt); break;
      case 'kick': updKick(dt); break;
      case 'result': coast(dt); S.phaseT -= dt; if (S.phaseT <= 0) afterResult(); break;
    }
  }

  function step(state, inps, dt) { S = state; inputs = inps; update(dt); }

  root.PGSim = {
    FL, FW, MID, newGame, step, dir, goalX, ownGoal,
    canThrow: (s, t) => { S = s; return canThrow(t); },
    options: (s) => { S = s; return options(); },
    yardText: (s) => { S = s; return yardText(); },
    downText: (s) => { S = s; return downText(); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
