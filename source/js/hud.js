/* hud: 자비스형 홀로그램 HUD. 원리: docs/13-how-and-why.md
 * 2026-09-29 개편 (사용자 결정): 핀치 클릭만 사용, 학습 내용은 개념 그래프(기초 학문 ↔ 논문 연결), 글자·패널 크게.
 *
 *  3D 코어    (2026-09-30 사용자 결정) 코어 링·칩 대신 논문 44편의 은하 (js/paper-galaxy.js). 편 손 좌우로 돌리고
 *              (초기 화면에서만), 앞의 조준 카드에 온 논문을 핀치하면 로드된다. 위쪽 연구 주제 분류는 삭제.
 *              손 동작 원칙 (9/30 사용자): 돌리기 = 편 손 좌우, 선택 = 핀치, 뒤로 = 주먹
 *  논문 패널   왼쪽 = 논문 요약 · 학습 경로 · 중심 개념 / 오른쪽 = 기초 개념 · 전공 개념 · 관련 논문.
 *              패널을 핀치하면 가운데로 커지고 상세 창이 뜬다. 상세 창의 ◀ ▶는 요약 → 경로 → 개념 카드(공부 순서) → 관련 논문.
 *  연결        개념 카드 안의 개념 버튼(선수·응용)과 논문 버튼으로 개념 ↔ 논문을 오간다.
 *  층 구조     논문을 고른 뒤 손바닥을 펴면(또는 카드를 한 번 더 핀치) 학습 경로가 연구 기법 · 전공 · 기초 층으로 펼쳐지고,
 *              이어서 좌우 패널이 뒤에 펼쳐진다 (9/30 사용자: 가운데가 먼저, 사이드는 그 뒤). 펼친 뒤 편 손 좌우 = 층 회전.
 *              노드를 핀치하면 그 개념 카드. 구현은 A-Frame 컴포넌트로 분리 (js/concept-stack.js: concept-stack · stack-layer · concept-node).
 *              이 파일은 논문이 바뀔 때 setPath / clear, 화면 상태(visibility·interactive·highlight)만 알려 준다.
 *  되돌리기    상세 창의 "돌아가기", 빈 곳 핀치 없음(오작동 방지), 키보드 Esc = 한 단계 뒤로.
 *
 * 입력(hand-cursor): 대상에 pinchstart, scene에 pinchend-any / close-all
 * 출력: papers-loaded, hud-hover {text}, hud-focus {code, title, ctx, html, index, total}, hud-unfocus, hud-log {msg}
 * 조작 API(index.html이 부름): unfocus(), focusStep(i), openConcept(id), openPaper(id)
 */

const HUD = {
  cyan: "#3fd0f0", cyan2: "#9ff3ff", text: "#d4f3fb", muted: "#8fbccb",
  line: "rgba(63,208,240,0.38)", panel: "rgba(5,20,30,0.88)",
};
const FT = "'Rajdhani', 'IBM Plex Sans KR', sans-serif"; // 숫자·영문 (테크 서체)
const FK = "'IBM Plex Sans KR', 'Rajdhani', sans-serif"; // 한글 본문

// 패널·카드는 같은 비율의 캔버스 (상세 창도 같은 비율이라 "그 패널이 읽을 수 있게 커진" 것처럼 보임)
const SHEET_CW = 1040, SHEET_CH = 560, SHEET_RATIO = SHEET_CW / SHEET_CH;
const PANEL_W = 1.38; // 가독성: 이전 1.0 에서 키움
// 사용자 결정 (2026-09-29): 좌우 2장씩 크게. 왼쪽 = 논문 요약 · 학습 경로, 오른쪽 = 필요한 개념(L1·L2·L3) · 관련 논문
const PAPER_LEFT = [["summary", "논문 요약"], ["path", "학습 경로"]];
const PAPER_RIGHT = [["concepts", "필요한 개념"], ["related", "관련 논문"]];
// 화면 가장자리의 HTML 상자(왼쪽 위 정보, 아래 안내·버튼) 높이(px). 패널은 그 사이에만 놓아 가려지지 않게
const UI_TOP = 170, UI_BOTTOM = 110;
// 손바닥 펴기 = 층 펼치기 (9/30): 편 정도 기준, 유지 시간(ms), 층이 펼쳐지고 좌우 패널이 뜨기까지(ms)
const PALM_OPEN = 0.5, PALM_HOLD = 200, PANELS_AFTER = 900;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => t * t * (3 - 2 * t);

