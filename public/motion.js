// Slow, floaty motion for the whole page (from the Desk site): a jelly tank lit by sunlight
// from above instead of blue tank light, gliding scroll,
// glow that trails the pointer like a balloon on a string, and things that settle into place.
// Everything stops for people who turn on reduced motion.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lerp = (a, b, k) => a + (b - a) * k;

// ------------------------------------------------------------------ gliding scroll

if (!reduced && window.Lenis) {
  const lenis = new window.Lenis({
    duration: 1.7,
    easing: (t) => 1 - Math.pow(1 - t, 4),
    wheelMultiplier: 0.75,
    touchMultiplier: 1.2,
  });
  const loop = (t) => { lenis.raf(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.__lenis = lenis;
}

// ------------------------------------------------------------------ glow that trails the pointer

const followers = new Set();
export function glowTo(cell, x, y) {
  if (reduced) {
    cell.style.setProperty('--mx', x + 'px');
    cell.style.setProperty('--my', y + 'px');
    return;
  }
  if (cell._gx === undefined) { cell._gx = x; cell._gy = y; }
  cell._tx = x; cell._ty = y;
  followers.add(cell);
}
window.__glowTo = glowTo;

// ------------------------------------------------------------------ the tank

const canvas = document.createElement('canvas');
canvas.className = 'tank';
canvas.setAttribute('aria-hidden', 'true');
document.body.prepend(canvas);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingQuality = 'high';
let W = 0, H = 0, DPR = 1;

function size() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingQuality = 'high';
}
size();
addEventListener('resize', size);

const css = getComputedStyle(document.documentElement);
const tankA = css.getPropertyValue('--tank-a').trim() || '24,170,172';
const tankB = css.getPropertyValue('--tank-b').trim() || '28,86,156';
const mote = css.getPropertyValue('--mote').trim() || '205,242,246';
const rand = (a, b) => a + Math.random() * (b - a);

// Light through the water: two huge soft patches drifting on minute-long loops.
const haze = [0, 1].map((i) => ({
  ax: i ? 0.78 : 0.2, ay: i ? 0.25 : 0.7, rx: 0.12, ry: 0.1, px: rand(70, 100), py: rand(80, 120),
  ph: rand(0, 6.3), r: rand(380, 520), a: 0.08, hue: i ? tankA : tankB,
}));

// Moon jellies lit electric blue, like an aquarium tank. The bell is redrawn every frame so
// it can breathe: it squeezes a little unevenly, a ripple runs from the top to the edge, the
// rim flutters, and it is seen slightly from below so the edge reads as an oval that tilts as
// the jelly turns. The four rings ride round with it. Tentacles trail behind every move.
// Everything is kept soft and slow on purpose: subtle, not showy.
// Sunlit instead of electric blue: gold bells with pale cream edges.
// Sunlit gold by default. A scan verdict tints them (deep red for red flags, sea green for no known
// red flags), set from the mood code further down.
const J_BASE = { JB: [255, 170, 30], JL: [255, 210, 120], JW: [255, 232, 180], WH: [255, 250, 236] };
let JB = '255,170,30', JL = '255,210,120', JW = '255,232,180', WH = '255,250,236';
const TAU = Math.PI * 2;

// A soft halo, repainted only when the jellies' colour changes.
const halo = document.createElement('canvas');
function paintHalo() {
  const S = 256, c = halo;
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, `rgba(${JB},0.5)`);
  rg.addColorStop(0.45, `rgba(${JB},0.2)`);
  rg.addColorStop(1, `rgba(${JB},0)`);
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
}
paintHalo();

