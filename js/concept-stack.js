/* concept-stack.js — "잡고 당겨 층 펼치기"를 A-Frame 엔티티-컴포넌트로 나눈 것.
 * 2026-09-29 사용자 결정: 층 구조를 A-Frame 컴포넌트로 재구성(안 A). 원리: docs/13-how-and-why.md §3.3
 *
 * 장면 구조 (index.html에 선언된 #stack 아래에 논문마다 층·노드 엔티티가 만들어짐):
 *   <a-entity id="stack" position="0 1.5 -2.6" concept-stack="...">   층 구조 전체: 펼침 정도·회전 상태
 *     <a-entity stack-layer="level: 3" ...>                             층 하나: 프레임 + 깊이 위치
 *       <a-entity concept-node="concept: ...; name: ..." position>      개념 하나: 핀치하면 concept-select
 * 잡을 수 있는 대상(논문 칩·코어)에는 hud.js가 pullable을 붙인다.
 *
 * 이벤트 (모두 장면까지 버블링)
 *   pullable     → pull-start {source} · pull-move {source, u | pull, dx} · pull-end {source, moved, tap, commit}
 *   concept-node → concept-select {concept}
 *   concept-node → hud-hit-dirty (판정 대상이 바뀌었으니 레이 목록을 다시 읽으라는 신호)
 * 그리기 도우미(canvasOf, texOf, flatMesh, hitMesh, fit, brackets, ease, clamp01, HUD, FT, FK)는 hud.js 것을 쓰므로 hud.js 다음에 로드.
 */

const LEVEL_NAME = { 1: "L1 기초", 2: "L2 전공", 3: "L3 연구 기법" };
// 층 배치: z = 코어에서 나를 향해 나오는 거리(m), y = 높이, scale = 먼 층일수록 키워 화면에서 글자 크기를 맞춤
// 사용자 결정: 기초(L1)가 나에게 가장 가깝게
const LEVEL_POSE = {
  3: { z: 0.15, y: 0.52, scale: 1.3 },
  2: { z: 0.5, y: 0.12, scale: 1.15 },
  1: { z: 0.8, y: -0.46, scale: 1 },
};

function drawNode(c, { name, core, hot }) {
  const g = c.getContext("2d"), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = hot ? "rgba(63,208,240,0.38)" : "rgba(5,24,36,0.92)"; g.fillRect(4, 4, W - 8, H - 8);
  g.strokeStyle = hot || core ? HUD.cyan2 : HUD.cyan; g.lineWidth = hot ? 7 : core ? 5 : 3; g.strokeRect(4, 4, W - 8, H - 8);
  g.textBaseline = "middle"; g.textAlign = "center"; // 수준(L1·L2·L3)은 층 이름표에 있으므로 노드엔 이름만 크게
  g.fillStyle = hot ? "#ffffff" : HUD.text; g.font = `600 46px ${FK}`;
  g.fillText(fit(g, (core ? "★ " : "") + name, W - 40), W / 2, H / 2 + 2);
}
function drawLayerFrame(c, level) {
  const g = c.getContext("2d"), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = "rgba(63,208,240,0.05)"; g.fillRect(0, 0, W, H);
  brackets(g, 4, 4, W - 8, H - 8, 40, HUD.cyan, 4);
  g.fillStyle = HUD.cyan; g.font = `700 34px ${FK}`; g.textAlign = "left"; g.textBaseline = "top";
  g.fillText(LEVEL_NAME[level], 22, 14);
}
const disposeTree = (o) => o.traverse((x) => { x.geometry?.dispose(); x.material?.map?.dispose(); x.material?.dispose(); });

