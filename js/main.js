// ---- 가상 좌표계 (1000 x 700) : 화면 크기에 맞춰 스케일 ----
const VW = 1000, VH = 700;
const HORIZON = 470, FLOOR = 640, STAGE_Y = 600, FEET = 618;
const GRAVITY = 0.42, DAMP = 0.985, ITER = 8, STEP = 1 / 60;
const GRAB_R = 26, TOUCH_R = 22, WEAR_MAX = 100, ANCHOR_Y = 20;
const CURTAIN_TOP = -120, CURTAIN_L = -4000, CURTAIN_R = 5000;  // 넓은 화면에서도 좌우 끝이 비지 않도록 크게 잡음
const INK = '#3a2616', TAU = Math.PI * 2;

// 값은 [낮, 밤]
const PAL = {
  skyTop:   ['#63bdf2', '#0b1636'],
  skyBot:   ['#d9f3ff', '#2c2f6f'],
  far:      ['#9ad9a8', '#22406e'],
  mid:      ['#6cc47f', '#1a3457'],
  near:     ['#4aa86a', '#173a3c'],
  canopy:   ['#4fae5f', '#1d4d46'],
  wood:     ['#9a6236', '#4d3150'],
  thatch:   ['#e6b65e', '#8e6b3c'],
  win:      ['#c7ecff', '#ffd66b'],
  grassTop: ['#8be38f', '#3f7a5a'],
  grassBot: ['#2f9a4f', '#14302f'],
  curtainLight: ['#d8434f', '#8a1f30'],
  curtainDark:  ['#a92535', '#5a1220'],
};
const hexRGB = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
function col(name, n) {
  const a = hexRGB(PAL[name][0]), b = hexRGB(PAL[name][1]);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * n)).join(',')})`;
}
// 위→아래 그라데이션 (잔디에 사용)
function vGrad(topName, botName, n, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, col(topName, n));
  g.addColorStop(1, col(botName, n));
  return g;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- 캔버스 / 좌표 변환 ----
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const slider = document.getElementById('scroll');
let W = 0, H = 0, S = 1, OX = 0, OY = 0, DPR = 1;
let valanceY = 78;  // 맨 위 막의 아랫단 (화면 상단 제목 배경 바로 아래)

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  if (W < H) {
    // 세로 화면(휴대폰): 가로폭에 맞추고 장면을 위쪽에 붙여 동아줄과 제목이 잘리지 않게 함
    S = W / (VW * 0.8); OX = (W - VW * S) / 2; OY = 0;  // 장면을 조금 키워 동아줄과 인물이 잘 보이게 함
  } else {
    S = Math.min(W / VW, H / VH); OX = (W - VW * S) / 2; OY = (H - VH * S) / 2;
  }
  valanceY = Math.max(20, (88 - OY) / S);  // 화면 88px 높이까지 막을 올려 제목 배경에 닿게 함
}
const toV = (cx, cy) => ({ x: (cx - OX) / S, y: (cy - OY) / S });
addEventListener('resize', resize);
resize();

// ---- 스크롤: 브라우저 페이지 스크롤 값을 그대로 사용 (휠/트랙패드와 1:1) ----
const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);
const progress = () => Math.min(1, Math.max(0, window.scrollY / maxScroll()));

// ---- 해 / 달 궤도 ----
// 해는 p 0~0.6에 지고, 달은 p 0.2~0.55에 떠올라 커튼이 내려오기 전에 충분히 보임
function sunPos(p) {
  const s = Math.min(1, p / 0.6);
  return { x: 800 - s * 600, y: 150 + s * s * (HORIZON + 80 - 150) };
}
function moonPos(p) {
  const m = Math.min(1, Math.max(0, (p - 0.2) / 0.35));
  return { x: 900 - m * 600, y: 530 - Math.sin(m * Math.PI / 2) * 340 };
}

// ---- 커튼: 처음엔 위쪽 막(valance)만 보이고, 스크롤할수록 내려와 무대 바닥까지 덮음 ----
function curtainBottom(p) {
  return valanceY + (STAGE_Y - valanceY) * smooth(0.62, 0.8, p);
}

const STARS = Array.from({ length: 90 }, () => ({
  x: -600 + Math.random() * 2200, y: Math.random() * 420, r: 0.5 + Math.random() * 1.7, ph: Math.random() * TAU,
}));

// ---- 동아줄 세트: [종류, x 위치, 길이] ----
const ROPE_SET = [
  ['good', 300, 350], ['rotten', 140, 400], ['good', 650, 300],
  ['rotten', 470, 250], ['good', 835, 380], ['rotten', 720, 330],
];

// ---- 커튼콜 배우: 해님, 호랑이, 달님 (스크롤에 따라 무대 바닥에서 올라와 인사) ----
const ACTORS = [
  { kind: 'sun', x: 300, lag: 0.8 },
  { kind: 'tiger', x: 520, lag: 0.78 },
  { kind: 'moon', x: 740, lag: 0.84 },
];

// ---- 상태 ----
let T = 0, last = performance.now(), acc = 0, mx = 0;
let ropes = [], particles = [], popups = [];
let grab = null, drag = null;
let ropesActive = true, ropeFade = 1;
const pointer = { x: 0, y: 0, px: 0, py: 0, dx: 0, dy: 0, sx: 0, active: false };

function makeRope(type, ax, len) {
  const segs = Math.round(len / 13), seg = len / segs, pts = [];
  for (let i = 0; i <= segs; i++) {
    const y = ANCHOR_Y + i * seg;
    pts.push({ x: ax + Math.sin(i * 0.7) * 2, y, px: ax, py: y, wear: 0, m: Math.random() });
  }
  return { type, ax, seg, pinned: true, fall: false, alpha: 1, life: 0, points: pts };
}
function resetRopes() {
  ropes = ROPE_SET.map(([t, x, l]) => makeRope(t, x, l));
  particles = []; popups = []; grab = null; drag = null;
}

// ---- 물리 (Verlet + 거리 제약) ----
function physicsStep() {
  for (const r of ropes) {
    const P = r.points, n = P.length;
    for (let i = r.pinned ? 1 : 0; i < n; i++) {
      const q = P[i];
      const vx = (q.x - q.px) * DAMP, vy = (q.y - q.py) * DAMP;
      q.px = q.x; q.py = q.y;
      q.x += vx; q.y += vy + GRAVITY;
    }
    for (let k = 0; k < ITER; k++) {
      for (let i = 0; i < n - 1; i++) {
        const a = P[i], b = P[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - r.seg) / d;
        if (i === 0 && r.pinned) { b.x -= dx * diff; b.y -= dy * diff; }
        else {
          a.x += dx * diff * 0.5; a.y += dy * diff * 0.5;
          b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5;
        }
      }
      if (r.pinned) { P[0].x = r.ax; P[0].y = ANCHOR_Y; }
      for (const q of P) if (q.y > FLOOR) { q.y = FLOOR; q.px = q.x; }
    }
    if (grab && grab.rope === r) {
      const q = P[grab.idx];
      q.x += (pointer.x - q.x) * 0.5; q.y += (pointer.y - q.y) * 0.5;
      q.px = q.x; q.py = q.y;
    }
  }
}

function nearest(x, y, R) {
  if (!ropesActive) return null;  // 커튼이 내려와 무대가 끝나면 동아줄은 잡을 수 없음
  let best = null, bd = R * R;
  for (const r of ropes) {
    const P = r.points;
    for (let i = 1; i < P.length; i++) {
      const dx = P[i].x - x, dy = P[i].y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = { rope: r, idx: i }; }
    }
  }
  return best;
}

// 썩은 동아줄: 만지면 쌓이는 마모 → 한계에 닿으면 끊어짐
function touchRopes() {
  if (!pointer.active || !ropesActive) return;
  const sp = Math.hypot(pointer.dx, pointer.dy);
  const hit = grab || nearest(pointer.x, pointer.y, TOUCH_R);
  if (!hit) return;
  const { rope, idx } = hit, P = rope.points;
  if (!grab && sp > 0.8) { P[idx].x += pointer.dx * 0.4; P[idx].y += pointer.dy * 0.4; }
  if (rope.type !== 'rotten' || (!grab && sp < 1)) return;
  const add = (grab ? 0.9 : 0) + Math.min(sp, 14) * 0.2;
  P[idx].wear += add;
  if (idx > 1) P[idx - 1].wear += add * 0.25;
  if (idx < P.length - 1) P[idx + 1].wear += add * 0.25;
  if (P[idx].wear >= WEAR_MAX) snapRope(rope, idx);
}

function snapRope(rope, idx) {
  const P = rope.points, top = P.slice(0, idx), bot = P.slice(idx);
  ropes = ropes.filter(r => r !== rope);
  if (grab && grab.rope === rope) grab = null;
  if (top.length >= 2) ropes.push({ ...rope, points: top, pinned: true, fall: false, alpha: 1, life: 0 });
  if (bot.length >= 2) ropes.push({ ...rope, points: bot, pinned: false, fall: true, alpha: 1, life: 180 });
  const q = P[idx];
  for (let i = 0; i < 14; i++) {
    particles.push({
      x: q.x, y: q.y, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3 - 1,
      life: 40 + Math.random() * 30, c: rope.type === 'rotten' ? '#8f7a52' : '#f2c85b',
    });
  }
  popups.push({ text: '뚝!', x: q.x, y: q.y - 10, life: 50 });
}

function updateEffects() {
  for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.life--; }
  particles = particles.filter(p => p.life > 0);
  for (const q of popups) { q.y -= 0.5; q.life--; }
  popups = popups.filter(q => q.life > 0);
  for (const r of ropes) {
    if (r.fall) { r.life--; r.alpha = Math.min(1, r.life / 40); }
    if (r.type === 'rotten') for (const q of r.points) if (q.wear > 0) q.wear = Math.max(0, q.wear - 0.01);
  }
  ropes = ropes.filter(r => !(r.fall && r.life <= 0));
}

// ---- 그리기 헬퍼 ----
function strokeInk(w = 3) { ctx.strokeStyle = INK; ctx.lineWidth = w; ctx.stroke(); }
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function hillPath(baseY, amp, ph, bottom = 3000) {
  ctx.beginPath(); ctx.moveTo(-4000, bottom);
  for (let x = -4000; x <= 5000; x += 25)
    ctx.lineTo(x, baseY - Math.sin(x * 0.007 + ph) * amp - Math.sin(x * 0.019 + ph * 2) * amp * 0.35);
  ctx.lineTo(5000, bottom); ctx.closePath();
}
function face() {
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(-14, -6, 3.5, 0, TAU); ctx.arc(14, -6, 3.5, 0, TAU); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = INK;
  ctx.beginPath(); ctx.arc(0, 4, 12, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.fillStyle = 'rgba(255,120,120,.5)';
  ctx.beginPath(); ctx.arc(-22, 8, 4, 0, TAU); ctx.arc(22, 8, 4, 0, TAU); ctx.fill();
}

// ---- 하늘 요소 ----
function drawStars(t, n) {
  if (n <= 0.02) return;
  ctx.fillStyle = '#fff';
  for (const s of STARS) {
    ctx.globalAlpha = n * (0.55 + 0.45 * Math.sin(t * 2 + s.ph));
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawSun(p, t) {
  const { x, y } = sunPos(p);
  if (y > HORIZON + 120) return;
  ctx.save(); ctx.translate(x, y);
  const glow = ctx.createRadialGradient(0, 0, 30, 0, 0, 130);
  glow.addColorStop(0, 'rgba(255,230,120,.55)'); glow.addColorStop(1, 'rgba(255,230,120,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 130, 0, TAU); ctx.fill();
  ctx.rotate(t * 0.2); ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    ctx.rotate(TAU / 12);
    ctx.beginPath(); ctx.moveTo(52, -9); ctx.lineTo(82, 0); ctx.lineTo(52, 9); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  ctx.rotate(-t * 0.2);
  const body = ctx.createRadialGradient(-10, -10, 4, 0, 0, 44);
  body.addColorStop(0, '#fff6b0'); body.addColorStop(1, '#ffb53a');
  ctx.fillStyle = body; ctx.beginPath(); ctx.arc(0, 0, 44, 0, TAU); ctx.fill(); ctx.stroke();
  face();
  ctx.restore();
}
function drawMoon(p) {
  const { x, y } = moonPos(p);
  if (y > HORIZON + 120) return;
  ctx.save(); ctx.translate(x, y);
  const glow = ctx.createRadialGradient(0, 0, 30, 0, 0, 120);
  glow.addColorStop(0, 'rgba(230,240,255,.4)'); glow.addColorStop(1, 'rgba(230,240,255,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 120, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff8dc'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 38, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e5dbb0';
  ctx.beginPath(); ctx.arc(-14, -12, 7, 0, TAU); ctx.arc(12, 10, 5, 0, TAU); ctx.arc(-8, 16, 4, 0, TAU); ctx.fill();
  face();
  ctx.restore();
}

// ---- 산 / 나무 / 집 / 호랑이 / 앞 잔디 ----
function drawTree(x, base, r, n) {
  const cy = base - r * 2.1;
  ctx.fillStyle = col('wood', n); ctx.strokeStyle = INK; ctx.lineWidth = 3;
  rr(x - r * 0.16, cy + r * 0.4, r * 0.32, base - cy - r * 0.4, 6); ctx.fill(); ctx.stroke();
  const blobs = [[0, 0, 1], [-0.75, 0.15, 0.7], [0.75, 0.1, 0.72], [-0.45, -0.55, 0.75],
    [0.5, -0.5, 0.72], [0, -0.28, 0.85], [-1.1, -0.2, 0.5], [1.1, -0.15, 0.5], [0, 0.45, 0.65]];
  ctx.beginPath();
  for (const [bx, by, br] of blobs) {
    ctx.moveTo(x + (bx + br) * r, cy + by * r);
    ctx.arc(x + bx * r, cy + by * r, br * r, 0, TAU);
  }
  ctx.lineWidth = 8; ctx.strokeStyle = INK; ctx.stroke();
  ctx.fillStyle = col('canopy', n); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.14)';
  ctx.beginPath(); ctx.arc(x - 0.35 * r, cy - 0.45 * r, 0.22 * r, 0, TAU); ctx.fill();
}
function drawFarHills(n) {
  hillPath(430, 40, 0.6);
  ctx.fillStyle = col('far', n); ctx.fill(); strokeInk(3);
}
function drawMid(n) {
  hillPath(478, 22, 1.3);
  ctx.fillStyle = col('mid', n); ctx.fill(); strokeInk(3);
  drawTree(170, 470, 98, n);
  drawTree(850, 480, 64, n);
}
function drawKid(x, y, girl) {
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.fillStyle = girl ? '#ec4f67' : '#4f86d9';
  rr(x - 13, y - 32, 26, 32, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffdcb8';
  ctx.beginPath(); ctx.arc(x, y - 44, 16, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2a1b10';
  ctx.beginPath(); ctx.arc(x, y - 46, 17, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
  if (girl) { ctx.beginPath(); ctx.arc(x, y - 62, 8, 0, TAU); ctx.fill(); }
  ctx.beginPath(); ctx.arc(x - 5, y - 42, 2.2, 0, TAU); ctx.arc(x + 5, y - 42, 2.2, 0, TAU); ctx.fill();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - 38, 4, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
}
function drawHouse(n) {
  // 뒤쪽 잔디 언덕
  hillPath(566, 10, 2.2);
  ctx.fillStyle = vGrad('grassTop', 'grassBot', n, 540, 680); ctx.fill(); strokeInk(3);
  // 벽 (나무 판자)
  ctx.fillStyle = col('wood', n); ctx.strokeStyle = INK; ctx.lineWidth = 4;
  rr(310, 440, 380, 124, 6); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(58,38,22,.35)';
  for (let x = 337; x < 690; x += 27) { ctx.beginPath(); ctx.moveTo(x, 446); ctx.lineTo(x, 558); ctx.stroke(); }
  // 창문 (밤에는 따뜻하게 빛남)
  for (const wx of [345, 460, 575]) {
    ctx.save();
    ctx.fillStyle = col('win', n);
    if (n > 0.2) { ctx.shadowColor = 'rgba(255,214,107,.9)'; ctx.shadowBlur = 22 * n; }
    rr(wx, 478, 60, 52, 4); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = 4; rr(wx, 478, 60, 52, 4); ctx.stroke();
    ctx.lineWidth = 3; ctx.beginPath();
    ctx.moveTo(wx + 30, 478); ctx.lineTo(wx + 30, 530); ctx.moveTo(wx, 504); ctx.lineTo(wx + 60, 504);
    ctx.stroke();
  }
  // 초가지붕 (짚 무늬는 지붕 안에서만)
  const roof = new Path2D('M280 452 L335 330 L665 330 L720 452 Z');
  ctx.save();
  ctx.fillStyle = col('thatch', n); ctx.fill(roof);
  ctx.clip(roof);
  ctx.strokeStyle = 'rgba(120,78,30,.45)'; ctx.lineWidth = 3;
  for (let y = 338; y < 460; y += 11) {
    ctx.beginPath();
    for (let x = 250; x <= 750; x += 16) ctx.lineTo(x, y + ((x / 16) | 0) % 2 * 4);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke(roof);
  rr(328, 322, 344, 14, 6); ctx.fillStyle = '#6b4a22'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke();
  // 오누이
  drawKid(452, 322, false);
  drawKid(548, 322, true);
}
// 호랑이 몸체 (원점 기준). 집 옆 장면과 무대 커튼콜에서 함께 사용
function drawTigerBody() {
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(60, 8); ctx.quadraticCurveTo(110, 30, 120, -14);
  ctx.lineWidth = 13; ctx.strokeStyle = INK; ctx.stroke();
  ctx.lineWidth = 7; ctx.strokeStyle = '#f5922b'; ctx.stroke();
  ctx.fillStyle = '#f5922b'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, 0, 70, 36, 0, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(-62, -24, 38, 32, 0, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(-78, -52, 10, 0, TAU); ctx.arc(-48, -54, 10, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 6; ctx.strokeStyle = INK;
  ctx.beginPath();
  for (const x of [-20, 0, 20, 40]) { ctx.moveTo(x, -34); ctx.lineTo(x + 5, -12); ctx.moveTo(x, 34); ctx.lineTo(x + 5, 12); }
  ctx.moveTo(-82, -12); ctx.lineTo(-70, -4);
  ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(-72, -26, 7, 5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(-71, -26, 2.5, 0, TAU); ctx.fill();
}
function drawTiger() {
  ctx.save(); ctx.translate(870, 575);
  drawTigerBody();
  ctx.restore();
}
function drawFront(n) {
  hillPath(608, 6, 4);
  ctx.fillStyle = vGrad('grassTop', 'grassBot', n, 600, 700); ctx.fill(); strokeInk(3);
  ctx.lineWidth = 2; ctx.strokeStyle = INK;
  for (let x = -4000; x < 5000; x += 19) {
    const h = 16 + (Math.sin(x * 0.37) * 0.5 + 0.5) * 18;
    const lean = Math.sin(x * 1.3) * 6;
    ctx.fillStyle = col('canopy', n);
    ctx.beginPath();
    ctx.moveTo(x - 6, 620);
    ctx.quadraticCurveTo(x + lean * 0.2, 620 - h * 0.5, x + lean, 620 - h);
    ctx.quadraticCurveTo(x + lean * 0.2, 620 - h * 0.5, x + 6, 620);
    ctx.fill(); ctx.stroke();
  }
}

// ---- 무대 바닥 (커튼이 바닥에 닿으면 드러남) ----
function drawStageFloor(p) {
  const a = smooth(0.6, 0.9, p);
  if (a <= 0.01) return;
  ctx.save(); ctx.globalAlpha = a;
  const g = ctx.createLinearGradient(0, STAGE_Y, 0, 760);
  g.addColorStop(0, '#8a5630'); g.addColorStop(1, '#2e1a0e');
  ctx.fillStyle = g; ctx.fillRect(CURTAIN_L, STAGE_Y - 2, CURTAIN_R - CURTAIN_L, 2000);
  ctx.strokeStyle = 'rgba(40,20,8,.45)'; ctx.lineWidth = 2;
  for (let x = CURTAIN_L; x < CURTAIN_R; x += 60) {
    ctx.beginPath(); ctx.moveTo(x, STAGE_Y); ctx.lineTo(x - 20, 760); ctx.stroke();
  }
  ctx.fillStyle = '#d9a441'; ctx.fillRect(CURTAIN_L, STAGE_Y - 4, CURTAIN_R - CURTAIN_L, 5);
  ctx.restore();
}

// ---- 빨간 막 (커튼): 동화책 그림처럼 굵은 테두리 + 번갈아 나오는 주름 + 금색 장식 ----
function drawCurtain(p, n) {
  const bottom = curtainBottom(p);
  const PLEAT = 48, hem = bottom + 14;
  const lightC = col('curtainLight', n), darkC = col('curtainDark', n);
  const span = hem - CURTAIN_TOP;

  ctx.save();
  // 빈틈이 생기지 않도록 바탕을 먼저 꽉 채움
  ctx.fillStyle = darkC; ctx.fillRect(CURTAIN_L, CURTAIN_TOP, CURTAIN_R - CURTAIN_L, span);
  // 주름: 밝은 면과 어두운 면이 교대로, 가장자리는 살짝 휘어진 선
  for (let x = CURTAIN_L, i = 0; x < CURTAIN_R; x += PLEAT, i++) {
    const bulge = (i % 2 ? 1 : -1) * 12;
    const x2 = x + PLEAT;
    const y1 = CURTAIN_TOP + span * 0.33, y2 = CURTAIN_TOP + span * 0.66;
    ctx.beginPath();
    ctx.moveTo(x, CURTAIN_TOP);
    ctx.bezierCurveTo(x + bulge, y1, x - bulge, y2, x, hem);
    ctx.lineTo(x2, hem);
    ctx.bezierCurveTo(x2 - bulge, y2, x2 + bulge, y1, x2, CURTAIN_TOP);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? lightC : darkC;
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  }

  // 밝은 주름에 금색 점 장식
  ctx.fillStyle = '#f2c96b'; ctx.lineWidth = 1.5;
  for (let x = CURTAIN_L, i = 0; x < CURTAIN_R; x += PLEAT, i++) {
    if (i % 2 === 0) continue;
    for (let y = 60 + (i % 4) * 30; y < bottom - 20; y += 110) {
      ctx.beginPath(); ctx.arc(x + PLEAT / 2, y, 5, 0, TAU); ctx.fill(); ctx.stroke();
    }
  }

  // 아랫단: 금색 물결 장식 띠
  ctx.beginPath();
  ctx.moveTo(CURTAIN_L, bottom);
  ctx.lineTo(CURTAIN_R, bottom);
  for (let x = CURTAIN_R; x > CURTAIN_L; x -= 60) ctx.quadraticCurveTo(x - 30, bottom + 34, x - 60, bottom);
  ctx.closePath();
  ctx.fillStyle = '#e0a93b'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  ctx.restore();
}

// ---- 커튼콜 배우 ----
function drawSunActor() {
  ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-14, -26); ctx.lineTo(-18, 0); ctx.moveTo(14, -26); ctx.lineTo(18, 0);
  ctx.moveTo(-46, -70); ctx.lineTo(-72, -46); ctx.moveTo(46, -70); ctx.lineTo(72, -46);  // 팔
  ctx.stroke();
  ctx.save(); ctx.translate(0, -78);
  ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    ctx.rotate(TAU / 12);
    ctx.beginPath(); ctx.moveTo(50, -8); ctx.lineTo(72, 0); ctx.lineTo(50, 8); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  const body = ctx.createRadialGradient(-10, -10, 4, 0, 0, 48);
  body.addColorStop(0, '#fff6b0'); body.addColorStop(1, '#ffb53a');
  ctx.fillStyle = body; ctx.beginPath(); ctx.arc(0, 0, 48, 0, TAU); ctx.fill(); ctx.stroke();
  face();
  ctx.restore();
}
function drawMoonActor() {
  ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-12, -28); ctx.lineTo(-16, 0); ctx.moveTo(12, -28); ctx.lineTo(16, 0);
  ctx.moveTo(-40, -66); ctx.lineTo(-66, -44); ctx.moveTo(40, -66); ctx.lineTo(66, -44);
  ctx.stroke();
  ctx.save(); ctx.translate(0, -72);
  ctx.fillStyle = '#fff8dc'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 42, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e5dbb0';
  ctx.beginPath(); ctx.arc(-14, -12, 7, 0, TAU); ctx.arc(12, 10, 5, 0, TAU); ctx.arc(-8, 16, 4, 0, TAU); ctx.fill();
  face();
  ctx.restore();
}
function drawTigerActor() {
  ctx.save(); ctx.translate(0, -34); ctx.scale(0.9, 0.9);
  drawTigerBody();
  ctx.restore();
}

// 인사: 무대에 올라와 스크롤 진행에 따라 저마다 다른 속도로 올라오고, 끝에는 고개 숙여 인사
function drawActors(p, t) {
  const bowBase = smooth(0.84, 1, p);
  for (const a of ACTORS) {
    const up = smooth(a.lag, a.lag + 0.12, p);     // 0 → 1 : 무대 아래에서 올라옴
    const rise = (1 - up) * 190;
    const bow = bowBase * (0.5 + 0.5 * Math.sin(t * 1.8 + a.x * 0.01));
    ctx.save();
    ctx.beginPath(); ctx.rect(CURTAIN_L, 0, CURTAIN_R - CURTAIN_L, FLOOR); ctx.clip();
    ctx.translate(a.x - mx * 60, FEET + rise);   // 마우스 위치에 따라 살짝 움직이는 패럴럭스
    ctx.rotate(bow * 0.1);
    ctx.scale(1 + bow * 0.05, 1 - bow * 0.22);   // 몸을 숙이는 인사
    if (a.kind === 'sun') drawSunActor();
    else if (a.kind === 'moon') drawMoonActor();
    else drawTigerActor();
    ctx.restore();
  }
}

// ---- 동아줄 그리기 ----
function drawRope(r) {
  const P = r.points, n = P.length;
  if (n < 2) return;
  const rotten = r.type === 'rotten';
  const path = new Path2D();
  path.moveTo(P[0].x, P[0].y);
  for (let i = 1; i < n - 1; i++) {
    path.quadraticCurveTo(P[i].x, P[i].y, (P[i].x + P[i + 1].x) / 2, (P[i].y + P[i + 1].y) / 2);
  }
  path.lineTo(P[n - 1].x, P[n - 1].y);

  ctx.save();
  ctx.globalAlpha = r.alpha * ropeFade; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = 12; ctx.stroke(path);
  ctx.strokeStyle = rotten ? '#8c7a55' : '#f2c85b'; ctx.lineWidth = 8; ctx.stroke(path);
  // 꼬임 무늬 (정상 동아줄은 반짝이며 흐르고, 썩은 동아줄은 멈춰 있음)
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = rotten ? 0 : -T * 16;
  ctx.strokeStyle = rotten ? 'rgba(60,44,24,.55)' : 'rgba(255,248,205,.75)';
  ctx.stroke(path);
  ctx.setLineDash([]);

  for (let i = 1; i < n - 1; i++) {
    const q = P[i];
    if (rotten && q.m > 0.8) { ctx.fillStyle = '#4f6b3a'; ctx.beginPath(); ctx.arc(q.x, q.y, 2.4, 0, TAU); ctx.fill(); }
    if (q.wear > 30) {
      const tx = P[i + 1].x - P[i - 1].x, ty = P[i + 1].y - P[i - 1].y, tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl, ny = tx / tl;
      ctx.strokeStyle = '#2a1d10'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(q.x + nx * 6, q.y + ny * 6); ctx.lineTo(q.x - nx * 6, q.y - ny * 6); ctx.stroke();
      if (q.wear > 55) {
        ctx.strokeStyle = '#d8c58f'; ctx.lineWidth = 1.5;
        for (const s of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x + nx * s * 11 + (q.m - 0.5) * 6, q.y + ny * s * 11); ctx.stroke();
        }
      }
    }
  }
  // 끝 풀림 (썩은 동아줄은 더 헝클어짐)
  const a = P[n - 2], b = P[n - 1];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.strokeStyle = rotten ? '#8c7a55' : '#f2c85b'; ctx.lineWidth = 3;
  const spread = rotten ? [-0.6, -0.2, 0.2, 0.6] : [-0.35, 0, 0.35];
  for (const d of spread) {
    const len = rotten ? 8 + Math.abs(d) * 14 : 12;
    ctx.beginPath(); ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x + Math.cos(ang + d) * len, b.y + Math.sin(ang + d) * len);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- 메인 그리기 ----
function draw(p, t) {
  const n = smooth(0.35, 0.8, p);
  ropeFade = 1 - smooth(0.78, 0.86, p);

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, col('skyTop', n)); g.addColorStop(1, col('skyBot', n));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(DPR * S, 0, 0, DPR * S, DPR * OX, DPR * OY);

  // 하늘: 별, 해/달 (스크롤 진행도에 따라 궤도를 돈다)
  drawStars(t, n);
  ctx.save(); ctx.translate(-mx * 20, 0); drawSun(p, t); drawMoon(p); ctx.restore();

  // 페럴럭스: 레이어마다 스크롤에 따라 움직이는 거리가 다름
  ctx.save(); ctx.translate(-mx * 20, -p * 20); drawFarHills(n); ctx.restore();
  ctx.save(); ctx.translate(-mx * 40, -p * 50); drawMid(n); ctx.restore();
  ctx.save(); ctx.translate(-mx * 70, -p * 80); drawHouse(n); drawTiger(); ctx.restore();

  // 동아줄 (위쪽 막 아래에서 내려오는 물리 오브젝트)
  for (const r of ropes) drawRope(r);

  // 앞 잔디 → 무대 바닥 → 빨간 막 → 커튼콜 배우 순서로 앞에 쌓임
  ctx.save(); ctx.translate(-mx * 100, -p * 120); drawFront(n); ctx.restore();
  drawStageFloor(p);
  drawCurtain(p, n);
  drawActors(p, t);

  // 효과
  for (const q of particles) {
    ctx.globalAlpha = Math.min(1, q.life / 30); ctx.fillStyle = q.c;
    ctx.fillRect(q.x - 1.5, q.y - 1.5, 4, 2.5);
  }
  ctx.globalAlpha = 1;
  ctx.font = 'bold 30px Gaegu, sans-serif'; ctx.textAlign = 'center';
  ctx.lineWidth = 6; ctx.strokeStyle = INK;
  for (const q of popups) {
    ctx.globalAlpha = Math.min(1, q.life / 20);
    ctx.strokeText(q.text, q.x, q.y); ctx.fillStyle = '#fff6c9'; ctx.fillText(q.text, q.x, q.y);
  }
  // 커튼콜 문구
  const callA = smooth(0.9, 0.98, p);
  if (callA > 0.01) {
    ctx.globalAlpha = callA;
    ctx.font = 'bold 60px Gaegu, sans-serif'; ctx.lineWidth = 8;
    ctx.strokeText('커튼콜!', 500, 330); ctx.fillStyle = '#ffd98a'; ctx.fillText('커튼콜!', 500, 330);
  }
  ctx.globalAlpha = 1; ctx.textAlign = 'left';
}

// ---- 루프 ----
function frame(now) {
  requestAnimationFrame(frame);  // 먼저 예약해 두어야 중간 오류가 나도 루프가 멈추지 않음
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; T += dt;

  const p = progress();
  ropesActive = p < 0.8;
  if (!ropesActive) grab = null;
  if (!sliderDragging) slider.value = Math.round(p * 1000);  // 휠/드래그로 움직인 위치를 슬라이더에 바로 반영

  const label = p < 0.4 ? '해님 ☀️' : p < 0.8 ? '달님 🌙' : '커튼콜 👏';
  const stateEl = document.getElementById('state');
  if (stateEl.textContent !== label) stateEl.textContent = label;

  pointer.dx = pointer.active ? pointer.x - pointer.px : 0;
  pointer.dy = pointer.active ? pointer.y - pointer.py : 0;
  pointer.px = pointer.x; pointer.py = pointer.y;

  acc += dt; let steps = 0;
  while (acc >= STEP && steps < 4) { physicsStep(); acc -= STEP; steps++; }
  if (steps === 4) acc = 0;

  touchRopes();
  updateEffects();

  const mxTarget = pointer.active ? pointer.sx / W - 0.5 : 0;
  mx += (mxTarget - mx) * 0.05;

  draw(p, T);
}

// ---- 입력 ----
// 휠/트랙패드/키보드는 브라우저 기본 스크롤이 처리 → 장면은 그 값을 그대로 따른다.
// 캔버스 위에서 빈 곳을 끌면 같은 방식(1:1)으로 페이지를 스크롤한다.
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  const v = toV(e.clientX, e.clientY);
  pointer.x = pointer.px = v.x; pointer.y = pointer.py = v.y;
  pointer.sx = e.clientX; pointer.active = true;
  grab = nearest(v.x, v.y, GRAB_R);
  if (!grab) drag = { y: e.clientY, start: window.scrollY };
  canvas.style.cursor = grab ? 'grabbing' : 'default';
});
canvas.addEventListener('pointermove', e => {
  // 버튼을 놓쳤는데 끝 이벤트를 못 받은 경우 드래그가 남지 않도록 정리
  if (e.pointerType === 'mouse' && e.buttons === 0) endPointer();
  const v = toV(e.clientX, e.clientY);
  if (!pointer.active) { pointer.px = v.x; pointer.py = v.y; }
  pointer.x = v.x; pointer.y = v.y; pointer.sx = e.clientX; pointer.active = true;
  if (drag) window.scrollTo(0, drag.start + (drag.y - e.clientY));
  else if (!grab) canvas.style.cursor = nearest(v.x, v.y, GRAB_R) ? 'grab' : 'default';
});
function endPointer() { grab = null; drag = null; canvas.style.cursor = 'default'; }
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
window.addEventListener('blur', endPointer);
canvas.addEventListener('pointerleave', () => { if (!grab && !drag) pointer.active = false; });

// 슬라이더를 잡고 끄는 동안에는 프레임마다 값을 덮어쓰지 않도록 표시
let sliderDragging = false;
slider.addEventListener('pointerdown', () => { sliderDragging = true; });
window.addEventListener('pointerup', () => { sliderDragging = false; });
window.addEventListener('pointercancel', () => { sliderDragging = false; });
slider.addEventListener('input', () => { window.scrollTo(0, (+slider.value / 1000) * maxScroll()); });
document.getElementById('reset').addEventListener('click', resetRopes);

resetRopes();
requestAnimationFrame(frame);