const JELLY_COUNT = W < 600 ? 3 : 5;
const DEPTHS = [0.95, 0.7, 0.48, 0.28, 0.12];
const jellies = Array.from({ length: JELLY_COUNT }, (_, i) => newJelly(true, DEPTHS[i]));
window.__jellies = jellies;
function newJelly(anywhere, depth) {
  const z = depth ?? rand(0, 1); // 1 = close and sharp, 0 = far and out of focus
  // Far jellies are drawn small and scaled up, which blurs them like a camera's focus.
  // Near ones are drawn at the screen's real pixel density so they stay sharp on retina screens.
  const px = Math.min(2, window.devicePixelRatio || 1) * (W < 600 ? 0.7 : 1);
  const S = z > 0.66 ? Math.round(Math.min(860, 380 * px)) : z > 0.33 ? Math.round(170 * Math.max(1, px * 0.8)) : 70;
  const off = document.createElement('canvas');
  off.width = off.height = S;
  const bloom = document.createElement('canvas');
  bloom.width = bloom.height = Math.max(16, Math.round(S / 7));
  return {
    x: (z > 0.66 ? rand(0.66, 0.9) : rand(0.05, 0.95)) * W, y: anywhere ? rand(0.15, 1.1) * H : H + 300,
    z, size: (230 + 260 * z) * (W < 600 ? 0.6 : 1),
    tilt: rand(-0.5, 0.5), turn: rand(0, 6.3), yaw: rand(0, TAU), yawV: rand(-0.06, 0.06),
    pitch: rand(0.28, 0.5), pitchPh: rand(0, 6.3),
    v: rand(3, 6), beat: rand(7, 11), ph: rand(0, 10), a: 0.22 + 0.3 * z,
    vx: 0, vy: 0, goal: null, gvx: 0, gvy: 0, cool: 0, off, og: Object.assign(off.getContext('2d'), { imageSmoothingQuality: 'high' }), S, hist: [], f: 0, fv: 0,
    bloom, bg: bloom.getContext('2d'),
    tent: Array.from({ length: 30 }, () => ({ u: rand(0.02, 0.98), len: rand(0.5, 1.2), ph: rand(0, 6.3) })),
  };
}
const smooth = (x) => x * x * (3 - 2 * x);

// Where the words are, so jellies can find open water. Re-measured as the page scrolls.
const TEXT_SEL = 'h1, h2, h3, p, li, label, .gf-cell, .actions, .pane, .verdict, .summary, .drift, .brand, .toplink, .eyebrow, .row, .gf-outs, .res-actions, #trace';
let textRects = [], rectsAt = 0;
function measureText(now) {
  if (now - rectsAt < 350) return;
  rectsAt = now;
  textRects = [];
  for (const el of document.querySelectorAll(TEXT_SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > -100 && r.top < H + 100) textRects.push(r);
  }
}
addEventListener('scroll', () => { rectsAt = 0; }, { passive: true });
function textOverlap(x, y, rad) {
  let a = 0;
  for (const r of textRects) {
    const w = Math.min(x + rad, r.right) - Math.max(x - rad, r.left);
    const h = Math.min(y + rad, r.bottom) - Math.max(y - rad, r.top);
    if (w > 0 && h > 0) a += w * h;
  }
  return a / (4 * rad * rad);
}
// Try spots around the jelly, mostly away from the pointer, and keep the one with the least text
// under it; closer spots win ties so the move stays short and natural.
function openSpot(j, px, py) {
  measureText(performance.now());
  const rad = j.size * 0.32, m = rad * 0.8;
  const away = Math.atan2(j.y - py, j.x - px);
  let best = null, bestScore = Infinity;
  for (let i = 0; i < 28; i++) {
    const ang = away + (Math.random() - 0.5) * Math.PI * 1.3;
    const dist = 150 + Math.random() * 260;
    const x = Math.max(m, Math.min(W - m, j.x + Math.cos(ang) * dist));
    const y = Math.max(m, Math.min(H - m, j.y + Math.sin(ang) * dist));
    const fromPtr = Math.hypot(x - px, y - py);
    if (fromPtr < 200) continue;
    const score = textOverlap(x, y, rad) * 4 + Math.hypot(x - j.x, y - j.y) / 900;
    if (score < bestScore) { bestScore = score; best = { x, y }; }
  }
  return best;
}

