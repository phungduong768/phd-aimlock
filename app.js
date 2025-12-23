/**
 * PHD Aimlock Trainer v2 (safe training)
 * FULL CONTROL toggles + sliders:
 * - Anti‑Shake: smoothing points
 * - Direction Assist: soft direction lock (project towards guide direction)
 * - Snap Zone: soft "brake" near target zone (reduces overshoot)
 * - Velocity Curve: speed curve (fast early, slower near end)
 * - Pull Limit: cap max travel distance (training only)
 * - Guide: diagonal guide line (percent margin)
 * Overlay can record sessions and export JSON.
 * No game interference.
 */

const $ = (id)=>document.getElementById(id);

// ===== Canvas setup =====
const canvas = $("pad");
const ctx = canvas.getContext("2d");

let DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
function resizeCanvas(){
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * DPR);
  canvas.height = Math.floor(rect.height * DPR);
}
window.addEventListener("resize", ()=>{ resizeCanvas(); draw(); });
resizeCanvas();

// ===== State + UI mapping =====
const ui = {
  start: $("startTest"),
  stop: $("stopTest"),
  reset: $("resetAll"),
  hud: $("hud"),
  result: $("result"),
  ovStat: $("ovStat"),
  chipAS: $("chipAS"),
  chipDA: $("chipDA"),
  chipHS: $("chipHS"),
  chipVC: $("chipVC"),
  overlay: $("overlay"),
  toggleOverlay: $("toggleOverlay"),
  toggleRecord: $("toggleRecord"),
  exportData: $("exportData"),
};

const keys = ["as","da","hs","vc","pl","hg"];
const CFG = {
  running: false,
  // toggles/sliders stored in localStorage
  as_on:false, as_level:35,
  da_on:false, da_level:70,
  hs_on:false, hs_level:45,
  vc_on:false, vc_level:60,
  pl_on:false, pl_level:160,
  hg_on:true,  hg_level:15, // guide margin %
};

function loadCFG(){
  const s = JSON.parse(localStorage.getItem("phd_cfg_v2")||"{}");
  Object.assign(CFG, s);
}
function saveCFG(){
  const out = {};
  for(const k in CFG) if(k!=="running") out[k] = CFG[k];
  localStorage.setItem("phd_cfg_v2", JSON.stringify(out));
}
loadCFG();

function bindControl(prefix, unitFn){
  const on = $(`${prefix}_on`);
  const level = $(`${prefix}_level`);
  const val = $(`${prefix}_val`);

  on.checked = !!CFG[`${prefix}_on`];
  level.value = String(CFG[`${prefix}_level`]);
  val.textContent = unitFn(level.value);

  on.addEventListener("change", ()=>{
    CFG[`${prefix}_on`] = on.checked;
    saveCFG();
    renderChips();
    draw();
  });
  level.addEventListener("input", ()=>{
    CFG[`${prefix}_level`] = Number(level.value);
    val.textContent = unitFn(level.value);
    saveCFG();
    if(prefix==="hg") draw();
  });
}

bindControl("as", (v)=>`${v}%`);
bindControl("da", (v)=>`${v}%`);
bindControl("hs", (v)=>`${v}%`);
bindControl("vc", (v)=>`${v}%`);
bindControl("pl", (v)=>`${v}px`);
bindControl("hg", (v)=>`${v}%`);

function renderChips(){
  ui.chipAS.textContent = `AS: ${CFG.as_on ? "On" : "Off"}`;
  ui.chipDA.textContent = `DA: ${CFG.da_on ? "On" : "Off"}`;
  ui.chipHS.textContent = `HS: ${CFG.hs_on ? "On" : "Off"}`;
  ui.chipVC.textContent = `VC: ${CFG.vc_on ? "On" : "Off"}`;
}
renderChips();

// ===== Overlay recording =====
const scan = {
  overlayOn: localStorage.getItem("overlayOn") !== "0",
  recording: localStorage.getItem("recording")==="1",
  sessions: JSON.parse(localStorage.getItem("sessions") || "[]"),
};
function renderOverlay(){
  ui.overlay.style.display = scan.overlayOn ? "flex" : "none";
  ui.toggleOverlay.textContent = `Overlay: ${scan.overlayOn ? "Bật" : "Tắt"}`;
  ui.toggleRecord.textContent  = `Ghi dữ liệu: ${scan.recording ? "Bật" : "Tắt"}`;
}
renderOverlay();