function canvasOf(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function texOf(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function flatMesh(geo, map, opacity = 1) {
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false }));
}
// 투명 히트 영역. 보이는 그림보다 크게 잡아 손 떨림에도 겨누기 쉽게 (Meta 최소 타깃 권고)
function hitMesh(w, h) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
}

function fit(g, s, maxW) {
  s = String(s ?? "");
  if (g.measureText(s).width <= maxW) return s;
  while (s.length > 1 && g.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}
// 단어 단위로 줄바꿈, 한 단어가 너무 길면 글자 단위. 넘치면 마지막 줄에 말줄임
function wrapLines(g, text, maxW, maxLines) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = []; let cur = ""; let overflow = false;
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width <= maxW) { cur = t; continue; }
    if (cur) { lines.push(cur); cur = ""; }
    if (g.measureText(w).width <= maxW) cur = w;
    else for (const ch of w) { if (g.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ""; } cur += ch; }
    if (lines.length >= maxLines) { overflow = true; cur = ""; break; }
  }
  if (cur) { if (lines.length < maxLines) lines.push(cur); else overflow = true; }
  lines.length = Math.min(lines.length, maxLines);
  if (overflow && lines.length) {
    let l = lines[lines.length - 1];
    while (l.length > 1 && g.measureText(l + "…").width > maxW) l = l.slice(0, -1);
    lines[lines.length - 1] = l + "…";
  }
  return lines;
}
function brackets(g, x, y, w, h, L, color, lw) {
  g.strokeStyle = color; g.lineWidth = lw; g.beginPath();
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    g.moveTo(cx + sx * L, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + sy * L);
  }
  g.stroke();
}

// ---------- 그림: 패널·카드 한 장 (글자를 크게: 제목 48px, 본문 42px, 최대 6줄) ----------
function drawSheet(c, { code, title, para, list, hint, empty }) {
  const g = c.getContext("2d"), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = HUD.panel; g.fillRect(8, 8, W - 16, H - 16);
  g.strokeStyle = HUD.line; g.lineWidth = 2; g.strokeRect(8, 8, W - 16, H - 16);
  brackets(g, 8, 8, W - 16, H - 16, 44, HUD.cyan, 6);
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.fillStyle = HUD.cyan; g.font = `700 42px ${FT}`; g.fillText(code, 38, 74);
  const cw = g.measureText(code).width;
  g.fillStyle = HUD.text; g.font = `600 56px ${FK}`; g.fillText(fit(g, title, W - 130 - cw), 38 + cw + 22, 78);
  g.strokeStyle = HUD.line; g.lineWidth = 2; g.beginPath(); g.moveTo(34, 106); g.lineTo(W - 34, 106); g.stroke();
  const x0 = 38, maxW = W - 76, LH = 70; // 줄 간격 넓게 (글자 40px의 1.75배)
  const maxLines = Math.max(2, Math.floor((H - 170 - 90) / LH) + 1); // 캔버스 높이에 맞춰 줄 수
  let y = 172;
  g.font = `400 40px ${FK}`;
  if (para) {
    g.fillStyle = HUD.text;
    for (const l of wrapLines(g, para, maxW, maxLines)) { g.fillText(l, x0, y); y += LH; }
  } else if (list?.length) {
    const shown = list.slice(0, list.length > maxLines ? maxLines - 1 : maxLines);
    for (const item of shown) {
      g.fillStyle = HUD.cyan; g.fillRect(x0, y - 22, 12, 12);
      g.fillStyle = HUD.text; g.fillText(fit(g, item, maxW - 34), x0 + 34, y); y += LH;
    }
    if (list.length > shown.length) { g.fillStyle = HUD.muted; g.fillText(`+ ${list.length - shown.length}개 더`, x0 + 30, y); }
  } else { g.fillStyle = HUD.muted; for (const l of wrapLines(g, empty ?? "(준비 중)", maxW, 2)) { g.fillText(l, x0, y); y += LH; } }
  g.fillStyle = HUD.cyan2; g.font = `600 38px ${FK}`;
  g.fillText(hint ?? "핀치하면 크게 보기", 38, H - 36);
}