function drawJelly(j, t, dt) {
  // --- swim: a gentle squeeze, then a long slow release
  const k = ((t + j.ph) % j.beat) / j.beat;
  const c = k < 0.24 ? smooth(k / 0.24) : 1 - smooth((k - 0.24) / 0.76);
  const thrust = k < 0.35 ? (1 - k / 0.35) * 12 * (0.4 + j.z) : 0;
  j.tilt += Math.sin(t * 0.05 + j.turn) * 0.03 * dt;
  j.tilt = Math.max(-0.7, Math.min(0.7, j.tilt));
  j.yaw += j.yawV * dt;
  const pitch = j.pitch + Math.sin(t * 0.07 + j.pitchPh) * 0.08;
  // Its own slow upward swim, eased right down while it's gliding somewhere.
  const sp = (j.v * (0.4 + j.z) + thrust) * dt * (j.goal ? 0.25 : 1);
  j.x += Math.sin(j.tilt) * sp;
  j.y -= Math.cos(j.tilt) * sp;
  // When the pointer comes close, it doesn't get shoved away: it picks a nearby patch of open
  // water with no text in it and glides over there, turning to face the way it's going.
  const dx = j.x - mouseX, dy = j.y - mouseY, d = Math.hypot(dx, dy);
  j.cool = Math.max(0, (j.cool || 0) - dt);
  if (d < 220 && !j.cool && (!j.goal || Math.hypot(j.goal.x - mouseX, j.goal.y - mouseY) < 200)) {
    j.goal = openSpot(j, mouseX, mouseY);
    j.cool = 1.2;
  }
  if (j.goal) {
    const gx = j.goal.x - j.x, gy = j.goal.y - j.y, gd = Math.hypot(gx, gy);
    // a soft spring with plenty of drag: it eases out, drifts, and settles over a few seconds
    j.gvx = (j.gvx || 0) + (gx * 0.9 - (j.gvx || 0) * 1.7) * dt;
    j.gvy = (j.gvy || 0) + (gy * 0.9 - (j.gvy || 0) * 1.7) * dt;
    const s2 = Math.hypot(j.gvx, j.gvy), cap = 70 + 50 * j.z;
    if (s2 > cap) { j.gvx *= cap / s2; j.gvy *= cap / s2; }
    // lean into the direction of travel, the way a jelly steers with its bell
    const face = Math.max(-0.7, Math.min(0.7, Math.atan2(j.gvx, -j.gvy) * 0.6));
    j.tilt += (face - j.tilt) * Math.min(1, 0.9 * dt) * Math.min(1, s2 / 30);
    if (gd < 14 && s2 < 6) { j.goal = null; }
  } else if (j.gvx || j.gvy) {
    j.gvx *= 1 - Math.min(1, 1.5 * dt); j.gvy *= 1 - Math.min(1, 1.5 * dt);
    if (Math.abs(j.gvx) + Math.abs(j.gvy) < 0.5) j.gvx = j.gvy = 0;
  }
  j.x += (j.gvx || 0) * dt; j.y += (j.gvy || 0) * dt;
  // The big close one keeps to the right, out from behind the text.
  if (j.z > 0.66 && W >= 600) {
    const lane = 0.64 * W;
    if (j.x < lane) j.vx += (lane - j.x) * 0.02 * dt;
    j.tilt += (j.x < lane ? 0.02 : 0) * dt;
  }
  j.vx *= 0.97; j.vy *= 0.97; j.x += j.vx; j.y += j.vy;
  if (j.y < -j.size * 0.7 || j.x < -j.size * 0.7 || j.x > W + j.size * 0.7) { Object.assign(j, newJelly(false, j.z)); return; }

  // --- shape of the bell this frame (local units, 1 = resting rim radius)
  // The bell is soft: relaxed it opens into a wide saucer, squeezed it bunches into a tall
  // dome. One side goes a moment before the other, so the shape is never symmetrical.
  const cyc = (kk) => { kk = ((kk % 1) + 1) % 1; return kk < 0.24 ? smooth(kk / 0.24) : 1 - smooth((kk - 0.24) / 0.76); };
  const lead = 0.04 + 0.03 * Math.sin(j.ph);
  const cL = cyc(k + lead), cR = cyc(k - lead);
  const cM = (cL + cR) / 2;
  const WrL = 1.12 - 0.34 * cL, WrR = 1.12 - 0.34 * cR;
  const Wr = (WrL + WrR) / 2;
  const Hd = 0.42 + 0.4 * cM;
  const ry = Wr * pitch;
  // The edge flares out as it relaxes and curls in as it squeezes, with a little overshoot.
  j.fv += ((0.25 - 0.9 * cM) - j.f) * 16 * dt - j.fv * 3.2 * dt;
  j.f += j.fv * dt;
  // Slow, never-repeating softness in the outline.
  const soft = (sN, sd) =>
    0.045 * Math.sin(sN * 3 * Math.PI + t * 0.55 + sd * 1.3 + j.ph) +
    0.025 * Math.sin(sN * 7 + t * 1.1 - sd * 0.9 + j.ph * 2) +
    0.03 * Math.sin(sN * 5 - t * 1.4 - k * TAU) * sN;
  const pt = (sN, sd) => {
    const Wsd = sd < 0 ? WrL : WrR;
    let x = Wsd * Math.pow(Math.sin(sN * Math.PI / 2), 0.7) * (1 + soft(sN, sd));
    let y = -Hd * (1 - Math.pow(sN, 1.7));
    if (sN > 0.68) { const e = (sN - 0.68) / 0.32; x += j.f * e * e * 0.16 * Wsd; y -= j.f * e * e * 0.07; }
    return [sd * x, y];
  };

  // remember where we were, so the tentacles can trail
  j.hist.unshift({ x: j.x, y: j.y, tilt: j.tilt, Wr, ry });
  if (j.hist.length > 48) j.hist.pop();

  const m = j.size * 0.3;               // world px per local unit
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = j.a;

  // halo
  ctx.save();
  ctx.translate(j.x, j.y - Hd * m * 0.5);
  ctx.drawImage(halo, -j.size * 0.9, -j.size * 0.75, j.size * 1.8, j.size * 1.5);
  ctx.restore();

  // tentacles and arms: ghostly white wisps. Each is drawn twice, a wide faint glow and a
  // fine bright core, and fades out toward the tip. Each segment follows where the rim was
  // a moment ago, so they trail and drift behind every move.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const wisp = (pts, glowW, coreW, glowA, coreA) => {
    const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1];
    // One gradient, two passes: the glow pass just uses lower alpha.
    const gr = ctx.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, `rgba(${WH},1)`);
    gr.addColorStop(0.55, `rgba(${JW},0.6)`);
    gr.addColorStop(1, `rgba(${JL},0)`);
    const keep = ctx.globalAlpha;
    for (const [w, a] of (glowW ? [[glowW, glowA], [coreW, coreA]] : [[coreW, coreA]])) {
      ctx.globalAlpha = keep * a;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let i = 1; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
      }
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = gr;
      ctx.lineWidth = w;
      ctx.stroke();
    }
    ctx.globalAlpha = keep;
  };
  const toWorld = (hp, lx, ly) => {
    const cs = Math.cos(hp.tilt), sn = Math.sin(hp.tilt);
    return [hp.x + (lx * cs - ly * sn) * m, hp.y + (lx * sn + ly * cs) * m];
  };
  const far = j.z < 0.33;
  for (let ti = 0; ti < j.tent.length; ti += far ? 2 : 1) {
    const tn = j.tent[ti];
    const th = tn.u * Math.PI;
    const pts = [];
    const segs = 12;
    for (let sgi = 0; sgi <= segs; sgi++) {
      const hp = j.hist[Math.min(j.hist.length - 1, sgi * 3)];
      const sw = Math.sin(t * 0.7 + tn.ph + sgi * 0.55) * 0.014 * sgi;
      pts.push(toWorld(hp, Math.cos(th) * hp.Wr * 0.96 + sw, Math.sin(th) * hp.ry + (sgi / segs) * tn.len * 1.3));
    }
    wisp(pts, far ? 0 : 2.6 + 2 * j.z, 0.6 + 0.5 * j.z, 0.035 + 0.03 * j.z, 0.1 + 0.12 * j.z);
  }
  for (let a = 0; a < 4; a++) {
    const pts = [];
    for (let sgi = 0; sgi <= 14; sgi++) {
      const hp = j.hist[Math.min(j.hist.length - 1, sgi * 3)];
      const lx = (a - 1.5) * 0.08 + Math.sin(t * 0.5 + a * 1.9 + sgi * 0.4) * 0.03 * sgi / 3;
      pts.push(toWorld(hp, lx, 0.04 + sgi * 0.1));
    }
    wisp(pts, (14 + 10 * j.z) * (j.size / 400), (3 + 2 * j.z) * (j.size / 400), 0.03 + 0.03 * j.z, 0.08 + 0.08 * j.z);
  }

  // --- the bell, drawn into a small canvas then scaled up (soft, and blurrier when far)
  const g = j.og, S = j.S, u = S * 0.3, ox = S / 2, oy = S * 0.62;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  const outline = () => {
    const P = [];
    for (let i = 0; i <= 30; i++) P.push(pt(1 - i / 30, -1));
    for (let i = 1; i <= 30; i++) P.push(pt(i / 30, 1));
    // front of the rim, right to left, fluttering
    const [rxR, ryR] = pt(1, 1), [rxL] = pt(1, -1);
    for (let i = 1; i < 40; i++) {
      const th = (i / 40) * Math.PI;
      const half = rxR + (-rxL - rxR) * (i / 40);
      const fl = 1 + 0.035 * Math.sin(th * 12 + t * 1.1) + 0.03 * Math.sin(t * 0.7 + th * 3 + j.ph);
      P.push([Math.cos(th) * half * fl, ryR + Math.sin(th) * ry * fl]);
    }
    g.beginPath();
    const X = (p) => ox + p[0] * u, Y = (p) => oy + p[1] * u;
    g.moveTo((X(P[0]) + X(P[1])) / 2, (Y(P[0]) + Y(P[1])) / 2);
    for (let i = 1; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      g.quadraticCurveTo(X(a), Y(a), (X(a) + X(b)) / 2, (Y(a) + Y(b)) / 2);
    }
    g.closePath();
  };
  outline();
  const rg = g.createRadialGradient(ox, oy - Hd * u * 0.45, u * 0.05, ox, oy - Hd * u * 0.3, u * 1.12);
  rg.addColorStop(0, `rgba(${WH},${0.1 + 0.04 * c})`);
  rg.addColorStop(0.45, `rgba(${JL},0.16)`);
  rg.addColorStop(0.75, `rgba(${JB},0.26)`);
  rg.addColorStop(0.92, `rgba(${JW},0.55)`);
  rg.addColorStop(1, `rgba(${WH},0.9)`);
  g.fillStyle = rg;
  g.fill();
  g.lineWidth = Math.max(1, u * 0.05);
  g.strokeStyle = `rgba(${WH},0.16)`;
  g.stroke();
  g.lineWidth = Math.max(1, u * 0.018);
  g.strokeStyle = `rgba(${WH},0.5)`;
  g.stroke();
  // detail inside the bell, clipped to it
  g.save();
  g.clip();
  // milky haze under the dome
  const mh = g.createRadialGradient(ox, oy - Hd * u * 0.7, 0, ox, oy - Hd * u * 0.5, Wr * u * 0.8);
  mh.addColorStop(0, `rgba(${WH},0.14)`);
  mh.addColorStop(1, `rgba(${WH},0)`);
  g.fillStyle = mh;
  g.fillRect(0, 0, S, S);
  // soft highlight where light catches the top of the dome
  g.beginPath();
  g.ellipse(ox - Wr * u * 0.3, oy - Hd * u * 0.78, Wr * u * 0.32, Hd * u * 0.16, -0.35, 0, TAU);
  const hl = g.createRadialGradient(ox - Wr * u * 0.3, oy - Hd * u * 0.78, 0, ox - Wr * u * 0.3, oy - Hd * u * 0.78, Wr * u * 0.32);
  hl.addColorStop(0, `rgba(${WH},0.22)`);
  hl.addColorStop(1, `rgba(${WH},0)`);
  g.fillStyle = hl;
  g.fill();
  // radial canals: fine lines from the middle out to the rim, turning with the jelly
  const hubX = ox, hubY = oy - Hd * u * 0.55;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + j.yaw;
    const ex = ox + Math.cos(a) * Wr * u * 0.97, ey = oy + Math.sin(a) * ry * u * 0.97;
    const front = Math.sin(a) > 0;
    g.beginPath();
    g.moveTo(hubX + Math.cos(a) * Wr * u * 0.12, hubY + Math.sin(a) * ry * u * 0.12);
    g.quadraticCurveTo(ox + Math.cos(a) * Wr * u * 0.7, oy - Hd * u * 0.45 + Math.sin(a) * ry * u * 0.5, ex, ey);
    g.strokeStyle = `rgba(${WH},${front ? 0.13 : 0.07})`;
    g.lineWidth = Math.max(0.6, u * 0.008);
    g.stroke();
  }
  // the four-lipped mouth in the middle
  g.beginPath();
  for (let q = 0; q < 4; q++) {
    const a = q * Math.PI / 2 + j.yaw + Math.PI / 4;
    g.moveTo(hubX, hubY);
    g.lineTo(hubX + Math.cos(a) * Wr * u * 0.1, hubY + Math.sin(a) * ry * u * 0.1 * 1.6);
  }
  g.strokeStyle = `rgba(${WH},0.18)`;
  g.lineWidth = Math.max(1, u * 0.02);
  g.stroke();
  g.restore();
  // tiny bright buds along the front of the rim where the tentacles start
  for (let i = 0; i <= 28; i++) {
    const th = (i / 28) * Math.PI;
    g.beginPath();
    g.arc(ox + Math.cos(th) * Wr * u * 0.97, oy + Math.sin(th) * ry * u * 0.97, Math.max(0.6, u * 0.009), 0, TAU);
    g.fillStyle = `rgba(${WH},0.35)`;
    g.fill();
  }
  // the back of the rim, seen through the bell
  g.beginPath();
  g.ellipse(ox, oy, Wr * u, ry * u, 0, Math.PI, TAU);
  g.strokeStyle = `rgba(${JL},0.22)`;
  g.lineWidth = Math.max(1, u * 0.02);
  g.stroke();
  // underside glow
  g.beginPath();
  g.ellipse(ox, oy - Hd * u * 0.12, Wr * u * 0.78, ry * u * 0.7, 0, 0, TAU);
  g.fillStyle = `rgba(${JL},0.07)`;
  g.fill();
  // four rings, turning with the jelly; the ones facing us are a little brighter
  for (let q = 0; q < 4; q++) {
    const ang = q * Math.PI / 2 + j.yaw;
    const rx = Math.cos(ang) * 0.24 * Wr, rz = Math.sin(ang) * 0.24 * Wr;
    const cx = ox + rx * u, cy = oy + (-Hd * 0.62 + rz * pitch * 0.9) * u;
    const near = rz > 0 ? 1 : 0.45;
    const ry2 = 0.1 * u * (0.45 + pitch);
    g.beginPath();
    g.ellipse(cx, cy, 0.1 * u, ry2, ang, 0, TAU);
    g.fillStyle = `rgba(${WH},${0.05 * near})`;
    g.fill();
    g.beginPath();
    g.ellipse(cx, cy, 0.1 * u, ry2, ang, 0.5, TAU - 0.25);
    g.strokeStyle = `rgba(${WH},${0.08 * near})`;
    g.lineWidth = Math.max(2, u * 0.07);
    g.stroke();
    g.strokeStyle = `rgba(${WH},${0.32 * near})`;
    g.lineWidth = Math.max(1, u * 0.025);
    g.stroke();
  }

  ctx.translate(j.x, j.y);
  ctx.rotate(j.tilt);
  const k2 = m / u; // canvas px -> world px
  ctx.drawImage(j.off, -ox * k2, -oy * k2, S * k2, S * k2);
  // bloom: the same bell, larger and faint, so the light spills softly around it
  // (shrunk then stretched back up, which blurs it cheaply, so it reads as glow)
  const bs = j.bloom.width;
  j.bg.clearRect(0, 0, bs, bs);
  j.bg.drawImage(j.off, 0, 0, bs, bs);
  ctx.globalAlpha = j.a * 0.6;
  const bl = 1.05;
  ctx.drawImage(j.bloom, -ox * k2 * bl, -oy * k2 * bl, S * k2 * bl, S * k2 * bl);
  ctx.restore();
}

