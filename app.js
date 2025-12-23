// PHD Aimlock Trainer — PRACTICE ONLY
// Không can thiệp iOS/game. Đây là app web luyện vuốt + đo ổn định tay.

const $ = (id) => document.getElementById(id);

const state = {
  running: false,
  t0: 0,
  round: 0,
  score: 0,
  // touch trace
  points: [],
  // metrics
  stability: 0,
  rtMs: 0,
  lastTargetAt: 0,

  // toggles
  smoothOn: true,
  antiShakeOn: true,
  guideOn: true,
  autoTarget: false,

  // sliders (0..1 or values)
  smooth: 0.65,
  antiShake: 0.35,
  difficulty: 5,
  moveSpeed: 0.35,

  // target
  target: { x: 0.7, y: 0.35, r: 0.05 }, // relative
  targetVel: { x: 0.12, y: 0.08 },      // relative per second
};

let toastTimer = null;
function toast(msg){
  const t = $("toast");
  if(!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.add("hidden"), 1600);
}

function setStatus(on){
  const dot = $("statusDot");
  const text = $("statusText");
  if(dot) dot.className = `statusDot ${on ? "on":"off"}`;
  if(text) text.textContent = on ? "Đã bật" : "Chưa bật";
}

function logLine(text){
  const box = $("log");
  if(!box) return;
  const div = document.createElement("div");
  div.className = "item";
  div.textContent = text;
  box.prepend(div);
}

function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function lerp(a,b,t){ return a + (b-a)*t; }

const canvas = $("arena");
const ctx = canvas.getContext("2d");

function fitCanvas(){
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener("resize", fitCanvas);

function syncUI(){
  // toggles
  state.smoothOn = $("togSmooth").checked;
  state.antiShakeOn = $("togAntiShake").checked;
  state.guideOn = $("togAssistLine").checked;
  state.autoTarget = $("togAutoTarget").checked;

  // sliders
  state.smooth = ($("slSmooth").valueAsNumber || 0) / 100;
  state.antiShake = ($("slAntiShake").valueAsNumber || 0) / 100;
  state.difficulty = $("slDifficulty").valueAsNumber || 5;
  state.moveSpeed = ($("slMoveSpeed").valueAsNumber || 0) / 100;

  $("valSmooth").textContent = Math.round(state.smooth*100) + "%";
  $("valAntiShake").textContent = Math.round(state.antiShake*100) + "%";
  $("valDifficulty").textContent = String(state.difficulty);
  $("valMoveSpeed").textContent = Math.round(state.moveSpeed*100) + "%";

  // status = bật nếu đang chạy hoặc có ít nhất 1 toggle đang ON
  const anyOn = state.running || state.smoothOn || state.antiShakeOn || state.guideOn || state.autoTarget;
  setStatus(anyOn);
}

["togSmooth","togAntiShake","togAssistLine","togAutoTarget","slSmooth","slAntiShake","slDifficulty","slMoveSpeed"]
  .forEach(id => $(id).addEventListener("input", () => { syncUI(); toast("Đã cập nhật ✅"); }));

function resetAll(){
  state.running = false;
  state.round = 0;
  state.score = 0;
  state.points = [];
  state.stability = 0;
  state.rtMs = 0;

  // reset UI defaults
  $("togSmooth").checked = true;
  $("togAntiShake").checked = true;
  $("togAssistLine").checked = true;
  $("togAutoTarget").checked = false;

  $("slSmooth").value = 65;
  $("slAntiShake").value = 35;
  $("slDifficulty").value = 5;
  $("slMoveSpeed").value = 35;

  // reset target
  state.target = { x: 0.7, y: 0.35, r: 0.05 };
  state.targetVel = { x: 0.12, y: 0.08 };
  state.lastTargetAt = performance.now();

  // reset log display (không xoá lịch sử nếu bạn không muốn)
  logLine("Reset ✅ (trạng thái + thông số về mặc định)");

  syncUI();
  draw();
}

function start(){
  state.running = true;
  state.round += 1;
  state.points = [];
  state.t0 = performance.now();
  state.lastTargetAt = state.t0;
  state.rtMs = 0;

  toast("Bắt đầu luyện ✅");
  logLine(`Bắt đầu vòng #${state.round}`);
  syncUI();
}

function stop(){
  state.running = false;
  toast("Đã dừng ⛔");
  logLine("Đã dừng");
  syncUI();
}

function showPreset(){
  // Chỉ là gợi ý — không can thiệp game
  const msg =
`Preset gợi ý (tự điều chỉnh theo cảm giác):
- Smooth: 55–75
- Anti-Shake: 25–45
- Difficulty: 4–6
- Move speed: 25–45

Mẹo:
- Vuốt đều tay, không giật
- 3 vòng: lấy vòng ổn định nhất`;

  alert(msg);
  toast("Đã mở preset 📌");
}

$("btnStart").addEventListener("click", start);
$("btnStop").addEventListener("click", stop);
$("btnReset").addEventListener("click", resetAll);
$("btnPreset").addEventListener("click", showPreset);

// Touch handling
let pointerDown = false;
let lastP = null; // {x,y,t}

function toCanvasPos(e){
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left);
  const y = (e.clientY - rect.top);
  return { x, y };
}

