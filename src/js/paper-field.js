/* paper-field v3.2: 글래스 카드(A) + 근접광·펄스(E) + 계단식 배치 + 복제 카드 열기.
 * 원리 설명: docs/09-how-it-works.md §3, §5, §7 / 디자인 근거: docs/10-design-references.md
 *
 * 노드(paper-node) 구조
 *   .glow   카드 뒤 발광 테두리 (둥근 사각형 텍스처, 호버 시 밝아짐, 핀치 시 펄스)
 *   .card   캔버스 텍스처 카드. 제목 2줄·연도/학회 배지·피인용·왼쪽 학회 색 띠
 *   .light  근접광 (커서 위치를 따라다님, additive). idle 호버에서만
 *   .target 투명 히트 평면 (카드보다 8% 큼)
 * 계단식: 같은 해 카드는 앞(가장 최신, 맨 아래) → 뒤로 갈수록 위로 0.55H 씩. 각 카드의 위쪽 띠(제목)가 항상 보이고,
 *        레이는 가장 가까운 것만 인정하므로 겹친 부분은 앞 카드가 우선.
 * 열기: 원본 카드는 제자리에 흐리게 남고, 복제(ghost)가 손을 따라 나와 열린다. 닫으면 복제가 원본 자리로 돌아가 사라진다.
 */

function hueOf(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

// ---------- 카드 텍스처 그리기 (512 x 216) ----------
const CARD_PX_W = 512, CARD_PX_H = 216;
function drawCard(p) {
  const c = document.createElement("canvas");
  c.width = CARD_PX_W; c.height = CARD_PX_H;
  const g = c.getContext("2d");
  const r = 22;
  const grad = g.createLinearGradient(0, 0, 0, CARD_PX_H);
  grad.addColorStop(0, "rgba(34,46,84,0.96)");
  grad.addColorStop(1, "rgba(18,26,48,0.96)");
  g.beginPath(); g.roundRect(2, 2, CARD_PX_W - 4, CARD_PX_H - 4, r); g.fillStyle = grad; g.fill();
  g.lineWidth = 2; g.strokeStyle = "rgba(120,140,200,0.55)"; g.stroke();
  g.save(); g.beginPath(); g.roundRect(2, 2, CARD_PX_W - 4, CARD_PX_H - 4, r); g.clip();
  g.fillStyle = `hsl(${hueOf(p.venue || "?")}, 60%, 60%)`; g.fillRect(2, 2, 10, CARD_PX_H);
  g.restore();
  g.fillStyle = "#ffffff"; g.font = "600 30px system-ui, 'Segoe UI', sans-serif"; g.textBaseline = "top";
  const words = (p.title || "").split(" "); const lines = []; let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (g.measureText(t).width > CARD_PX_W - 60) { lines.push(cur); cur = w; if (lines.length === 2) break; } else cur = t;
  }
  if (lines.length < 2 && cur) lines.push(cur);
  if (lines.length === 2 && words.join(" ").length > lines.join(" ").length) lines[1] = lines[1].replace(/\s?\S*$/, "…");
  lines.forEach((l, i) => g.fillText(l, 28, 24 + i * 38));
  const venue = (p.venue || "").replace(/^(Proceedings of the|Proceedings of|The)\s+/i, "");
  const badge = `${p.year ?? "-"} · ${venue.length > 34 ? venue.slice(0, 34) + "…" : venue || "-"}`;
  g.font = "500 22px system-ui, 'Segoe UI', sans-serif";
  const bw = g.measureText(badge).width + 28;
  g.beginPath(); g.roundRect(28, 138, bw, 40, 20); g.fillStyle = "rgba(60,76,130,0.9)"; g.fill();
  g.fillStyle = "#dbe4ff"; g.fillText(badge, 42, 147);
  g.font = "500 22px system-ui, 'Segoe UI', sans-serif"; g.textAlign = "right"; g.fillStyle = "#9ef";
  g.fillText(`인용 ${p.cited ?? 0}`, CARD_PX_W - 30, 147);
  if (p.is_oa) { g.fillStyle = "#8fe3a8"; g.font = "500 18px system-ui, sans-serif"; g.fillText("OA", CARD_PX_W - 30, 178); }
  return c;
}

// 발광 테두리 텍스처: 카드와 같은 둥근 사각형, 바깥은 투명
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement("canvas"); c.width = CARD_PX_W + 40; c.height = CARD_PX_H + 40;
  const g = c.getContext("2d");
  g.shadowColor = "rgba(255,209,102,0.95)"; g.shadowBlur = 26;
  g.fillStyle = "rgba(255,209,102,0.9)";
  g.beginPath(); g.roundRect(20, 20, CARD_PX_W, CARD_PX_H, 26); g.fill();
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