// ---------- pullable: 잡고(핀치) → 손을 편 만큼 펼침 → 편 손을 좌우로 = 회전 ----------
// 2026-09-30 사용자 결정: 몸쪽으로 당기기(손 크기로 깊이 추정)는 인식이 잘 안 됨 → "핀치로 잡은 뒤 손을 활짝 펴면 펼치기",
// 회전은 "편 손을 좌우로". 손을 편 정도는 hand-cursor.openness(손가락 펴짐·벌어짐, 0~1).
// 단계: pinch(잡은 동안) → spread(놓은 뒤 편 만큼 펼침) → rotate(끝까지 폈으면 고정, 편 손 좌우 = 회전) → 끝
// 마우스는 손을 펼 수 없으므로 예전처럼 누른 채 아래로 끌기.
AFRAME.registerComponent("pullable", {
  schema: {
    pullDown: { default: 0.25 },    // 마우스: 화면 높이의 25%만큼 아래로 끌면 끝까지
    commitAt: { default: 0.75 },    // 손을 이만큼 펴면 끝까지 펼쳐 고정 (모델의 Open_Palm 점수는 편 손도 0.6~0.8)
    tapOpen: { default: 0.2 },      // 놓은 뒤 이만큼도 안 펴면 그냥 클릭
    tapWait: { default: 600 },      // 놓은 뒤 이 시간(ms) 안에 펴기 시작하지 않으면 클릭으로 끝냄
    spreadWait: { default: 1500 },  // 펴다 만 채로 이 시간이 지나면 되감김
    rotateUntil: { default: 0.35 }, // 고정 뒤 손을 이 아래로 오므리면(가리키는 자세) 회전 끝
  },
  init() {
    this.s = null; // { phase, x0, y0, moved, maxU, t, xr }
    this.hc = () => this.el.sceneEl.components["hand-cursor"];
    this.onStart = () => {
      if (this.s) this.end({ commit: false, moved: this.s.maxU }); // 펼치는 도중 다시 핀치: 이전 동작을 끝내고 새로 (층이 반쯤 남던 문제)
      const hc = this.hc();
      this.s = { phase: "pinch", x0: hc?.norm?.[0] ?? 0.5, y0: hc?.norm?.[1] ?? 0.5, moved: 0, maxU: 0 };
      if (hc?.mode === "hand" && hc.norm) { hc.hold = hc.norm.slice(); hc.holdOwner = "pull"; } // 펼치기가 끝날 때까지 커서를 잡은 자리에 (손을 펴는 동안 떠돌지 않게)
      this.el.emit("pull-start", { source: this.el });
    };
    this.onPinchEnd = () => {
      const s = this.s; if (!s || s.phase !== "pinch") return;
      if (this.hc()?.mode !== "hand") return this.end({ tap: s.moved < 0.03, moved: s.moved }); // 마우스: 놓는 순간 끝
      s.phase = "spread"; s.t = performance.now();
    };
    this.el.addEventListener("pinchstart", this.onStart);
    this.el.sceneEl.addEventListener("pinchend-any", this.onPinchEnd);
  },
  remove() {
    this.el.removeEventListener("pinchstart", this.onStart);
    this.el.sceneEl.removeEventListener("pinchend-any", this.onPinchEnd);
  },
  // tap: 그냥 클릭이었음 / commit: true = 끝까지 펼쳐 고정, false = 되감기, 없음(마우스) = 절반 기준
  end(detail) { const hc = this.hc(); if (hc?.holdOwner === "pull") { hc.hold = null; hc.holdOwner = null; } this.s = null; this.el.emit("pull-end", { source: this.el, ...detail }); },
  tick() {
    const s = this.s, hc = this.hc(), d = this.data;
    if (!s || !hc) return;
    if (s.phase === "pinch") {
      if (hc.mode === "hand" || !hc.norm) return; // 손은 놓은 뒤(spread)부터
      const dx = hc.norm[0] - s.x0, dy = hc.norm[1] - s.y0;
      s.moved = Math.max(s.moved, Math.abs(dx), Math.abs(dy));
      this.el.emit("pull-move", { source: this.el, pull: dy / d.pullDown, dx });
      return;
    }
    if (hc.mode !== "hand") return this.end({ commit: s.phase === "rotate", moved: s.maxU }); // 손을 놓침
    const u = hc.openness ?? 0, since = performance.now() - s.t;
    if (s.phase === "spread") {
      s.maxU = Math.max(s.maxU, u);
      if (hc.pinching) return this.end({ tap: s.maxU < d.tapOpen, commit: false, moved: s.maxU });
      if (u >= d.commitAt) { s.phase = "rotate"; s.xr = hc.filtered?.[0] ?? 0.5; this.el.emit("pull-move", { source: this.el, u: 1, dx: 0 }); return; }
      if (s.maxU < d.tapOpen && since > d.tapWait) return this.end({ tap: true, commit: false, moved: s.maxU });
      if (since > d.spreadWait || s.maxU - u > 0.25) return this.end({ commit: false, moved: s.maxU }); // 펴다 말았음 → 되감김
      this.el.emit("pull-move", { source: this.el, u, dx: 0 });
      return;
    }
    // rotate: 끝까지 펼쳐 고정된 상태. 편 손을 좌우로 = 회전, 오므리거나 다시 핀치하면 끝
    if (hc.pinching || u < d.rotateUntil) return this.end({ commit: true, moved: 1 });
    this.el.emit("pull-move", { source: this.el, u: 1, dx: (hc.filtered?.[0] ?? s.xr) - s.xr }); // 커서는 멈춰 있으므로 손의 실제 좌우 이동으로
  },
});