ui.toggleOverlay.addEventListener("click", ()=>{
  scan.overlayOn = !scan.overlayOn;
  localStorage.setItem("overlayOn", scan.overlayOn ? "1":"0");
  renderOverlay();
});
ui.toggleRecord.addEventListener("click", ()=>{
  scan.recording = !scan.recording;
  localStorage.setItem("recording", scan.recording ? "1":"0");
  ui.ovStat.textContent = scan.recording ? "Đang ghi dữ liệu…" : "Đã tắt ghi";
  renderOverlay();
});
ui.exportData.addEventListener("click", ()=>{
  const payload = {
    exportedAt: new Date().toISOString(),
    cfg: JSON.parse(localStorage.getItem("phd_cfg_v2")||"{}"),
    sessions: scan.sessions.slice(-20),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "phd_aimlock_trainer_data.json";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
});

function saveSession(summary){
  if(!scan.recording) return;
  scan.sessions.push(summary);
  if(scan.sessions.length > 50) scan.sessions = scan.sessions.slice(-50);
  localStorage.setItem("sessions", JSON.stringify(scan.sessions));
}

// ===== Geometry helpers =====
function guideLine(){
  const w = canvas.width, h = canvas.height;
  const margin = Math.max(0.05, Math.min(0.30, (CFG.hg_level||15)/100));
  const x0 = w*margin, y0 = h*(1-margin);
  const x1 = w*(1-margin), y1 = h*margin;
  const ax = x1-x0, ay = y1-y0;
  const len = Math.hypot(ax,ay) || 1;
  return {x0,y0,x1,y1, ux:ax/len, uy:ay/len};
}
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

// ===== Processing pipeline =====
function antiShakeAlpha(){
  // 0..100 => 0.55..0.18 (higher level = stronger smoothing)
  const t = clamp(CFG.as_level/100, 0, 1);
  return 0.55 - t*0.37;
}
function smoothPoints(pts, alpha){
  if(!pts || pts.length<2) return pts || [];
  let sx=pts[0].x, sy=pts[0].y;
  const out = [];
  for(const p of pts){
    sx = sx + alpha*(p.x - sx);
    sy = sy + alpha*(p.y - sy);
    out.push({x:sx, y:sy, t:p.t});
  }
  return out;
}

function applyDirectionAssist(pts){
  if(!CFG.da_on || pts.length<2) return pts;
  const g = guideLine();
  const strength = clamp(CFG.da_level/100, 0, 1); // 0..1
  const out = [pts[0]];
  for(let i=1;i<pts.length;i++){
    const prev = out[i-1];
    const cur = pts[i];

    const vx = cur.x - prev.x;
    const vy = cur.y - prev.y;
    // project movement onto guide direction
    const proj = vx*g.ux + vy*g.uy;
    const px = proj*g.ux;
    const py = proj*g.uy;

    // blend between original delta and projected delta
    const nx = prev.x + (vx*(1-strength) + px*strength);
    const ny = prev.y + (vy*(1-strength) + py*strength);
    out.push({x:nx, y:ny, t:cur.t});
  }
  return out;
}

function applyPullLimit(pts){
  if(!CFG.pl_on || pts.length<2) return pts;
  const maxD = Math.max(40, Number(CFG.pl_level||160)) * DPR;
  const x0 = pts[0].x, y0 = pts[0].y;
  const out = [pts[0]];
  for(let i=1;i<pts.length;i++){
    const p = pts[i];
    const dx = p.x - x0, dy = p.y - y0;
    const d = Math.hypot(dx,dy);
    if(d <= maxD){
      out.push(p);
    }else{
      const s = maxD / (d||1);
      out.push({x:x0 + dx*s, y:y0 + dy*s, t:p.t});
      break;
    }
  }
  return out;
}

function applyVelocityCurve(pts){
  if(!CFG.vc_on || pts.length<3) return pts;
  // Build a new point list where later segments are slightly "slower" (denser points)
  // This is training-only visual + analysis effect, not OS-level.
  const curve = clamp(CFG.vc_level/100, 0, 1);
  const out = [pts[0]];
  for(let i=1;i<pts.length;i++){
    const a = pts[i-1], b = pts[i];
    // progress 0..1
    const t = i/(pts.length-1);
    // more subdivisions near end as curve increases
    const n = 1 + Math.floor(curve * 6 * t);
    for(let k=1;k<=n;k++){
      const s = k/n;
      out.push({x:a.x + (b.x-a.x)*s, y:a.y + (b.y-a.y)*s, t:b.t});
    }
  }
  return out;
}

function applySnapZone(pts){
  if(!CFG.hs_on || pts.length<2) return pts;
  const g = guideLine();
  const strength = clamp(CFG.hs_level/100, 0, 1);
  // define "target zone" near upper segment of guide line
  const w = canvas.width, h = canvas.height;
  const tx = g.x0 + (g.x1-g.x0)*0.78;
  const ty = g.y0 + (g.y1-g.y0)*0.78;
  const radius = (Math.min(w,h) * 0.08) * (0.6 + strength*0.9); // stronger => larger influence radius

  const out = [];
  for(const p of pts){
    const dx = tx - p.x, dy = ty - p.y;
    const d = Math.hypot(dx,dy);
    if(d < radius){
      // brake: pull slightly toward target but not snap hard
      const k = (1 - d/radius) * 0.35 * strength;
      out.push({x:p.x + dx*k, y:p.y + dy*k, t:p.t});
    }else out.push(p);
  }
  return out;
}

function processStroke(stroke){
  let pts = stroke;
  if(CFG.as_on) pts = smoothPoints(pts, antiShakeAlpha());
  pts = applyDirectionAssist(pts);
  pts = applyPullLimit(pts);
  pts = applyVelocityCurve(pts);
  pts = applySnapZone(pts);
  return pts;
}

// ===== Drawing =====
function draw(){
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  // grid
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "rgba(255,255,255,.12)";
  ctx.lineWidth = 1 * DPR;
  const step = 60 * DPR;
  for(let x=0; x<w; x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let y=0; y<h; y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  ctx.restore();

  const g = guideLine();

  // guide line
  if(CFG.hg_on){
    ctx.save();
    ctx.strokeStyle = "rgba(120,170,255,.55)";
    ctx.lineWidth = 3 * DPR;
    ctx.setLineDash([10*DPR, 10*DPR]);
    ctx.beginPath(); ctx.moveTo(g.x0,g.y0); ctx.lineTo(g.x1,g.y1); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // target zone circle (visual)
  if(CFG.hs_on){
    const tx = g.x0 + (g.x1-g.x0)*0.78;
    const ty = g.y0 + (g.y1-g.y0)*0.78;
    const strength = clamp(CFG.hs_level/100, 0, 1);
    const radius = (Math.min(w,h) * 0.08) * (0.6 + strength*0.9);
    ctx.save();
    ctx.strokeStyle = "rgba(120,255,190,.45)";
    ctx.lineWidth = 2 * DPR;
    ctx.beginPath(); ctx.arc(tx,ty,radius,0,Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  // strokes
  ctx.save();
  ctx.lineCap="round"; ctx.lineJoin="round";
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = 4 * DPR;

  for(const s of strokes){
    const pts = processStroke(s);
    if(pts.length<2) continue;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

// ===== Input capture =====
let strokes = [];
let curStroke = [];
let down = false;

function posFromEvent(e){
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x:(clientX-rect.left)*DPR, y:(clientY-rect.top)*DPR };
}
function onDown(e){
  if(!CFG.running) return;
  down = true;
  curStroke = [];
  const p = posFromEvent(e);
  curStroke.push({x:p.x,y:p.y,t:performance.now()});
  e.preventDefault?.();
}
function onMove(e){
  if(!CFG.running || !down) return;
  const p = posFromEvent(e);
  curStroke.push({x:p.x,y:p.y,t:performance.now()});
  draw();
  e.preventDefault?.();
}
function onUp(e){
  if(!CFG.running || !down) return;
  down = false;
  if(curStroke.length>2) strokes.push(curStroke);
  curStroke = [];
  draw();
  e.preventDefault?.();
}

canvas.addEventListener("pointerdown", onDown);
canvas.addEventListener("pointermove", onMove);
canvas.addEventListener("pointerup", onUp);
canvas.addEventListener("pointercancel", onUp);
canvas.addEventListener("touchstart", onDown, {passive:false});
canvas.addEventListener("touchmove", onMove, {passive:false});
canvas.addEventListener("touchend", onUp, {passive:false});

// ===== Analysis =====
function analyze(){
  if(!strokes.length){
    ui.result.textContent = "Chưa có dữ liệu. Nhấn “Bắt đầu test” và vuốt 2–3 vòng.";
    return;
  }
  const g = guideLine();

  // distance to guide line
  function perpDist(p){
    const vx = p.x - g.x0;
    const vy = p.y - g.y0;
    const s = vx*g.ux + vy*g.uy;
    const cx = g.x0 + s*g.ux;
    const cy = g.y0 + s*g.uy;
    return Math.hypot(p.x-cx, p.y-cy);
  }

  let all = [];
  for(const s of strokes){
    const pts = processStroke(s);
    all = all.concat(pts);
  }

  const dists = all.map(perpDist);
  const mean = dists.reduce((a,b)=>a+b,0)/dists.length;
  const varr = dists.reduce((a,b)=>a+(b-mean)*(b-mean),0)/dists.length;
  const std = Math.sqrt(varr);

  const norm = Math.max(1, canvas.width*0.02);
  let score = 100 - (std/norm)*35 - (mean/norm)*15;
  score = clamp(score, 0, 100);

  const text = [
    "KẾT QUẢ TRAINER (safe)",
    `• Strokes: ${strokes.length}`,
    `• Mean lệch: ${mean.toFixed(1)} px`,
    `• Độ rung (std): ${std.toFixed(1)} px`,
    `• Điểm ổn định: ${score.toFixed(0)}/100`,
    "",
    "CẤU HÌNH ĐANG DÙNG:",
    `• Anti‑Shake: ${CFG.as_on ? "On" : "Off"} (${CFG.as_level}%)`,
    `• Direction Assist: ${CFG.da_on ? "On" : "Off"} (${CFG.da_level}%)`,
    `• Snap Zone: ${CFG.hs_on ? "On" : "Off"} (${CFG.hs_level}%)`,
    `• Velocity Curve: ${CFG.vc_on ? "On" : "Off"} (${CFG.vc_level}%)`,
    `• Pull Limit: ${CFG.pl_on ? "On" : "Off"} (${CFG.pl_level}px)`,
    "",
    "GỢI Ý LUYỆN:",
    "- Nếu hay lệch hướng: tăng Direction Assist 5–10%.",
    "- Nếu hay quá tay: bật Pull Limit + tăng Snap 5–10%.",
    "- Nếu tay rung: bật Anti‑Shake 30–45%.",
  ].join("\n");

  ui.result.textContent = text;

  saveSession({
    t: Date.now(),
    mean: Number(mean.toFixed(2)),
    std: Number(std.toFixed(2)),
    score: Number(score.toFixed(0)),
    cfg: {
      as_on:CFG.as_on, as_level:CFG.as_level,
      da_on:CFG.da_on, da_level:CFG.da_level,
      hs_on:CFG.hs_on, hs_level:CFG.hs_level,
      vc_on:CFG.vc_on, vc_level:CFG.vc_level,
      pl_on:CFG.pl_on, pl_level:CFG.pl_level,
      hg_on:CFG.hg_on, hg_level:CFG.hg_level,
    }
  });
}

// ===== Buttons =====
ui.start.addEventListener("click", ()=>{
  strokes = [];
  CFG.running = true;
  ui.hud.textContent = "Đang chạy: vuốt trong khung…";
  ui.ovStat.textContent = scan.recording ? "Đang ghi dữ liệu…" : "Đang chạy";
  draw();
});
ui.stop.addEventListener("click", ()=>{
  CFG.running = false;
  ui.hud.textContent = "Đã dừng";
  ui.ovStat.textContent = "Đã dừng";
  analyze();
  draw();
});
ui.reset.addEventListener("click", ()=>{
  strokes = [];
  CFG.running = false;
  ui.hud.textContent = "Đã reset";
  ui.result.textContent = "Chưa có dữ liệu. Nhấn “Bắt đầu test”.";
  ui.ovStat.textContent = "Chưa chạy";
  draw();
});

draw();