async function ensureHudFonts() {
  try {
    await Promise.all([
      document.fonts.load(`700 40px 'Rajdhani'`), document.fonts.load(`600 40px 'Rajdhani'`),
      document.fonts.load(`400 42px 'IBM Plex Sans KR'`), document.fonts.load(`600 48px 'IBM Plex Sans KR'`),
    ]);
  } catch {}
}

AFRAME.registerComponent("hud", {
  schema: {
    src: { default: "data/papers.json" },
    depth: { default: -2.6 },     // 패널이 펼쳐지기 시작하는 자리·층 구조 거리
    centerY: { default: 1.5 },    // 코어 높이 (= 눈높이)
    radius: { default: 1.05 },    // (예전 코어 링 반지름) 패널 크기·자리를 바꾸지 않으려고 같은 값으로 계산
  },

  async init() {
    const d = this.data;
    const json = await (await fetch(d.src)).json();
    this.papers = [...json.papers].sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || (a.date ?? "").localeCompare(b.date ?? ""));
    this.papersById = Object.fromEntries(this.papers.map((p) => [p.id, p]));
    this.author = json.author?.name || "";
    this.el.emit("papers-loaded", { author: json.author, count: this.papers.length, source: json.source, papers: this.papers });
    await ensureHudFonts();
    if (!this.el.sceneEl.hasLoaded) await new Promise((r) => this.el.sceneEl.addEventListener("loaded", r, { once: true }));
    this.graph = await StudyPanel.loadGraph();
    this.users = await StudyPanel.conceptUsers(this.papers.map((p) => p.id)); // 개념 → 그 개념을 쓰는 논문들
    this.paperTitle = (id) => this.papersById[id] ? `${this.papersById[id].year} · ${this.papersById[id].title}` : id;

    this.camEl = document.getElementById("camera");
    this.rayEl = document.getElementById("ray");
    this.cam = this.camEl.getObject3D("camera");
    this.center = new THREE.Vector3(0, d.centerY, d.depth);
    this.focusPos = new THREE.Vector3(0, d.centerY, -1.4);
    this.tmp = new THREE.Vector3();
    this.paper = null; this.pathRec = null;
    this.view = null; // 상세 창: { kind: 'paper', steps: [{key,label,render}], i }
    this.focusFan = null; this.press = null; this.hovEl = null;
    this.stackEl = document.getElementById("stack"); // index.html에 선언한 층 구조 (concept-stack.js)

    this.paperFan = this.makeFan("panel", [...PAPER_LEFT, ...PAPER_RIGHT].map(([key, label]) => ({ key, label, pos: new THREE.Vector3(), rotY: 0 })), PANEL_W, 3);
    this.paperFan.origin.copy(this.center);
    this.layoutPaperFan();
    // 창 크기가 바뀌면 패널 크기·자리·캔버스 비율을 다시 맞춤 (비율이 어긋나면 글자가 옆으로 늘어나 보임)
    let rt = null;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { this.layoutPaperFan(); this.redrawPanels(); }, 200); });

    const sc = this.el.sceneEl;
    sc.addEventListener("close-all", () => this.back());
    // 층 구조 쪽 이벤트: 개념 노드 핀치 → 그 개념 카드
    sc.addEventListener("concept-select", (e) => {
      const i = this.paperSteps.findIndex((st) => st.concept === e.detail.concept);
      if (i >= 0) this.showSteps("paper", this.paperSteps, i, this.paperFan);
    });
    // 조준 카드 핀치: 다른 논문이면 로드하고 '손바닥 펴기'를 기다림. 이미 고른 논문이면 층 펼치기·접기 (손바닥 인식이 안 될 때의 예비)
    sc.addEventListener("paper-select", (e) => {
      if (this.paper?.id !== e.detail.id) { this.loadPaper(e.detail.id); this.armPalm = true; this.palmT = null; return; }
      if (this.stack().uTarget > 0) this.foldStack(); else this.openStack();
    });
    sc.addEventListener("hud-hit-dirty", () => (this.hitDirty = true));
    this.galaxy()?.setPapers(this.papers, this.users); // 3D 코어: 논문 은하 (연도 나선)
    this.hitDirty = true;
    this.ready = true;
  },

  hc() { return this.el.sceneEl.components["hand-cursor"]; },

  ent(obj, pos) {
    const e = document.createElement("a-entity");
    this.el.appendChild(e);
    e.setObject3D("mesh", obj);
    if (pos) e.object3D.position.copy(pos);
    return e;
  },
  // 레이 대상 여부는 class로만 바꾼다 (three.js 레이캐스트는 숨긴 메시도 맞히므로 visible로는 막을 수 없음)
  setHit(el, on) {
    if (el.classList.contains("target") === on) return;
    el.classList.toggle("target", on);
    this.hitDirty = true;
  },
  hittable(el, kind, label) {
    el.hudKind = kind; el.hudLabel = label;
    el.addEventListener("pinchstart", () => this.onPinchStart(el));
    el.setAttribute("press-feedback", ""); // 누른 순간 번쩍 (hand-cursor.js)
    this.setHit(el, true);
  },

  // ---------- 펼침 묶음(fan): 논문 패널 4장 ----------
  facing(x, z) { return Math.atan2(-x, -z) * 0.8; },
  halfWidthAt(z) { return Math.abs(z) * Math.tan(THREE.MathUtils.degToRad(this.cam.fov) / 2) * this.cam.aspect; },
  // 논문 패널 4장의 크기·자리: (예전) 코어 링 바깥 ~ 화면 가장자리, 위아래 HTML 상자 사이를 채움. 패널은 정면을 봄(글자 왜곡 없음)
  layoutPaperFan() {
    const fan = this.paperFan, z = this.data.depth + 0.2, dist = Math.abs(z);
    const hh = dist * Math.tan(THREE.MathUtils.degToRad(this.cam.fov) / 2), H = innerHeight || 900;
    const topY = this.data.centerY + hh - (UI_TOP / H) * 2 * hh;
    const botY = this.data.centerY - hh + (UI_BOTTOM / H) * 2 * hh;
    const outer = hh * this.cam.aspect - 0.1;
    let inner = (this.data.radius + 0.3) * dist / Math.abs(this.data.depth) + 0.08; // 링의 화면상 바깥
    let w = Math.min(outer - inner, 1.9);
    if (w < 1.0) { w = 1.0; inner = outer - w; } // 좁은 창: 링과 조금 겹쳐도 패널 크기를 지킴
    const gap = 0.07, h = Math.min((topY - botY - gap) / 2, w * 0.85);
    const x = inner + w / 2, y1 = topY - h / 2, y2 = y1 - h - gap;
    const slots = { summary: [-x, y1], path: [-x, y2], concepts: [x, y1], related: [x, y2] };
    const CW = 1000, CH = Math.round(CW * h / w);
    for (const it of fan.items) {
      it.slot.set(slots[it.key][0], slots[it.key][1], z); it.rotY = 0;
      it.mesh.geometry.dispose(); it.mesh.geometry = new THREE.PlaneGeometry(w, h);
      if (it.cv.width !== CW || it.cv.height !== CH) { it.cv.width = CW; it.cv.height = CH; it.tex.dispose(); it.tex = texOf(it.cv); it.mesh.material.map = it.tex; it.mesh.material.needsUpdate = true; }
    }
    const visH = 2 * Math.abs(this.focusPos.z) * Math.tan(THREE.MathUtils.degToRad(this.cam.fov) / 2);
    fan.focusScale = (0.82 * visH) / h;
    this.panelSize = { w, h };
  },
  makeFan(kind, slots, w, order) {
    const h = w / SHEET_RATIO;
    const visH = 2 * Math.abs(this.focusPos.z) * Math.tan(THREE.MathUtils.degToRad(this.cam.fov) / 2);
    const fan = { kind, items: [], u: 0, uTarget: 0, dim: 0, dimTarget: 0, focused: null,
      origin: new THREE.Vector3(), focusScale: (0.82 * visH) / h }; // 가까이 보기 = 화면 높이의 82% (상세 창과 같은 크기)
    slots.forEach((s, i) => {
      const cv = canvasOf(SHEET_CW, SHEET_CH), tex = texOf(cv);
      const mesh = flatMesh(new THREE.PlaneGeometry(w, h), tex, 0); mesh.renderOrder = order;
      const el = this.ent(mesh);
      el.object3D.visible = false;
      const item = { el, mesh, cv, tex, key: s.key, label: s.label, slot: s.pos, rotY: s.rotY, i, stepIndex: -1, order,
        cur: { pos: new THREE.Vector3(), s: 0.02, rot: 0, op: 0 } };
      el.hudItem = item; el.hudFan = fan; el.hudKind = kind; el.hudLabel = s.label;
      el.addEventListener("pinchstart", () => this.onPinchStart(el));
      el.setAttribute("press-feedback", "");
      fan.items.push(item);
    });
    return fan;
  },
  tickFan(fan, dt) {
    const a = 1 - Math.exp(-dt / 90);
    fan.u += (fan.uTarget - fan.u) * (1 - Math.exp(-dt / 110));
    fan.dim += (fan.dimTarget - fan.dim) * a;
    const n = fan.items.length;
    for (const it of fan.items) {
      const e = ease(clamp01(fan.u * 1.35 - (it.i / n) * 0.35)); // 하나씩 차례로 펼쳐짐
      const pos = this.tmp.copy(fan.origin).lerp(it.slot, e);
      let s = 0.02 + 0.98 * e, rot = it.rotY * e, op = e * (1 - fan.dim);
      if (it.stepIndex < 0) op *= 0.35;
      // 가운데로 다가온 패널은 상세 창이 덮은 뒤 사라짐 (창 뒤로 글자가 비쳐 읽기 방해)
      if (fan.focused === it) { pos.copy(this.focusPos); s = fan.focusScale; rot = 0; op = performance.now() - this.focusAt > 450 ? 0 : 1; }
      else if (this.focusFan) op *= 0.12;
      else if (this.hovEl === it.el) s *= 1.04;
      it.cur.pos.lerp(pos, a); it.cur.s += (s - it.cur.s) * a; it.cur.rot += (rot - it.cur.rot) * a; it.cur.op += (op - it.cur.op) * a;
      const o3 = it.el.object3D;
      o3.position.copy(it.cur.pos); o3.scale.setScalar(it.cur.s); o3.rotation.y = it.cur.rot;
      o3.visible = it.cur.op > 0.02;
      it.mesh.material.opacity = it.cur.op;
      it.mesh.renderOrder = fan.focused === it ? 10 : it.order;
      this.setHit(it.el, e > 0.9 && fan.dim < 0.5 && !this.focusFan && it.stepIndex >= 0);
    }
  },

  // ---------- 논문 로드: 학습 경로 → 패널·상세 단계 ----------
  async loadPaper(id, openSummary = false) {
    const p = this.papersById[id];
    if (!p) return;
    this.unfocus();
    if (this.paper !== p) {
      this.paper = p; this.pathRec = null; this.paperSteps = []; this.pathConcepts = [];
      this.stack().clear();
      // (9/30 사용자) 가운데 층 구조가 먼저, 좌우 패널은 그 뒤에: 카드로 고른 논문은 층이 펼쳐진 뒤(openStack) 패널을 펼친다
      this.paperFan.u = 0; this.paperFan.uTarget = openSummary ? 1 : 0;
      this.redrawPanels();
      this.galaxy()?.setSelected(p.id, []);
      this.el.emit("hud-log", { msg: `논문: ${p.title.slice(0, 40)}` });
      const rec = await StudyPanel.fetchPath(id);
      if (this.paper !== p) return;
      this.pathRec = rec;
      this.buildPaperSteps();
      // 펼치기가 경로 도착보다 먼저 시작돼도 이어서 펼쳐지게 펼침·회전 상태는 유지
      const st = this.stack(), keep = { u: st.u, uTarget: st.uTarget, yaw: st.yaw, yawTarget: st.yawTarget };
      st.setPath(this.pathConcepts, rec?.core);
      this.galaxy()?.setSelected(p.id, this.pathConcepts.map((c) => c.id)); // 은하에서 이 논문의 개념이 밝아지고 빛줄기
      Object.assign(st, keep);
      this.redrawPanels();
    } else this.paperFan.uTarget = 1;
    if (openSummary) this.showSteps("paper", this.paperSteps, 0, this.paperFan);
  },
  buildPaperSteps() {
    const p = this.paper, rec = this.pathRec, g = this.graph;
    const ctx = { paperId: p.id, users: this.users, paperTitle: this.paperTitle };
    const steps = [
      { key: "summary", label: "논문 요약", render: () => StudyPanel.summaryHtml(p, rec) },
      { key: "path", label: "학습 경로", render: () => StudyPanel.pathHtml(rec) },
    ];
    const path = StudyPanel.topDown(rec, g); // L3 → L2 → L1 (top-down)
    path.forEach((s, i) => steps.push({ key: `c:${s.concept}`, concept: s.concept, label: `경로 ${i + 1}/${path.length} · ${g.byId[s.concept].name}`,
      render: () => StudyPanel.conceptHtml(s.concept, { ...ctx, role: s.role }) }));
    steps.push({ key: "related", label: "관련 논문", render: () => StudyPanel.relatedHtml(p, rec, ctx) });
    this.paperSteps = steps;
    this.pathConcepts = path.map((s) => g.byId[s.concept]);
  },
  redrawPanels() {
    const rec = this.pathRec, steps = this.paperSteps || [], cs = this.pathConcepts || [];
    const firstOf = (pred) => steps.findIndex((s) => s.concept && pred(this.graph.byId[s.concept]));
    const core = new Set(rec?.core || []);
    for (const it of this.paperFan.items) {
      let content = {}, idx = -1;
      if (!this.paper) content = { para: "" };
      else if (!rec) content = { para: "학습 경로 준비 중" };
      else switch (it.key) {
        case "summary": idx = 0; content = { para: rec.summary }; break;
        case "path": idx = 1; content = { list: cs.map((c, i) => `${i + 1}. ${c.name}`) }; break;
        // 필요한 개념: 중심(L3) → 전공(L2) → 기초(L1) 순으로 이름만. 핀치하면 경로의 첫 개념 카드부터
        case "concepts": idx = firstOf(() => true); content = { list: [3, 2, 1].flatMap((lv) => cs.filter((c) => c.level === lv).map((c) => `L${lv} ${c.name}${core.has(c.id) ? "  ★" : ""}`)) }; break;
        case "related": idx = steps.length - 1; content = { list: this.relatedTitles(), empty: "같은 개념을 쓰는 다른 논문이 아직 없음" }; break;
      }
      it.stepIndex = idx;
      drawSheet(it.cv, { code: { summary: "P", path: "PATH", concepts: "C", related: "REL" }[it.key], title: it.label, ...content });
      it.tex.needsUpdate = true;
    }
  },
  relatedTitles() {
    const mine = new Set((this.pathRec?.path || []).map((s) => s.concept)), shared = {};
    for (const id of mine) for (const u of this.users?.[id] || []) if (u.paperId !== this.paper.id) shared[u.paperId] = (shared[u.paperId] || 0) + 1;
    return Object.entries(shared).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => `${this.papersById[id]?.title} (공통 ${n})`);
  },
  unload() { this.armPalm = false; this.panelsAt = null; this.paper = null; this.pathRec = null; this.paperSteps = []; this.paperFan.uTarget = 0; this.stack().clear(); this.galaxy()?.setSelected(null); },
  stack() { return this.stackEl.components["concept-stack"]; },
  galaxy() { return document.getElementById("galaxy")?.components["paper-galaxy"]; },


  // ---------- 상세 창 ----------
  showSteps(kind, steps, i, fan) {
    this.view = { kind, steps: [...steps], i: -1, fan }; // 복사본: openConcept가 끼워 넣어도 패널의 단계 번호가 어긋나지 않게 (코드 검토 9/30)
    this.focusStep(i);
  },
  async focusStep(i) {
    const v = this.view, step = v?.steps[i];
    if (!step) return;
    v.i = i;
    // 이 단계에 해당하는 패널이 있으면 그 패널이 가운데로 (없으면 지금 패널을 그대로)
    const item = v.fan.items.find((it) => it.stepIndex === i) || v.fan.focused || v.fan.items[0];
    if (this.focusFan && this.focusFan !== v.fan) this.focusFan.focused = null;
    if (!this.focusFan) this.focusAt = performance.now(); // 상세 창이 처음 열린 시각 (단계 이동 중엔 그대로)
    v.fan.focused = item; this.focusFan = v.fan;
    this.lockRay(true);
    const html = await step.render();
    if (this.view !== v || v.i !== i) return;
    const esc = StudyPanel.esc;
    const title = this.paper?.title;
    this.el.emit("hud-focus", { code: `${i + 1}/${v.steps.length}`, title: `${step.label}`, ctx: esc(title || ""), html, index: i, total: v.steps.length });
  },
  unfocus() {
    if (!this.focusFan) return;
    this.focusFan.focused = null;
    this.focusFan = null; this.view = null;
    this.lockRay(false);
    this.el.emit("hud-unfocus");
  },
  // 상세 창 안의 개념 버튼: 지금 단계 목록에 있으면 그리로, 없으면 바로 다음에 끼워 넣고 이동
  openConcept(cid) {
    const v = this.view;
    if (!v) return;
    let i = v.steps.findIndex((s) => s.concept === cid);
    if (i < 0) {
      const c = this.graph.byId[cid];
      if (!c) return;
      const ctx = { paperId: this.paper?.id, users: this.users, paperTitle: this.paperTitle };
      v.steps.splice(v.i + 1, 0, { key: `c:${cid}`, concept: cid, label: `연결 개념 · ${c.name}`, render: () => StudyPanel.conceptHtml(cid, ctx) });
      i = v.i + 1;
    }
    this.focusStep(i);
  },
  // 상세 창 안의 논문 버튼: 그 논문을 로드하고(은하도 그 논문으로 돌아감) 요약부터
  openPaper(pid) { this.galaxy()?.focusPaper(pid); this.loadPaper(pid, true); },
  lockRay(on) {
    this.rayEl.setAttribute("raycaster", "objects", on ? ".hud-locked" : ".target, .blocker"); // .blocker = 앞을 가리는 물체 (z-버퍼처럼 뒤를 막음)
    this.rayEl.components.raycaster?.refreshObjects();
    const hc = this.hc(); if (hc) { hc.target = null; hc.rayHit = null; }
  },

  // ---------- 입력: 핀치 클릭 ----------
  // 손가락이 붙는 순간 바로 실행 (마우스는 누르는 순간). 예전엔 손을 뗄 때 판정하고 0.6초 넘게 쥐면 무시해서
  // 실제 손에서 클릭이 자주 씹혔음 (사용자 보고). 끌기가 없어졌으니 구분할 필요도 없음
  onPinchStart(el) {
    if (!this.ready) return;
    const k = el.hudKind;
    // 논문 고르기는 조준 카드(paper-galaxy.js)가 paper-select로 알림. 여기서는 패널만
    if (k === "panel") this.showSteps("paper", this.paperSteps, el.hudItem.stepIndex, this.paperFan);
  },
  // 가운데 층 구조를 펼치고, 그다음 좌우 패널을 뒤에 펼침
  openStack() {
    if (!this.paper) return;
    this.armPalm = false; this.palmT = null;
    this.stack().open();
    if (this.paperFan.uTarget === 0) this.panelsAt = performance.now() + PANELS_AFTER;
  },
  foldStack() { this.stack().fold(); this.panelsAt = null; this.armPalm = false; },
  // 주먹·Esc: 한 단계 뒤로. 층과 좌우 패널은 손바닥 한 번에 같이 펼쳐지므로 닫을 때도 같이 (10/1 영상: 패널만 남는 단계가 주먹 한 번을 더 씀)
  back() {
    if (this.focusFan) return this.unfocus();
    if (this.stack().uTarget > 0) { this.foldStack(); this.paperFan.uTarget = 0; return; }
    if (this.paperFan.uTarget > 0) { this.paperFan.uTarget = 0; return; }
    if (this.paper) this.unload();
  },

  tick(t, dt) {
    if (!this.ready || !dt) return;
    const hc = this.hc();
    const hov = hc?.target ?? null;
    if (hov !== this.hovEl) {
      this.hovEl = hov;
      this.el.emit("hud-hover", { text: hov?.hudLabel ?? "", kind: hov?.hudKind ?? "" });
    }
    this.tickFan(this.paperFan, dt);
    this.tickPalm(hc);
    if (this.panelsAt && performance.now() >= this.panelsAt) { this.panelsAt = null; this.paperFan.uTarget = 1; }
    // 층 구조에 지금 화면 상태를 알려 줌: 상세 창이 열리면 흐리게, 학습 경로·개념 패널을 가리키면 노드 반응
    const st = this.stack();
    st.visibility = this.focusFan ? 0.06 : 1;
    st.interactive = !this.focusFan;
    st.highlight = !!(this.hovEl?.hudItem && ["path", "concepts"].includes(this.hovEl.hudItem.key));
    // 은하 밝기 (사용자 결정: 상황별로 물러남): 첫 화면 100% / 논문 선택 20% / 상세 창·층 구조 8%
    const gx = this.galaxy();
    if (gx) {
      const busy = this.focusFan || st.u > 0.3;
      gx.dim = busy ? 0.08 : this.paper ? 0.2 : 1;
      // (9/30 사용자) 은하는 초기 화면에서만 돎: 상세 창·층 구조·좌우 패널이 모두 닫혀 있고, 논문을 막 골라 손바닥(= 펼치기)을 기다리는 중도 아닐 때.
      // 다른 논문은 주먹(뒤로)으로 접은 뒤 돌려서
      gx.canRotate = !this.focusFan && st.uTarget === 0 && st.u < 0.05 && this.paperFan.uTarget === 0 && !this.panelsAt && !this.armPalm;
      gx.detailOpen = !!this.focusFan;
      gx.compact = st.u > 0.3 && !this.focusFan; // 층이 펼쳐지면 조준 카드는 작은 "층 접기" 버튼으로
    }
    if (this.hitDirty) { this.rayEl.components.raycaster?.refreshObjects(); this.hitDirty = false; }
  },
  // 논문을 고른 뒤 손바닥을 펴면(편 정도 PALM_OPEN 이상을 PALM_HOLD ms 유지) 층 구조를 끝까지 펼침. 시간 제한 없음.
  // 편 만큼 조금씩 펼치던 방식은 실제 손에서 편 정도가 낮고 흔들려(진단 칸 37%) 끝까지 가지 못했음 → 한 번 넘으면 끝까지
  tickPalm(hc) {
    const armed = this.armPalm && this.paper && !this.focusFan && this.stack().uTarget === 0 && hc?.mode === "hand" && !hc.pinching;
    if (!armed) { if (this.palmShown) { hc && (hc.pullProgress = null); this.palmShown = false; } this.palmT = null; return; }
    const o = hc.openness ?? 0, now = performance.now();
    this.palmT = o >= PALM_OPEN ? (this.palmT ?? now) : null;
    hc.pullProgress = Math.min(1, o / PALM_OPEN); this.palmShown = true; // 커서 원호 = 손바닥 편 정도 (가득 차면 펼침)
    if (this.palmT && now - this.palmT >= PALM_HOLD) { hc.pullProgress = null; this.palmShown = false; this.openStack(); }
  },
});