// 근접광 텍스처 (방사형)
let _lightTex = null;
function lightTexture() {
  if (_lightTex) return _lightTex;
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, "rgba(153,238,255,0.9)"); rg.addColorStop(0.4, "rgba(153,238,255,0.35)"); rg.addColorStop(1, "rgba(153,238,255,0)");
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  _lightTex = new THREE.CanvasTexture(c);
  return _lightTex;
}

function setMap(planeEl, texOrCanvas) {
  const apply = () => {
    const mesh = planeEl.getObject3D("mesh");
    if (!mesh) return;
    let tex = texOrCanvas;
    if (texOrCanvas instanceof HTMLCanvasElement) { tex = new THREE.CanvasTexture(texOrCanvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; }
    mesh.material.map = tex; mesh.material.needsUpdate = true;
  };
  if (planeEl.getObject3D("mesh")) apply(); else planeEl.addEventListener("loaded", apply, { once: true });
}

// 카드 시각 요소 한 벌 만들기 (원본과 복제가 같이 씀)
function buildCardVisual(parent, canvas, width, height, withLight) {
  const gs = (CARD_PX_W + 40) / CARD_PX_W;
  const glow = document.createElement("a-plane");
  glow.classList.add("glow");
  glow.setAttribute("width", (width * gs).toFixed(3)); glow.setAttribute("height", (height * ((CARD_PX_H + 40) / CARD_PX_H)).toFixed(3));
  glow.setAttribute("material", "shader: flat; opacity: 0; transparent: true; depthWrite: false");
  glow.setAttribute("position", "0 0 -0.004");
  setMap(glow, glowTexture());
  parent.appendChild(glow);

  const card = document.createElement("a-plane");
  card.classList.add("card");
  card.setAttribute("width", width.toFixed(3)); card.setAttribute("height", height.toFixed(3));
  card.setAttribute("material", "shader: flat; transparent: true; alphaTest: 0.05; side: double");
  setMap(card, canvas);
  parent.appendChild(card);

  let light = null;
  if (withLight) {
    light = document.createElement("a-circle");
    light.classList.add("light");
    light.setAttribute("radius", (height * 0.42).toFixed(3));
    light.setAttribute("material", "shader: flat; transparent: true; opacity: 0; depthWrite: false; blending: additive");
    light.setAttribute("position", "0 0 0.003");
    setMap(light, lightTexture());
    parent.appendChild(light);
  }

  const hit = document.createElement("a-plane");
  hit.classList.add("target");
  hit.setAttribute("width", (width * 1.08).toFixed(3)); hit.setAttribute("height", (height * 1.08).toFixed(3));
  hit.setAttribute("material", "opacity: 0; transparent: true; depthWrite: false");
  hit.setAttribute("position", "0 0 0.006");
  parent.appendChild(hit);
  return { glow, card, light, hit };
}

AFRAME.registerComponent("paper-field", {
  schema: {
    src: { default: "data/papers.json" },
    depth: { default: -3.5 },
    centerY: { default: 1.6 },
    cascade: { default: 0.55 },
    max: { default: 60 },
  },

  async init() {
    const res = await fetch(this.data.src);
    const json = await res.json();
    const papers = json.papers.slice(0, this.data.max);
    this.el.emit("papers-loaded", { author: json.author, count: papers.length, source: json.source });

    const byYear = {};
    for (const p of papers) (byYear[p.year ?? 0] ??= []).push(p);
    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
    const ncol = years.length;

    if (!this.el.sceneEl.hasLoaded) await new Promise((r) => this.el.sceneEl.addEventListener("loaded", r, { once: true }));
    const cam = document.getElementById("camera").getObject3D("camera");
    const hh = Math.abs(this.data.depth) * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const visW = 2 * hh * cam.aspect, visH = 2 * hh;
    const ratio = CARD_PX_H / CARD_PX_W;
    const maxStack = Math.max(...years.map((y) => byYear[y].length));
    const stackFactor = 1 + this.data.cascade * (maxStack - 1);

    const rows = ncol > 7 ? 2 : 1;
    const perRow = Math.ceil(ncol / rows);
    const spacing = (visW * 0.92) / perRow;
    const rowGap = 0.35;
    const hFromHeight = (visH * 0.80 - rowGap * (rows - 1)) / (rows * stackFactor);
    const H = Math.min(spacing * 0.93 * ratio, 1.15 * ratio, hFromHeight);
    const W = H / ratio;
    const step = H * this.data.cascade;
    const rowH = H * stackFactor;
    const totalH = rows * rowH + rowGap * (rows - 1);
    this.card = { W, H, rows };

    years.forEach((year, idx) => {
      const r = Math.floor(idx / perRow), ci = idx % perRow;
      const colsInRow = r === rows - 1 ? ncol - perRow * (rows - 1) : perRow;
      // 앞(맨 아래, 온전히 보이는 카드) = 가장 최신. 발행일이 같으면 피인용순
      const list = byYear[year].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.cited - a.cited);
      const x = (ci - (colsInRow - 1) / 2) * spacing;
      const rowTop = this.data.centerY + totalH / 2 - r * (rowH + rowGap);
      const rowBottom = rowTop - rowH;
      const baseY = rowBottom + H / 2;
      list.forEach((p, i) => {
        const node = document.createElement("a-entity");
        node.setAttribute("position", `${x.toFixed(3)} ${(baseY + step * i).toFixed(3)} ${(this.data.depth - 0.03 * i).toFixed(3)}`);
        node.paper = p;
        node.setAttribute("paper-node", `width: ${W.toFixed(3)}; height: ${H.toFixed(3)}; stackIndex: ${i}`);
        this.el.appendChild(node);
      });
      const label = document.createElement("a-text");
      label.setAttribute("value", String(year));
      label.setAttribute("align", "center"); label.setAttribute("width", "1.6"); label.setAttribute("color", "#8892b0");
      label.setAttribute("position", `${x.toFixed(3)} ${(rowBottom - 0.12).toFixed(3)} ${this.data.depth}`);
      this.el.appendChild(label);
      if (ci === 0) {
        const axis = document.createElement("a-box");
        axis.setAttribute("position", `0 ${(rowBottom - 0.04).toFixed(3)} ${this.data.depth}`);
        axis.setAttribute("width", (spacing * colsInRow).toFixed(2)); axis.setAttribute("height", "0.006"); axis.setAttribute("depth", "0.006");
        axis.setAttribute("color", "#2f3b5c");
        this.el.appendChild(axis);
      }
    });
  },
});

