/* paper-field v4: 연구실 서가 (디자인 C). 사양: docs/11-design-c-spec.md
 *
 * 책(paper-node) 구조
 *   .book   a-box. 앞면(+z) = 책등 캔버스(제목 세로·연도), 나머지 면 단색
 *   .glow   책등 뒤 촛불 금 테두리 평면 (호버 시 밝아짐, 핀치 시 펄스)
 *   .target 투명 히트 박스 (얇은 책도 잡히게 최소 폭)
 * 선반: 연도 순으로 왼쪽→오른쪽. 연도 바뀌면 황동 구분판 + 라벨. 한 줄에 안 들어가면 아래 선반 추가.
 * 열기: 원본은 제자리에 흐리게, 복제가 손을 따라 나오며 표지가 보이게 돌아간다. 닫으면 복제가 돌아가 사라진다.
 */

const SPINE_PALETTE = [
  { bg: "#6e2f2f", fg: "#efe6d3" }, // 옥스블러드
  { bg: "#2f4a3a", fg: "#efe6d3" }, // 포레스트
  { bg: "#2b3a55", fg: "#efe6d3" }, // 잉크
  { bg: "#a8842f", fg: "#241d17" }, // 머스터드
  { bg: "#4a4f5a", fg: "#efe6d3" }, // 슬레이트
  { bg: "#8a5a3c", fg: "#efe6d3" }, // 클레이
  { bg: "#d9c9a8", fg: "#241d17" }, // 양피지
];
const GOLD = "#d4a24c";
const FONT_DISPLAY = "'EB Garamond', 'Noto Serif KR', Georgia, serif";
const FONT_META = "system-ui, 'Segoe UI', sans-serif";

function hashOf(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
function paletteFor(p) { return SPINE_PALETTE[hashOf(p.venue || p.title || "?") % SPINE_PALETTE.length]; }

// 종이 결 노이즈 (텍스처 위에 살짝)
function grain(g, w, h, alpha) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 255 * alpha;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

// ---------- 책등 텍스처 (128 x 640) ----------
const SPINE_W = 128, SPINE_H = 640;
function drawSpine(p) {
  const pal = paletteFor(p);
  const c = document.createElement("canvas"); c.width = SPINE_W; c.height = SPINE_H;
  const g = c.getContext("2d");
  g.fillStyle = pal.bg; g.fillRect(0, 0, SPINE_W, SPINE_H);
  // 위아래 밴드 (제본 띠)
  g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(0, 26, SPINE_W, 3); g.fillRect(0, SPINE_H - 60, SPINE_W, 3);
  g.fillStyle = "rgba(255,255,255,0.10)"; g.fillRect(0, 0, 6, SPINE_H); // 왼쪽 하이라이트
  g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(SPINE_W - 6, 0, 6, SPINE_H); // 오른쪽 그늘
  // 제목: 세로 (위→아래로 읽음)
  g.save();
  g.translate(SPINE_W / 2, 44); g.rotate(Math.PI / 2);
  g.fillStyle = pal.fg; g.textBaseline = "middle"; g.textAlign = "left";
  const maxLen = SPINE_H - 44 - 76;
  let size = 40; g.font = `600 ${size}px ${FONT_DISPLAY}`;
  let title = p.title || "";
  while (g.measureText(title).width > maxLen && size > 26) { size -= 2; g.font = `600 ${size}px ${FONT_DISPLAY}`; }
  if (g.measureText(title).width > maxLen) {
    while (title.length > 4 && g.measureText(title + "…").width > maxLen) title = title.slice(0, -1);
    title = title.replace(/\s+$/, "") + "…";
  }
  g.fillText(title, 0, 0);
  g.restore();
  // 연도 (아래, 가로)
  g.fillStyle = pal.fg; g.globalAlpha = 0.85; g.font = `500 26px ${FONT_META}`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(String(p.year ?? ""), SPINE_W / 2, SPINE_H - 30);
  g.globalAlpha = 1;
  grain(g, SPINE_W, SPINE_H, 0.06);
  return c;
}

// ---------- 표지 텍스처 (320 x 440) ----------
const COVER_W = 320, COVER_H = 440;
function drawCover(p) {
  const pal = paletteFor(p);
  const c = document.createElement("canvas"); c.width = COVER_W; c.height = COVER_H;
  const g = c.getContext("2d");
  g.fillStyle = pal.bg; g.fillRect(0, 0, COVER_W, COVER_H);
  g.strokeStyle = pal.fg; g.globalAlpha = 0.55; g.lineWidth = 2; g.strokeRect(18, 18, COVER_W - 36, COVER_H - 36); g.globalAlpha = 1;
  g.fillStyle = pal.fg; g.textBaseline = "top"; g.textAlign = "left";
  g.font = `600 30px ${FONT_DISPLAY}`;
  const words = (p.title || "").split(" "); const lines = []; let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (g.measureText(t).width > COVER_W - 72) { lines.push(cur); cur = w; if (lines.length === 5) break; } else cur = t;
  }
  if (lines.length < 6 && cur) lines.push(cur);
  lines.slice(0, 6).forEach((l, i) => g.fillText(l, 36, 48 + i * 38));
  g.font = `400 18px ${FONT_META}`; g.globalAlpha = 0.85;
  const venue = (p.venue || "").replace(/^(Proceedings of the|Proceedings of|The)\s+/i, "");
  g.fillText(`${p.year ?? ""}`, 36, COVER_H - 96);
  g.fillText(venue.length > 30 ? venue.slice(0, 30) + "…" : venue, 36, COVER_H - 72);
  g.fillText(`인용 ${p.cited ?? 0}${p.is_oa ? " · OA" : ""}`, 36, COVER_H - 48);
  g.globalAlpha = 1;
  grain(g, COVER_W, COVER_H, 0.06);
  return c;
}

