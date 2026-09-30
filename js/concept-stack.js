/* concept-stack.js — "잡고 당겨 층 펼치기"를 A-Frame 엔티티-컴포넌트로 나눈 것.
 * 2026-09-29 사용자 결정: 층 구조를 A-Frame 컴포넌트로 재구성(안 A). 원리: docs/13-how-and-why.md §3.3
 *
 * 장면 구조 (index.html에 선언된 #stack 아래에 논문마다 층·노드 엔티티가 만들어짐):
 *   <a-entity id="stack" position="0 1.5 -2.6" concept-stack="...">   층 구조 전체: 펼침 정도·회전 상태
 *     <a-entity stack-layer="level: 3" ...>                             층 하나: 프레임 + 깊이 위치
 *       <a-entity concept-node="concept: ...; name: ..." position>      개념 하나: 핀치하면 concept-select
 * 펼치기·접기는 hud가 open() / fold()로 정한다 (2026-09-30 사용자 결정: 논문을 고른 뒤 손바닥을 펴면 펼침, 은하는 핀치로만 돎).
 * 펼쳐진 동안 층 회전 = 편 손 좌우 (9/30 사용자: 돌리기는 모두 편 손, 핀치는 선택만).
 *
 * 이벤트 (모두 장면까지 버블링)
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
    this.pairs = []; this.tmp = new THREE.Vector3();
    this.rot = null;
  },
  open() { this.uTarget = 1; this.el.emit("hud-log", { msg: "층 구조 펼침" }); },
  fold() { this.uTarget = 0; },

  // 층 회전: 편 손 좌우 (손바닥이 0.55 넘게 펴져 있고 빈 곳을 가리킬 때 시작, 0.35 아래로 오므리면 끝)
  rotate() {
    const hc = this.el.sceneEl.components["hand-cursor"], d = this.data;
    const open = this.uTarget === 1 && this.u > 0.9 && this.interactive && hc?.filtered;
    const o = hc?.openness ?? 0;
    const palm = open && hc.mode === "hand" && !hc.pinching && (this.rot ? o > 0.35 : o > 0.55) && (this.rot || !hc.target);
    if (palm) {
      if (!this.rot) {
        this.rot = { x: hc.filtered[0], yaw0: this.yawTarget };
        if (hc.norm) { hc.hold = hc.norm.slice(); hc.holdOwner = "stack"; } // 돌리는 동안 커서는 멈춤
      }
      this.yawTarget = Math.max(-d.yawMax, Math.min(d.yawMax, this.rot.yaw0 + (hc.filtered[0] - this.rot.x) * d.yawGain));
    } else if (this.rot) {
      this.rot = null;
      if (hc?.holdOwner === "stack") { hc.hold = null; hc.holdOwner = null; }
    }
  },

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
    this.rotate();
    const e = ease(clamp01(this.u)), op = e * this.visibility;
    const o3 = this.el.object3D;
    o3.visible = op > 0.01;
    o3.rotation.y = this.yaw;
    const open = this.u > 0.9 && this.interactive;
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