AFRAME.registerComponent("paper-node", {
  schema: {
    width: { default: 1 },
    height: { default: 0.42 },
    stackIndex: { default: 0 },
    pullDist: { default: 1.4 },     // 집는 동안 손 앞 거리
    openDist: { default: 2.0 },     // 열렸을 때 거리
    openThreshold: { default: 0.8 },
    lerp: { default: 0.18 },
    hoverLift: { default: 0.035 },  // 원본 카드 호버 시 앞으로 떠오르는 거리
    dimOpacity: { default: 0.3 },   // 복제가 나가 있을 때 원본 밝기
  },

  init() {
    const el = this.el, d = this.data, p = el.paper;
    this.state = "idle"; // idle | grabbed | open | returning
    this.home = el.object3D.position.clone();
    this.goal = new THREE.Vector3();
    this.camEl = document.getElementById("camera");
    this.cursorEl = document.getElementById("cursor");
    this.rayEl = document.getElementById("ray");
    this.camPos = new THREE.Vector3(); this.camDir = new THREE.Vector3(); this.cur = new THREE.Vector3(); this.tmp = new THREE.Vector3();
    this.glowT = 0; this.pulse = 0; this.ghost = null;
    this.canvas = drawCard(p);

    const v = buildCardVisual(el, this.canvas, d.width, d.height, true);
    this.glow = v.glow; this.card = v.card; this.light = v.light; this.hit = v.hit;
    this.hit.paperEl = el;

    const isNearest = () => this.rayEl.components.raycaster?.intersectedEls[0] === this.hit;
    this.isNearest = isNearest;
    this.hit.addEventListener("raycaster-intersected", () => { if (isNearest()) this.setHover(true); });
    this.hit.addEventListener("raycaster-intersected-cleared", () => { if (this.hovered) this.setHover(false); });

    // 원본을 핀치: idle이면 복제를 만들어 집기 시작. 열린 상태에서 원본을 다시 핀치해도 닫힘
    this.hit.addEventListener("pinchstart", () => this.onPinch());
    el.sceneEl.addEventListener("pinchend-any", () => {
      if (this.state !== "grabbed" || !this.ghost) return;
      const pulled = this.ghost.object3D.position.distanceTo(this.home);
      if (pulled > d.openThreshold) { this.state = "open"; el.emit("paper-open", { paper: p }, true); }
      else this.close();
    });
  },

  onPinch() {
    this.pulse = 1;
    if (this.state === "idle" || this.state === "returning") {
      this.spawnGhost();
      this.state = "grabbed";
      this.el.emit("paper-grab", { paper: this.el.paper }, true);
    } else if (this.state === "open") {
      this.close();
    }
  },

  // 복제 카드: 원본과 같은 그림, 같은 자리에서 시작. 원본은 흐려짐
  spawnGhost() {
    if (this.ghost) return;
    const d = this.data;
    const ghost = document.createElement("a-entity");
    ghost.object3D.position.copy(this.el.object3D.position);
    ghost.object3D.position.z += 0.02;
    this.el.parentNode.appendChild(ghost);
    const v = buildCardVisual(ghost, this.canvas, d.width, d.height, false);
    v.hit.paperEl = this.el;
    v.hit.addEventListener("pinchstart", () => this.onPinch());
    this.ghost = ghost; this.ghostGlow = v.glow;
    this.setCardOpacity(d.dimOpacity);
  },

  removeGhost() {
    if (!this.ghost) return;
    this.ghost.parentNode.removeChild(this.ghost);
    this.ghost = null; this.ghostGlow = null;
    this.setCardOpacity(1);
  },

  setCardOpacity(o) {
    const m = this.card.getObject3D("mesh")?.material;
    if (m) { m.opacity = o; m.needsUpdate = true; }
  },

  setHover(on) {
    this.hovered = on;
    this.el.emit(on ? "paper-hover" : "paper-unhover", { paper: this.el.paper }, true);
  },

  close() {
    if (this.state === "idle") return;
    this.state = "returning";
    this.el.emit("paper-close", { paper: this.el.paper }, true);
  },

  tick(t, dt) {
    const el = this.el, d = this.data;
    const nearest = this.isNearest();
    if (this.hovered && !nearest) this.setHover(false);
    else if (!this.hovered && nearest) this.setHover(true);

    // 원본: 제자리. 호버 시 살짝 앞으로
    this.goal.copy(this.home); if (this.hovered && this.state === "idle") this.goal.z += d.hoverLift;
    el.object3D.position.lerp(this.goal, 0.25);

    // 복제: 상태별 목표
    if (this.ghost) {
      const gpos = this.ghost.object3D.position;
      let targetScale = 1;
      if (this.state === "grabbed") {
        this.camEl.object3D.getWorldPosition(this.camPos);
        this.cursorEl.object3D.getWorldPosition(this.cur);
        this.goal.copy(this.cur).sub(this.camPos).normalize().multiplyScalar(d.pullDist).add(this.camPos);
        gpos.lerp(this.goal, d.lerp); targetScale = 1.15;
      } else if (this.state === "open") {
        this.camEl.object3D.getWorldPosition(this.camPos);
        this.camEl.object3D.getWorldDirection(this.camDir);
        const cam = this.camEl.getObject3D("camera");
        const hw = d.openDist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect;
        this.goal.copy(this.camPos).addScaledVector(this.camDir, -d.openDist);
        this.goal.x -= hw * 0.42; this.goal.y += 0.05;
        gpos.lerp(this.goal, d.lerp); targetScale = 1;
      } else if (this.state === "returning") {
        gpos.lerp(this.home, d.lerp); targetScale = 1;
        if (gpos.distanceTo(this.home) < 0.015) { this.removeGhost(); this.state = "idle"; }
      }
      if (this.ghost) {
        const s = this.ghost.object3D.scale.x + (targetScale - this.ghost.object3D.scale.x) * 0.2;
        this.ghost.object3D.scale.setScalar(s);
        const gm = this.ghostGlow.getObject3D("mesh")?.material;
        if (gm) gm.opacity = this.state === "returning" ? 0.2 : 0.55 + 0.45 * this.pulse;
        this.ghostGlow.object3D.scale.setScalar(1 + 0.06 * this.pulse);
      }
    }

    // 원본의 발광·근접광 (idle 호버에서만)
    const wantGlow = this.hovered && this.state === "idle" ? 1 : 0;
    this.glowT += (wantGlow - this.glowT) * Math.min(1, dt / 90);
    this.pulse = Math.max(0, this.pulse - dt / 260);
    const glowMat = this.glow.getObject3D("mesh")?.material;
    if (glowMat) glowMat.opacity = 0.55 * this.glowT + (this.state === "idle" ? 0.45 * this.pulse : 0);
    this.glow.object3D.scale.setScalar(1 + 0.06 * this.pulse);

    const lightMat = this.light.getObject3D("mesh")?.material;
    if (lightMat) {
      const lightOn = this.hovered && this.state === "idle";
      lightMat.opacity = lightOn ? 0.45 * this.glowT : 0;
      if (lightOn) {
        const inter = this.rayEl.components.raycaster?.getIntersection(this.hit);
        if (inter) {
          this.tmp.copy(inter.point); el.object3D.worldToLocal(this.tmp);
          this.light.object3D.position.x += (this.tmp.x - this.light.object3D.position.x) * 0.35;
          this.light.object3D.position.y += (this.tmp.y - this.light.object3D.position.y) * 0.35;
        }
      }
    }
  },
});