// ---------- concept-stack: 층 구조 전체 ----------
AFRAME.registerComponent("concept-stack", {
  schema: {
    yawGain: { default: 2.4 },   // 좌우 이동 → 회전
    yawMax: { default: 0.6 },    // 최대 회전 (rad, 약 ±35°)
    cols: { default: 3 },        // 한 줄 노드 수
    sx: { default: 0.56 },       // 노드 간격 (가로)
    sy: { default: 0.15 },       // 노드 간격 (세로)
  },
  init() {
    this.u = 0; this.uTarget = 0; this.yaw = 0; this.yawTarget = 0;
    this.visibility = 1;      // hud가 정함: 주제 카드가 열리면 0, 상세 창이 열리면 흐리게
    this.interactive = true;  // hud가 정함: 상세 창·주제 카드가 열려 있으면 노드를 누를 수 없음
    this.highlight = false;   // hud가 정함: 학습 경로·개념 패널을 가리키면 노드가 반응
    this.grab = null; this.pairs = []; this.tmp = new THREE.Vector3();
    const sc = this.el.sceneEl;
    sc.addEventListener("pull-start", () => {
      this.grab = { u0: this.uTarget, yaw0: this.yawTarget };
      this.progress(this.uTarget);
    });
    sc.addEventListener("pull-move", (e) => {
      if (!this.grab) return;
      const d = this.data;
      // 손: u = 손을 편 정도(절대값, 이미 펼쳐져 있으면 줄지 않음) / 마우스: pull = 끈 정도(상대값)
      this.uTarget = e.detail.u != null ? Math.max(this.grab.u0, clamp01(e.detail.u)) : clamp01(this.grab.u0 + e.detail.pull);
      this.yawTarget = Math.max(-d.yawMax, Math.min(d.yawMax, this.grab.yaw0 + e.detail.dx * d.yawGain));
      this.progress(this.uTarget);
    });
    // 놓기: 절반 넘게 펼쳤으면 끝까지, 아니면 되감김. 거의 안 움직였으면 클릭이므로 상태를 바꾸지 않음
    sc.addEventListener("pull-end", (e) => {
      if (!this.grab) return;
      this.grab0 = this.grab.u0; // 잡기 전 상태 (되감기·클릭이면 여기로)
      this.grab = null;
      this.progress(null);
      const { tap, commit } = e.detail;
      if (tap) { this.uTarget = this.grab0; return; } // 그냥 클릭: 펼침 상태는 그대로 (클릭 처리는 hud)
      this.uTarget = commit === true ? 1 : commit === false ? this.grab0 : this.uTarget >= 0.5 ? 1 : 0;
      if (this.uTarget === 1) this.el.emit("hud-log", { msg: "층 구조 펼침" });
    });
  },
  // 커서 원호에 당긴 정도를 보여 줌
  progress(v) { const hc = this.el.sceneEl.components["hand-cursor"]; if (hc) hc.pullProgress = v; },
  fold() { this.uTarget = 0; },

  // 논문의 학습 경로로 층·노드 엔티티를 만든다 (선언형: setAttribute로 컴포넌트를 붙임)
  setPath(concepts, coreIds = []) {
    this.clear();
    const core = new Set(coreIds), d = this.data, byId = {};
    for (const lv of [3, 2, 1]) {
      const list = concepts.filter((c) => c.level === lv);
      if (!list.length) continue;
      const cols = Math.min(d.cols, list.length), rows = Math.ceil(list.length / cols);
      const layer = document.createElement("a-entity");
      layer.setAttribute("stack-layer", { level: lv, width: cols * d.sx + 0.12, height: rows * d.sy + 0.2 });
      this.el.appendChild(layer);
      layer.addEventListener("loaded", () => layer.flushToDOM(), { once: true });
      list.forEach((c, k) => {
        const col = k % cols, row = Math.floor(k / cols);
        const node = document.createElement("a-entity");
        node.setAttribute("concept-node", { concept: c.id, name: c.name, level: lv, core: core.has(c.id), hitW: +(d.sx * 0.96).toFixed(3), hitH: +(d.sy * 0.9).toFixed(3) });
        node.setAttribute("press-feedback", ""); // 누른 순간 번쩍 (hand-cursor.js)
        node.setAttribute("position", { x: (col - (cols - 1) / 2) * d.sx, y: (rows - 1) / 2 * d.sy - row * d.sy - 0.03, z: 0.005 });
        layer.appendChild(node);
        // A-Frame은 컴포넌트 값을 HTML 속성에 다시 쓰지 않음 → 개발자 도구에서 구조가 보이도록 한 번 적어 둠
        node.addEventListener("loaded", () => node.flushToDOM(), { once: true });
        byId[c.id] = { node, c };
      });
    }
    // 선수 관계선: 경로 안의 개념끼리만. 레이 판정에서 뺌 (THREE.Line의 기본 판정 폭 1m가 다른 대상을 가로챔)
    this.pairs = [];
    for (const { node, c } of Object.values(byId)) for (const p of c.prerequisites || []) if (byId[p]) this.pairs.push([byId[p].node, node]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.pairs.length * 6), 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: HUD.cyan, transparent: true, opacity: 0, depthWrite: false }));
    lines.raycast = () => {}; lines.renderOrder = 5; lines.frustumCulled = false;
    this.el.setObject3D("lines", lines);
  },
  clear() {
    while (this.el.firstChild) this.el.removeChild(this.el.firstChild); // 자식 컴포넌트의 remove()가 텍스처를 정리
    const lines = this.el.getObject3D("lines");
    if (lines) { disposeTree(lines); this.el.removeObject3D("lines"); }
    this.pairs = [];
    this.u = this.uTarget = this.yaw = this.yawTarget = 0;
    this.el.emit("hud-hit-dirty"); // 지운 노드가 레이 목록에 남지 않게
  },

  tick(t, dt) {
    if (!dt) return;
    this.u += (this.uTarget - this.u) * (1 - Math.exp(-dt / 90));
    this.yaw += (this.yawTarget - this.yaw) * (1 - Math.exp(-dt / 70));
    const e = ease(clamp01(this.u)), op = e * this.visibility;
    const o3 = this.el.object3D;
    o3.visible = op > 0.01;
    o3.rotation.y = this.yaw;
    const open = this.u > 0.9 && !this.grab && this.interactive;
    for (const layer of this.el.children) {
      layer.components["stack-layer"]?.pose(e, op);
      for (const node of layer.children) node.components["concept-node"]?.show(op, open, this.highlight);
    }
    // 선 위치 갱신 (노드 월드 좌표 → 이 엔티티 좌표)
    const lines = this.el.getObject3D("lines");
    if (lines && this.pairs.length) {
      const pos = lines.geometry.attributes.position, v = this.tmp;
      o3.updateMatrixWorld(true);
      this.pairs.forEach(([a, b], i) => {
        for (const [k, n] of [[0, a], [1, b]]) { n.object3D.getWorldPosition(v); o3.worldToLocal(v); pos.setXYZ(i * 2 + k, v.x, v.y, v.z); }
      });
      pos.needsUpdate = true;
      lines.material.opacity = 0.4 * op;
    }
  },
});