// ---------- 선반 목재 텍스처 (1024 x 128) ----------
let _woodTex = null;
function woodTexture() {
  if (_woodTex) return _woodTex;
  const w = 1024, h = 128;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#4a3524"); grad.addColorStop(0.08, "#3b2a1d"); grad.addColorStop(1, "#26190f");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  // 결
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.12})`; g.lineWidth = 1 + Math.random() * 1.5;
    const y = Math.random() * h; g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= w; x += 64) g.lineTo(x, y + Math.sin(x / 90 + i) * 3 + (Math.random() - 0.5) * 2);
    g.stroke();
  }
  grain(g, w, h, 0.05);
  _woodTex = new THREE.CanvasTexture(c); _woodTex.colorSpace = THREE.SRGBColorSpace;
  _woodTex.wrapS = THREE.RepeatWrapping; _woodTex.repeat.set(3, 1);
  return _woodTex;
}

// ---------- 발광 테두리 (책등 형태) ----------
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement("canvas"); c.width = SPINE_W + 48; c.height = SPINE_H + 48;
  const g = c.getContext("2d");
  g.shadowColor = "rgba(212,162,76,0.95)"; g.shadowBlur = 28;
  g.fillStyle = "rgba(212,162,76,0.85)";
  g.fillRect(24, 24, SPINE_W, SPINE_H);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

// 연도 라벨 (황동 판)
function drawYearPlate(year) {
  const c = document.createElement("canvas"); c.width = 160; c.height = 56;
  const g = c.getContext("2d");
  g.fillStyle = "#6f5630"; g.fillRect(0, 0, 160, 56);
  g.strokeStyle = "#c9a45c"; g.lineWidth = 2; g.strokeRect(4, 4, 152, 48);
  g.fillStyle = "#f0e2bf"; g.font = `600 30px ${FONT_DISPLAY}`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(String(year), 80, 30);
  return c;
}

function canvasTex(canvas) { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load(`600 40px 'EB Garamond'`),
      document.fonts.load(`600 40px 'Noto Serif KR'`),
    ]);
  } catch {}
}

// 책 한 권의 메시 만들기 (원본·복제 공용). 반환: {book, glow, hit}
function buildBook(parent, spineCanvas, coverCanvas, thick, height, depth) {
  const book = document.createElement("a-entity");
  book.classList.add("book");
  const geo = new THREE.BoxGeometry(thick, height, depth);
  const side = new THREE.MeshLambertMaterial({ color: new THREE.Color("#2a2119") });
  const pages = new THREE.MeshLambertMaterial({ color: new THREE.Color("#e6dcc4") });
  const spine = new THREE.MeshBasicMaterial({ map: canvasTex(spineCanvas) });
  const cover = new THREE.MeshBasicMaterial({ map: canvasTex(coverCanvas) });
  // BoxGeometry 면 순서: +x, -x, +y, -y, +z, -z. 책등은 +z(앞), 표지는 +x(오른쪽), 뒷표지 -x
  const mesh = new THREE.Mesh(geo, [cover, side, pages, side, spine, pages]);
  book.setObject3D("mesh", mesh);
  parent.appendChild(book);

  const glow = document.createElement("a-plane");
  glow.classList.add("glow");
  glow.setAttribute("width", (thick * (SPINE_W + 48) / SPINE_W).toFixed(3));
  glow.setAttribute("height", (height * (SPINE_H + 48) / SPINE_H).toFixed(3));
  glow.setAttribute("material", "shader: flat; opacity: 0; transparent: true; depthWrite: false");
  glow.setAttribute("position", `0 0 ${(depth / 2 + 0.002).toFixed(3)}`);
  glow.addEventListener("loaded", () => { const m = glow.getObject3D("mesh"); m.material.map = glowTexture(); m.material.needsUpdate = true; }, { once: true });
  parent.appendChild(glow);

  const hit = document.createElement("a-box");
  hit.classList.add("target");
  hit.setAttribute("width", Math.max(thick * 1.3, 0.09).toFixed(3)); hit.setAttribute("height", (height * 1.05).toFixed(3)); hit.setAttribute("depth", (depth + 0.02).toFixed(3));
  hit.setAttribute("material", "opacity: 0; transparent: true; depthWrite: false");
  parent.appendChild(hit);
  return { book, glow, hit };
}

AFRAME.registerComponent("paper-field", {
  schema: {
    src: { default: "data/papers.json" },
    depth: { default: -3.2 },
    centerY: { default: 1.5 },
    bookH: { default: 0.40 },
    bookD: { default: 0.28 },
    shelfGap: { default: 0.62 },
    max: { default: 60 },
  },

  async init() {
    const res = await fetch(this.data.src);
    const json = await res.json();
    const papers = json.papers.slice(0, this.data.max);
    this.el.emit("papers-loaded", { author: json.author, count: papers.length, source: json.source });
    await ensureFonts();
    if (!this.el.sceneEl.hasLoaded) await new Promise((r) => this.el.sceneEl.addEventListener("loaded", r, { once: true }));

    // 연도 오름차순, 같은 해는 최신이 오른쪽(가장 나중에 꽂힌 책)
    const sorted = [...papers].sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || (a.date ?? "").localeCompare(b.date ?? ""));
    const cam = document.getElementById("camera").getObject3D("camera");
    const hh = Math.abs(this.data.depth) * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const visW = 2 * hh * cam.aspect;
    const shelfW = visW * 0.9;

    // 책 두께: 피인용 로그
    const thickOf = (p) => 0.045 + 0.022 * Math.log10((p.cited ?? 0) + 1);
    const GAP = 0.012, DIVIDER = 0.05, LABEL_PAD = 0.10;

    // 줄 나누기 (연도 단위로 묶어서 한 선반이 넘치면 다음 선반)
    const groups = [];
    for (const p of sorted) { const g = groups[groups.length - 1]; if (g && g.year === p.year) g.items.push(p); else groups.push({ year: p.year, items: [p] }); }
    const groupW = (g) => LABEL_PAD + DIVIDER + g.items.reduce((s, p) => s + thickOf(p) + GAP, 0) + 0.04;
    const shelves = [[]]; let wAcc = 0;
    for (const g of groups) {
      const w = groupW(g);
      if (wAcc + w > shelfW && shelves[shelves.length - 1].length) { shelves.push([]); wAcc = 0; }
      shelves[shelves.length - 1].push(g); wAcc += w;
    }
    const totalH = shelves.length * this.data.shelfGap;
    const H = this.data.bookH, D = this.data.bookD;

    // 화면을 채우도록 서가 전체를 확대: 가장 긴 선반이 보이는 폭의 90%, 전체 높이가 보이는 높이의 70%를 넘지 않는 최대 배율
    const widest = Math.max(...shelves.map((row) => row.reduce((s, g) => s + groupW(g), 0))) + 0.3;
    const scale = Math.max(1, Math.min(shelfW / widest, (2 * hh * 0.70) / totalH, 2.6));
    // (0, centerY, depth) 점을 고정한 채 확대
    this.el.object3D.scale.setScalar(scale);
    this.el.object3D.position.set(0, this.data.centerY * (1 - scale), this.data.depth * (1 - scale));
    this.scale = scale;

    shelves.forEach((row, si) => {
      const rowW = row.reduce((s, g) => s + groupW(g), 0);
      const shelfY = this.data.centerY + totalH / 2 - this.data.shelfGap * (si + 1) + 0.08; // 선반 윗면 높이
      // 선반 판
      const board = document.createElement("a-box");
      board.setAttribute("width", (rowW + 0.3).toFixed(2)); board.setAttribute("height", "0.035"); board.setAttribute("depth", (D + 0.12).toFixed(2));
      board.setAttribute("position", `0 ${(shelfY - 0.0175).toFixed(3)} ${(this.data.depth + 0.02).toFixed(3)}`);
      board.addEventListener("loaded", () => {
        const m = board.getObject3D("mesh"); m.material = new THREE.MeshLambertMaterial({ map: woodTexture() }); m.material.needsUpdate = true;
      }, { once: true });
      this.el.appendChild(board);
      // 선반 뒤판 (어두운)
      const back = document.createElement("a-plane");
      back.setAttribute("width", (rowW + 0.3).toFixed(2)); back.setAttribute("height", (this.data.shelfGap - 0.02).toFixed(2));
      back.setAttribute("position", `0 ${(shelfY + (this.data.shelfGap - 0.02) / 2 - 0.02).toFixed(3)} ${(this.data.depth - D / 2 - 0.05).toFixed(3)}`);
      back.setAttribute("material", "shader: flat; color: #1c1510");
      this.el.appendChild(back);

      let x = -rowW / 2;
      for (const g of row) {
        // 연도 구분판 + 라벨
        x += LABEL_PAD / 2;
        const div = document.createElement("a-box");
        div.setAttribute("width", "0.012"); div.setAttribute("height", (H * 0.8).toFixed(2)); div.setAttribute("depth", (D * 0.9).toFixed(2));
        div.setAttribute("position", `${x.toFixed(3)} ${(shelfY + H * 0.4).toFixed(3)} ${this.data.depth}`);
        div.setAttribute("material", "color: #8c6d3c; metalness: 0.4; roughness: 0.5");
        this.el.appendChild(div);
        const plate = document.createElement("a-plane");
        plate.setAttribute("width", "0.16"); plate.setAttribute("height", "0.056");
        plate.setAttribute("position", `${(x + 0.10).toFixed(3)} ${(shelfY - 0.06).toFixed(3)} ${(this.data.depth + D / 2 + 0.07).toFixed(3)}`);
        plate.setAttribute("material", "shader: flat");
        const plateCanvas = drawYearPlate(g.year);
        plate.addEventListener("loaded", () => { const m = plate.getObject3D("mesh"); m.material.map = canvasTex(plateCanvas); m.material.needsUpdate = true; }, { once: true });
        this.el.appendChild(plate);
        x += LABEL_PAD / 2 + DIVIDER;
        for (const p of g.items) {
          const t = thickOf(p);
          const h = H + ((hashOf(p.title) % 9) - 4) * 0.01; // 살짝 다른 높이
          x += t / 2;
          const node = document.createElement("a-entity");
          node.setAttribute("position", `${x.toFixed(3)} ${(shelfY + h / 2).toFixed(3)} ${this.data.depth}`);
          node.paper = p;
          node.setAttribute("paper-node", `thick: ${t.toFixed(3)}; height: ${h.toFixed(3)}; depth: ${D}`);
          this.el.appendChild(node);
          x += t / 2 + GAP;
        }
        x += 0.04;
      }
    });
  },
});

AFRAME.registerComponent("paper-node", {
  schema: {
    thick: { default: 0.06 },
    height: { default: 0.4 },
    depth: { default: 0.28 },
    pullDist: { default: 1.4 },
    openDist: { default: 2.0 },
    openThreshold: { default: 0.8 },
    lerp: { default: 0.18 },
    hoverPull: { default: 0.06 },  // 호버 시 책이 앞으로 나오는 거리
    dimOpacity: { default: 0.35 },
  },

  init() {
    const el = this.el, d = this.data, p = el.paper;
    this.state = "idle";
    this.home = el.object3D.position.clone();
    this.goal = new THREE.Vector3();
    this.camEl = document.getElementById("camera");
    this.cursorEl = document.getElementById("cursor");
    this.rayEl = document.getElementById("ray");
    this.camPos = new THREE.Vector3(); this.camDir = new THREE.Vector3(); this.cur = new THREE.Vector3();
    this.glowT = 0; this.pulse = 0; this.ghost = null;
    this.spineCanvas = drawSpine(p); this.coverCanvas = drawCover(p);

    const v = buildBook(el, this.spineCanvas, this.coverCanvas, d.thick, d.height, d.depth);
    this.book = v.book; this.glow = v.glow; this.hit = v.hit;
    this.hit.paperEl = el;

    const isNearest = () => this.rayEl.components.raycaster?.intersectedEls[0] === this.hit;
    this.isNearest = isNearest;
    this.hit.addEventListener("pinchstart", () => this.onPinch());
    this.w1 = new THREE.Vector3(); this.w2 = new THREE.Vector3();
    el.sceneEl.addEventListener("pinchend-any", () => {
      if (this.state !== "grabbed" || !this.ghost) return;
      // 월드 거리로 판단 (부모 서가가 확대되어 있을 수 있음)
      this.ghost.object3D.getWorldPosition(this.w1); el.object3D.getWorldPosition(this.w2);
      if (this.w1.distanceTo(this.w2) > d.openThreshold) { this.state = "open"; el.emit("paper-open", { paper: p }, true); }
      else this.close();
    });
  },

  onPinch() {
    this.pulse = 1;
    if (this.state === "idle" || this.state === "returning") {
      this.spawnGhost();
      this.state = "grabbed";
      this.el.emit("paper-grab", { paper: this.el.paper }, true);
    } else if (this.state === "open") this.close();
  },

  spawnGhost() {
    if (this.ghost) return;
    const d = this.data;
    const ghost = document.createElement("a-entity");
    ghost.object3D.position.copy(this.el.object3D.position);
    ghost.object3D.position.z += 0.02;
    this.el.parentNode.appendChild(ghost);
    const v = buildBook(ghost, this.spineCanvas, this.coverCanvas, d.thick, d.height, d.depth);
    v.hit.paperEl = this.el;
    v.hit.addEventListener("pinchstart", () => this.onPinch());
    this.ghost = ghost; this.ghostGlow = v.glow; this.ghostBook = v.book;
    this.setBookOpacity(d.dimOpacity);
  },

  removeGhost() {
    if (!this.ghost) return;
    this.ghost.parentNode.removeChild(this.ghost);
    this.ghost = null; this.ghostGlow = null; this.ghostBook = null;
    this.setBookOpacity(1);
  },

  setBookOpacity(o) {
    const mesh = this.book.getObject3D("mesh");
    if (!mesh) return;
    for (const m of mesh.material) { m.transparent = o < 1; m.opacity = o; m.needsUpdate = true; }
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

    // 원본: 제자리, 호버 시 앞으로 살짝 뽑힘
    this.goal.copy(this.home); if (this.hovered && this.state === "idle") this.goal.z += d.hoverPull;
    el.object3D.position.lerp(this.goal, 0.25);

    // 복제: 손으로 오면서 표지가 보이게 회전 (y축 -90°: +x 면이 카메라를 향함)
    if (this.ghost) {
      const gpos = this.ghost.object3D.position, grot = this.ghost.object3D.rotation;
      let targetRotY = 0, targetScale = 1;
      const parent = this.ghost.parentNode.object3D; // 서가(확대됨). 목표는 월드로 계산해 부모 로컬로 변환
      const ps = parent.scale.x || 1;
      if (this.state === "grabbed") {
        this.camEl.object3D.getWorldPosition(this.camPos);
        this.cursorEl.object3D.getWorldPosition(this.cur);
        this.goal.copy(this.cur).sub(this.camPos).normalize().multiplyScalar(d.pullDist).add(this.camPos);
        parent.worldToLocal(this.goal);
        gpos.lerp(this.goal, d.lerp); targetRotY = -Math.PI / 2; targetScale = 1.1 / ps;
      } else if (this.state === "open") {
        this.camEl.object3D.getWorldPosition(this.camPos);
        this.camEl.object3D.getWorldDirection(this.camDir);
        const cam = this.camEl.getObject3D("camera");
        const hw = d.openDist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect;
        this.goal.copy(this.camPos).addScaledVector(this.camDir, -d.openDist);
        this.goal.x -= hw * 0.42; this.goal.y += 0.05;
        parent.worldToLocal(this.goal);
        gpos.lerp(this.goal, d.lerp); targetRotY = -Math.PI / 2; targetScale = 1.6 / ps;
      } else if (this.state === "returning") {
        gpos.lerp(this.home, d.lerp); targetRotY = 0;
        if (gpos.distanceTo(this.home) < 0.015) { this.removeGhost(); this.state = "idle"; }
      }
      if (this.ghost) {
        grot.y += (targetRotY - grot.y) * 0.15;
        const s = this.ghost.object3D.scale.x + (targetScale - this.ghost.object3D.scale.x) * 0.2;
        this.ghost.object3D.scale.setScalar(s);
        const gm = this.ghostGlow.getObject3D("mesh")?.material;
        if (gm) gm.opacity = this.state === "returning" ? 0.15 : 0.35 + 0.5 * this.pulse;
      }
    }

    // 원본 발광 (idle 호버) + 펄스
    const wantGlow = this.hovered && this.state === "idle" ? 1 : 0;
    this.glowT += (wantGlow - this.glowT) * Math.min(1, dt / 90);
    this.pulse = Math.max(0, this.pulse - dt / 260);
    const glowMat = this.glow.getObject3D("mesh")?.material;
    if (glowMat) glowMat.opacity = 0.6 * this.glowT + (this.state === "idle" ? 0.5 * this.pulse : 0);
    this.glow.object3D.scale.setScalar(1 + 0.08 * this.pulse);
  },
});