canvas.addEventListener("pointerdown", (e)=>{
  pointerDown = true;
  canvas.setPointerCapture(e.pointerId);
  const p = toCanvasPos(e);
  const t = performance.now();
  lastP = { ...p, t };

  if(state.running && state.rtMs === 0){
    // phản ứng = thời gian từ lúc mục tiêu xuất hiện đến thao tác đầu
    state.rtMs = Math.round(t - state.lastTargetAt);
  }

  state.points.push({ x:p.x, y:p.y, t });
});

canvas.addEventListener("pointermove", (e)=>{
  if(!pointerDown) return;
  const p = toCanvasPos(e);
  const t = performance.now();

  // raw delta
  const dx = p.x - lastP.x;
  const dy = p.y - lastP.y;

  // anti-shake: giảm “giật” bằng cách kẹp delta nhỏ
  let ndx = dx, ndy = dy;
  if(state.antiShakeOn){
    const limit = lerp(8, 2, state.antiShake); // antiShake cao -> limit nhỏ
    ndx = clamp(ndx, -limit, limit);
    ndy = clamp(ndy, -limit, limit);
  }

  // smooth: EMA làm mượt đường đi
  let sx = p.x, sy = p.y;
  if(state.smoothOn && state.points.length){
    const prev = state.points[state.points.length-1];
    const a = lerp(0.55, 0.15, state.smooth); // smooth cao -> a nhỏ -> mượt hơn
    sx = lerp(prev.x, prev.x + ndx, 1-a);
    sy = lerp(prev.y, prev.y + ndy, 1-a);
  }

  state.points.push({ x:sx, y:sy, t });
  lastP = { x:p.x, y:p.y, t };

  if(state.running){
    evaluateHit();
    updateStability();
  }
});

canvas.addEventListener("pointerup", ()=>{
  pointerDown = false;
  lastP = null;
});

// Metrics
function targetPx(){
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  const rBase = lerp(40, 18, (state.difficulty-1)/9); // difficulty cao -> target nhỏ
  return {
    x: state.target.x * w,
    y: state.target.y * h,
    r: rBase
  };
}

function evaluateHit(){
  const tp = targetPx();
  const p = state.points[state.points.length-1];
  if(!p) return;

  const dist = Math.hypot(p.x - tp.x, p.y - tp.y);
  const hit = dist <= tp.r;

  if(hit){
    // cộng điểm theo difficulty
    const add = Math.round(10 + state.difficulty * 4);
    state.score += add;

    // đổi mục tiêu
    newTarget();

    toast(`Hit +${add}`);
    logLine(`Hit +${add} | RT ${state.rtMs||0}ms | ổn định ${state.stability}`);
  }
}