// ---------- stack-layer: 층 하나 (프레임과 깊이 위치) ----------
AFRAME.registerComponent("stack-layer", {
  schema: { level: { type: "int", default: 1 }, width: { default: 1.8 }, height: { default: 0.5 } },
  init() {
    const { level, width, height } = this.data;
    const cv = canvasOf(1024, Math.round(1024 * height / width)); drawLayerFrame(cv, level);
    this.frame = flatMesh(new THREE.PlaneGeometry(width, height), texOf(cv), 0);
    this.frame.renderOrder = 6;
    this.el.setObject3D("mesh", this.frame);
  },
  // 펼침 정도 e(0~1)에 따라 코어에서 나를 향해 나오고 커짐
  pose(e, op) {
    if (!this.frame) return; // 엔티티를 만든 직후, init 전 프레임 (여기서 예외가 나면 A-Frame 렌더 루프 전체가 멈춤)
    const p = LEVEL_POSE[this.data.level];
    this.el.object3D.position.set(0, p.y * e, 0.1 + p.z * e);
    this.el.object3D.scale.setScalar((0.2 + 0.8 * e) * p.scale);
    this.frame.material.opacity = op;
    // 보이는 동안은 가림막: 이 층 뒤에 가려진 패널이 레이에 잡히지 않게 (z-버퍼처럼)
    const block = op > 0.3;
    if (this.el.classList.contains("blocker") !== block) { this.el.classList.toggle("blocker", block); this.el.emit("hud-hit-dirty"); }
  },
  remove() { disposeTree(this.frame); },
});