// Shafts of sunlight coming down through the water from the surface, slanting slightly,
// widening as they fall, and slowly swaying and breathing.
// The light is the scanner: while a scan runs the shafts brighten and sweep through the water like
// a searchlight; when the verdict lands they settle into its colour (rose for red flags, amber for
// worth checking, calm gold for no known red flags). window.__sunMood(state) sets it.
// tint = the colour the jellies and the water's haze lean towards, mix = how far.
const MOODS = {
  idle:  { c: [255, 214, 110], k: 1.0,  sweep: 0, tint: null,           mix: 0 },
  scan:  { c: [255, 226, 150], k: 1.9,  sweep: 1, tint: null,           mix: 0 },
  red:   { c: [235, 40, 55],   k: 1.75, sweep: 0, tint: [225, 35, 50],  mix: 0.85 },
  amber: { c: [255, 140, 50],  k: 1.3,  sweep: 0, tint: [255, 130, 40], mix: 0.55 },
  clear: { c: [90, 225, 150],  k: 1.3,  sweep: 0, tint: [70, 215, 140], mix: 0.7 },
};
let tintC = [255, 170, 30], tintK = 0, lastTint = '';
const HAZE_BASE = { a: [240, 185, 11], b: [255, 140, 30] };
const mixC = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
let mood = MOODS.idle, sunC = MOODS.idle.c.slice(), sunK = 1, sweepK = 0, sweepT = 0;
window.__sunMood = (m) => { mood = MOODS[m] || MOODS.idle; };
let SUN = sunC.map(Math.round).join(',');
const RAYS = W < 600 ? 6 : 10;
const rays = Array.from({ length: RAYS }, (_, i) => ({
  x: (i + rand(0.1, 0.9)) / RAYS, w: rand(0.03, 0.09), spread: rand(1.8, 3.4), slant: rand(0.08, 0.16),
  a: rand(0.05, 0.12), ph: rand(0, 6.3), sp: rand(18, 36), sw: rand(0.006, 0.02),
}));
function drawRays(t) {
  // ease colour, brightness and sweep towards the current mood
  const e = Math.min(1, 0.016 * 1.3 * 60 / 60);
  for (let i = 0; i < 3; i++) sunC[i] += (mood.c[i] - sunC[i]) * 0.025;
  sunK += (mood.k - sunK) * 0.025;
  sweepK += (mood.sweep - sweepK) * 0.03;
  sweepT += 0.016 * (0.4 + sweepK);
  SUN = sunC.map(Math.round).join(',');
  // jellies and the water's haze lean towards the verdict's colour
  if (mood.tint) for (let i = 0; i < 3; i++) tintC[i] += (mood.tint[i] - tintC[i]) * 0.03;
  tintK += (mood.mix - tintK) * 0.025;
  const key = tintC.map(Math.round).join(',') + '|' + tintK.toFixed(2);
  if (key !== lastTint) {
    lastTint = key;
    JB = mixC(J_BASE.JB, tintC, tintK).join(',');
    JL = mixC(J_BASE.JL, tintC, tintK * 0.85).join(',');
    JW = mixC(J_BASE.JW, tintC, tintK * 0.6).join(',');
    WH = mixC(J_BASE.WH, tintC, tintK * 0.35).join(',');
    paintHalo();
    const root = document.documentElement.style;
    root.setProperty('--tank-a', mixC(HAZE_BASE.a, tintC, tintK * 0.8).join(','));
    root.setProperty('--tank-b', mixC(HAZE_BASE.b, tintC, tintK * 0.8).join(','));
  }
  void e;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // glare where the sun hits the surface
  const gx = W * (0.32 + sweepK * 0.3 * Math.sin(sweepT * 0.9)), glare = ctx.createRadialGradient(gx, -H * 0.05, 0, gx, -H * 0.05, Math.max(W, H) * 0.75);
  glare.addColorStop(0, `rgba(${SUN},${0.22 * sunK})`);
  glare.addColorStop(0.35, `rgba(${SUN},${0.07 * sunK})`);
  glare.addColorStop(1, `rgba(${SUN},0)`);
  ctx.fillStyle = glare;
  ctx.fillRect(0, 0, W, H);
  for (const r of rays) {
    const breathe = 0.55 + 0.45 * Math.sin((t / r.sp) * 6.283 + r.ph);
    const x0 = (r.x + Math.sin((t / (r.sp * 1.7)) * 6.283 + r.ph) * r.sw + sweepK * 0.14 * Math.sin(sweepT * 1.3 + r.ph)) * W;
    const w0 = r.w * W, w1 = w0 * r.spread, len = H * 1.05, dx = len * r.slant;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    const lift = sunK * (1 + sweepK * 0.6 * Math.max(0, Math.sin(sweepT * 2.1 + r.ph * 3)));
    g.addColorStop(0, `rgba(${SUN},${Math.min(0.5, r.a * breathe * lift)})`);
    g.addColorStop(0.5, `rgba(${SUN},${Math.min(0.25, r.a * breathe * 0.35 * lift)})`);
    g.addColorStop(1, `rgba(${SUN},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 - w0 / 2, -10);
    ctx.lineTo(x0 + w0 / 2, -10);
    ctx.lineTo(x0 + dx + w1 / 2, len);
    ctx.lineTo(x0 + dx - w1 / 2, len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Specks that rise and sway like feathers or tiny balloons.
const motes = Array.from({ length: Math.round(Math.min(70, (W * H) / 26000)) }, () => newMote(true));
function newMote(anywhere) {
  return {
    x: rand(0, W), y: anywhere ? rand(0, H) : H + 10,
    vx: 0, vy: 0, ox: 0, oy: 0,
    rise: rand(4, 12), // px per second
    sway: rand(8, 26), swayT: rand(7, 14), ph: rand(0, Math.PI * 2),
    r: rand(0.6, 1.8), a: rand(0.15, 0.55),
  };
}

let mouseX = -9999, mouseY = -9999;
addEventListener('pointermove', (e) => { mouseX = e.clientX; mouseY = e.clientY; }, { passive: true });
addEventListener('pointerleave', () => { mouseX = mouseY = -9999; });

let last = performance.now(), running = true;
document.addEventListener('visibilitychange', () => { running = !document.hidden; last = performance.now(); if (running) requestAnimationFrame(frame); });

function frame(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  ctx.clearRect(0, 0, W, H);

  for (const hz of haze) {
    const x = (hz.ax + hz.rx * Math.sin((t / hz.px) * 6.283 + hz.ph)) * W;
    const y = (hz.ay + hz.ry * Math.sin((t / hz.py) * 6.283 + hz.ph * 1.7)) * H;
    const g = ctx.createRadialGradient(x, y, 0, x, y, hz.r);
    g.addColorStop(0, `rgba(${hz.hue},${hz.a})`);
    g.addColorStop(1, `rgba(${hz.hue},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - hz.r, y - hz.r, hz.r * 2, hz.r * 2);
  }
  drawRays(t);
  jellies.sort((a, b) => a.z - b.z); // far ones behind near ones
  for (const j of jellies) drawJelly(j, t, dt);

  for (let i = 0; i < motes.length; i++) {
    const m = motes[i];
    m.y -= m.rise * dt;
    const sway = Math.sin((t / m.swayT) * Math.PI * 2 + m.ph) * m.sway;
    // The pointer nudges them aside gently; they drift back on their own.
    const dx = m.x + sway + m.ox - mouseX, dy = m.y + m.oy - mouseY;
    const d2 = dx * dx + dy * dy;
    if (d2 < 140 * 140 && d2 > 1) {
      const f = (1 - Math.sqrt(d2) / 140) * 26;
      const d = Math.sqrt(d2);
      m.vx += (dx / d) * f * dt; m.vy += (dy / d) * f * dt;
    }
    m.vx -= m.ox * 0.6 * dt; m.vy -= m.oy * 0.6 * dt;
    m.vx *= 0.965; m.vy *= 0.965;
    m.ox += m.vx; m.oy += m.vy;
    if (m.y < -20) motes[i] = newMote(false);
    const twinkle = 0.75 + Math.sin(t * 0.7 + m.ph) * 0.25;
    ctx.fillStyle = `rgba(${mote},${m.a * twinkle})`;
    ctx.beginPath();
    ctx.arc(m.x + sway + m.ox, m.y + m.oy, m.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Glow under the pointer trails behind it, then settles.
  for (const c of followers) {
    c._gx = lerp(c._gx, c._tx, 0.09);
    c._gy = lerp(c._gy, c._ty, 0.09);
    c.style.setProperty('--mx', c._gx.toFixed(1) + 'px');
    c.style.setProperty('--my', c._gy.toFixed(1) + 'px');
    if (Math.abs(c._gx - c._tx) < 0.3 && Math.abs(c._gy - c._ty) < 0.3) followers.delete(c);
  }

  requestAnimationFrame(frame);
}
if (!reduced) requestAnimationFrame(frame);
else { // one still frame: the jellyfish are there, they just don't move
  requestAnimationFrame((n) => { last = n; frame(n); running = false; });
}

// ------------------------------------------------------------------ things settling into place

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }
}, { rootMargin: '0px 0px -8% 0px' });