function updateStability(){
  // đo “rung” dựa trên độ biến thiên góc/độ cong gần đây
  const n = state.points.length;
  if(n < 8) return;

  const recent = state.points.slice(-20);
  let jerkSum = 0;
  for(let i=2;i<recent.length;i++){
    const a = recent[i-2], b = recent[i-1], c = recent[i];
    const v1x = b.x - a.x, v1y = b.y - a.y;
    const v2x = c.x - b.x, v2y = c.y - b.y;
    const ang1 = Math.atan2(v1y, v1x);
    const ang2 = Math.atan2(v2y, v2x);
    let d = Math.abs(ang2 - ang1);
    if(d > Math.PI) d = (2*Math.PI) - d;
    jerkSum += d;
  }
  // jerkSum càng nhỏ càng ổn định -> convert về 0..100
  const raw = jerkSum / Math.max(1, recent.length-2);
  const stability = Math.round(clamp(100 - raw*140, 0, 100));
  state.stability = stability;
}

function newTarget(){
  const now = performance.now();
  state.lastTargetAt = now;
  state.rtMs = 0;

  // random target safe margin
  const margin = 0.12;
  state.target.x = margin + Math.random()*(1-2*margin);
  state.target.y = margin + Math.random()*(1-2*margin);

  // random velocity (auto move)
  const sp = lerp(0.04, 0.18, state.moveSpeed);
  state.targetVel.x = (Math.random() > 0.5 ? 1 : -1) * sp;
  state.targetVel.y = (Math.random() > 0.5 ? 1 : -1) * (sp*0.8);
}

function stepTarget(dt){
  if(!state.autoTarget) return;

  const margin = 0.10;
  state.target.x += state.targetVel.x * dt;
  state.target.y += state.targetVel.y * dt;

  if(state.target.x < margin || state.target.x > 1-margin) state.targetVel.x *= -1;
  if(state.target.y < margin || state.target.y > 1-margin) state.targetVel.y *= -1;

  state.target.x = clamp(state.target.x, margin, 1-margin);
  state.target.y = clamp(state.target.y, margin, 1-margin);
}

// Render
function drawBackground(w,h){
  // grid
  ctx.save();
  ctx.clearRect(0,0,w,h);

  ctx.fillStyle = "rgba(0,0,0,.18)";
  ctx.fillRect(0,0,w,h);

  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = 1;
  const step = 28;
  for(let x=0;x<w;x+=step){
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
  }
  for(let y=0;y<h;y+=step){
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
  }
  ctx.restore();
}

function drawTarget(tp){
  ctx.save();

  // outer ring
  ctx.strokeStyle = "rgba(120,180,255,.75)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(tp.x, tp.y, tp.r, 0, Math.PI*2);
  ctx.stroke();

  // inner
  ctx.fillStyle = "rgba(120,180,255,.12)";
  ctx.beginPath();
  ctx.arc(tp.x, tp.y, Math.max(6, tp.r*0.35), 0, Math.PI*2);
  ctx.fill();

  // center dot
  ctx.fillStyle = "rgba(90,255,200,.55)";
  ctx.beginPath();
  ctx.arc(tp.x, tp.y, 2.8, 0, Math.PI*2);
  ctx.fill();

  ctx.restore();
}

function drawPath(){
  const pts = state.points;
  if(pts.length < 2) return;

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.78)";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for(let i=1;i<pts.length;i++){
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();

  // head
  const p = pts[pts.length-1];
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.5, 0, Math.PI*2);
  ctx.fill();

  ctx.restore();
}

function drawGuide(tp){
  if(!state.guideOn) return;
  const pts = state.points;
  if(!pts.length) return;
  const p = pts[pts.length-1];

  ctx.save();
  ctx.setLineDash([6,8]);
  ctx.strokeStyle = "rgba(90,255,200,.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(tp.x, tp.y);
  ctx.stroke();
  ctx.restore();
}

function updateHUD(){
  $("hudScore").textContent = state.score;
  $("hudStability").textContent = state.stability;
  $("hudRT").textContent = state.rtMs;
  $("hudRound").textContent = state.round;
}

let lastFrame = performance.now();
function loop(now){
  const dt = Math.min(0.05, (now - lastFrame)/1000);
  lastFrame = now;

  if(state.running){
    stepTarget(dt);
  }

  draw();
  requestAnimationFrame(loop);
}

function draw(){
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  drawBackground(w,h);

  const tp = targetPx();
  drawTarget(tp);
  drawGuide(tp);
  drawPath();

  updateHUD();
}

function init(){
  fitCanvas();
  syncUI();
  draw();
  requestAnimationFrame(loop);
  toast("Sẵn sàng ✅");
}

init();