// ---------- concept-node: 개념 하나 ----------
AFRAME.registerComponent("concept-node", {
  schema: {
    concept: { default: "" }, name: { default: "" }, level: { type: "int", default: 1 }, core: { default: false },
    width: { default: 0.52 },   // 노드 폭 (글자가 읽히는 크기)
    hitW: { default: 0.54 }, hitH: { default: 0.135 }, // 판정 영역은 보이는 것보다 크게
  },
  init() {
    const d = this.data;
    this.cv = canvasOf(512, 128); this.tex = texOf(this.cv);
    drawNode(this.cv, { name: d.name, core: d.core });
    this.vis = flatMesh(new THREE.PlaneGeometry(d.width, d.width / 4), this.tex, 0);
    this.vis.renderOrder = 7;
    const g = new THREE.Group();
    g.add(this.vis, hitMesh(d.hitW, d.hitH));
    this.el.setObject3D("mesh", g);
    // hud의 커서 옆 이름표·호버 처리와 같은 약속
    this.el.hudKind = "concept"; this.el.hudRef = d.concept; this.el.hudLabel = `${LEVEL_NAME[d.level]} · ${d.name}`;
    this.hot = false; this.hittable = false;
    this.onPinch = () => this.el.emit("concept-select", { concept: d.concept });
    this.el.addEventListener("pinchstart", this.onPinch);
  },
  show(op, open, highlight) {
    if (!this.vis) return; // init 전 프레임
    const hc = this.el.sceneEl.components["hand-cursor"], hot = hc?.target === this.el;
    if (hot !== this.hot) { this.hot = hot; drawNode(this.cv, { name: this.data.name, core: this.data.core, hot }); this.tex.needsUpdate = true; }
    this.vis.material.opacity = op;
    this.el.object3D.scale.setScalar(hot ? 1.18 : highlight ? 1.08 : 1);
    if (open !== this.hittable) {
      this.hittable = open;
      this.el.classList.toggle("target", open); // 레이 대상 여부는 class로 (three.js는 숨긴 메시도 맞힘)
      this.el.emit("hud-hit-dirty");
    }
  },
  remove() {
    this.el.removeEventListener("pinchstart", this.onPinch);
    disposeTree(this.el.getObject3D("mesh"));
  },
});