export function float(root = document) {
  root.querySelectorAll('[data-float]:not(.in)').forEach((el, i) => {
    if (!el.style.getPropertyValue('--d')) el.style.setProperty('--d', (el.dataset.float || i * 90) + 'ms');
    if (reduced) el.classList.add('in'); else io.observe(el);
  });
}
float();
window.__float = float;

// ------------------------------------------------------------------ page motion

// Headings surface with a soft wipe and a glint.
const rio = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); rio.unobserve(e.target); }
}, { rootMargin: '0px 0px -10% 0px' });
document.querySelectorAll('[data-rise]').forEach((el) => (reduced ? el.classList.add('in') : rio.observe(el)));

if (!reduced) {
  // The hero sinks back slowly as you scroll past it, like it's further down in the water.
  const hero = document.querySelector('.hero');
  let sy = scrollY, hy = scrollY;
  addEventListener('scroll', () => { sy = scrollY; }, { passive: true });
  const heroLoop = () => {
    hy = lerp(hy, sy, 0.08);
    if (hero) {
      const k = Math.min(1, hy / 420);
      hero.style.transform = `translate3d(0, ${(hy * 0.12).toFixed(2)}px, 0) scale(${(1 - k * 0.04).toFixed(4)})`;
      hero.style.opacity = (1 - k * k * 0.95).toFixed(3);
      hero.style.filter = k > 0.01 ? `blur(${(k * 3).toFixed(2)}px)` : '';
    }
    requestAnimationFrame(heroLoop);
  };
  requestAnimationFrame(heroLoop);

  // Buttons lean toward the pointer and spring back slowly when it leaves.
  const fine = matchMedia('(pointer: fine)').matches;
  if (fine) {
    const springs = new Map();
    const tick = () => {
      for (const [el, s] of springs) {
        s.vx += (s.tx - s.x) * 0.06; s.vy += (s.ty - s.y) * 0.06;
        s.vx *= 0.82; s.vy *= 0.82; s.x += s.vx; s.y += s.vy;
        el.style.transform = `translate3d(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px, 0)`;
        if (!s.on && Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.vx) + Math.abs(s.vy) < 0.05) {
          el.style.transform = ''; springs.delete(el);
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    document.addEventListener('pointermove', (ev) => {
      const el = ev.target.closest && ev.target.closest('.gf-btn');
      for (const [b, s] of springs) if (b !== el) { s.on = false; s.tx = 0; s.ty = 0; }
      if (!el || el.disabled) return;
      const r = el.getBoundingClientRect();
      const s = springs.get(el) || { x: 0, y: 0, vx: 0, vy: 0 };
      s.on = true;
      s.tx = (ev.clientX - (r.left + r.width / 2)) * 0.28;
      s.ty = (ev.clientY - (r.top + r.height / 2)) * 0.4;
      springs.set(el, s);
    }, { passive: true });
  }
}
