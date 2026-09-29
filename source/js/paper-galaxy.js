/* paper-galaxy.js — 코어 링을 대체하는 3D 코어: 논문 44편의 은하 (2026-09-30 사용자 결정).
 * 레퍼런스: 사용자가 보낸 자비스 영상(TikTok @tectimmy "Working on Jarvis") — 점들이 퍼지는 연출, 손으로 돌리는 조작.
 * 사용자 결정
 *   - 코어를 대체 (겹치지 않게), 위쪽 연구 주제 분류는 삭제
 *   - 배치: 연도 = 나선 (가운데 2016 → 바깥 2026). 논문 주변의 작은 점 = 그 논문이 쓰는 개념 (여러 논문이 쓰면 그 사이에)
 *   - 고르기: 편 손을 좌우로 돌리면 논문이 앞의 "조준 자리"를 지나가고, 앞에 온 논문을 핀치 (작은 점을 겨누지 않음)
 *   - 가독성: 상황별로 물러남 (첫 화면 100% / 논문 선택 20% / 상세 창·층 구조 8%), 글자는 고정된 조준 카드 하나에만
 *
 * <a-entity id="galaxy" position="0 1.35 -7" paper-galaxy="radius: 4.2; tilt: 0.42"> (index.html)
 * 조준 카드(#focus-card)는 이 컴포넌트가 장면에 만든다: 크고 고정된 대상이라 흔들리는 손 추적에도 누르기 쉬움.
 *   카드 핀치 → paper-select {id} (hud가 논문 로드), 카드에는 pullable이 붙어 "핀치 후 손 펴기 = 층 펼치기"가 그대로 동작.
 * hud가 알려 주는 것: setPapers(papers, users), setSelected(id, conceptIds), dim(0~1), canRotate
 * 그리기 도우미(canvasOf, texOf, flatMesh, hitMesh, fit, wrapLines, brackets, clamp01, HUD, FT, FK)는 hud.js 것 → hud.js 다음에 로드
 */

function galaxyHash(s, k = 0) { let h = 2166136261 ^ k; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }
function galaxyDot() {
  const c = canvasOf(64, 64), g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,0.85)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return texOf(c);
}
function galaxyYearLabel(y) {
  const c = canvasOf(160, 64), g = c.getContext("2d");
  g.fillStyle = HUD.cyan2; g.font = `600 40px ${FT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(y), 80, 34);
  return texOf(c);
}
// 조준 카드: 앞에 온 논문의 연도·제목 + 할 수 있는 동작
function drawFocusCard(c, { paper, selected, hot, compact }) {
  const g = c.getContext("2d"), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = hot ? "rgba(10,40,56,0.95)" : "rgba(4,16,24,0.92)"; g.fillRect(6, 6, W - 12, H - 12);
  g.strokeStyle = hot || selected ? HUD.cyan2 : HUD.line; g.lineWidth = hot ? 5 : 3; g.strokeRect(6, 6, W - 12, H - 12);
  brackets(g, 6, 6, W - 12, H - 12, 36, HUD.cyan, 6);
  if (!paper) return;
  if (compact) { // 층이 펼쳐진 동안: 접기 버튼 (크게 한 줄)
    g.fillStyle = HUD.cyan2; g.font = `700 72px ${FK}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("▼  핀치 = 층 접기", W / 2, H / 2 + 4);
    return;
  }
  g.textBaseline = "alphabetic"; g.textAlign = "left";
  g.fillStyle = HUD.cyan; g.font = `700 46px ${FT}`; g.fillText(`${paper.year ?? ""}`, 40, 72);
  g.fillStyle = HUD.muted; g.font = `500 32px ${FK}`; g.fillText(fit(g, paper.venue || "", W - 260), 170, 70);
  g.fillStyle = "#ffffff"; g.font = `600 44px ${FT}`;
  wrapLines(g, paper.title, W - 80, 2).forEach((l, i) => g.fillText(l, 40, 134 + i * 54));
  g.fillStyle = HUD.cyan2; g.font = `600 32px ${FK}`; g.textAlign = "center";
  g.fillText(selected ? "선택됨 · 핀치 = 패널 접기·펴기 · 핀치 후 손 펴기 = 층 펼치기" : "◀ 편 손 좌우 = 돌리기 ▶    핀치 = 이 논문 선택", W / 2, H - 34);
}
const galaxyEase = (t) => 1 - Math.pow(1 - clamp01(t), 3);

AFRAME.registerComponent("paper-galaxy", {
  schema: {
    radius: { default: 4.2 },     // 가장 바깥(최신) 논문의 반지름 (m)
    tilt: { default: 0.42 },      // 원반을 앞으로 기울인 각 (rad) — 깊이가 보이게
    turns: { default: 0.92 },     // 나선이 도는 바퀴 수 (1 미만: 같은 방향에 두 논문이 겹치지 않게)
    dust: { default: 1400 },      // 배경 먼지 점 (장식, 아주 옅게)
    rotateGain: { default: 3.0 },  // 편 손 좌우 이동 → 회전 (9/30: 5 둔함 → 10 빠름 → 6 → 사용자 지정 3)
    burstMs: { default: 1800 },   // 처음 퍼지는 연출 시간
    cardPos: { type: "vec3", default: { x: 0, y: 0.42, z: -2.5 } }, // 조준 카드 자리 (화면 아래 가운데, 고정)
    cardW: { default: 1.7 },
  },
  init() {
    this.dim = 1; this.op = 0; this.canRotate = true;
    this.yaw = 0; this.vel = 0; this.rot = null; this.focus = -1; this.selId = null; this.selT = 0;
    this.tilt = new THREE.Group(); this.tilt.rotation.x = this.data.tilt;
    this.spinG = new THREE.Group(); this.tilt.add(this.spinG);
    this.el.setObject3D("mesh", this.tilt);
    this.tmp = new THREE.Vector3(); this.tmp2 = new THREE.Vector3();
    // 마우스·키보드 대체: 휠 또는 ←/→ 로 한 편씩
    this.onWheel = (e) => { if (this.papers && this.canRotate) this.step(Math.sign(e.deltaY)); };
    this.onKey = (e) => { if (!this.papers || !this.canRotate) return; if (e.key === "ArrowRight") this.step(1); if (e.key === "ArrowLeft") this.step(-1); };
    window.addEventListener("wheel", this.onWheel, { passive: true });
    window.addEventListener("keydown", this.onKey);
  },
  remove() { window.removeEventListener("wheel", this.onWheel); window.removeEventListener("keydown", this.onKey); },

  // hud가 논문 목록(연도순)과 개념 → 논문 역색인을 넘겨 줌
  setPapers(papers, users) {
    const d = this.data, R = d.radius, N = papers.length, dot = galaxyDot();
    this.papers = papers.map((p, i) => {
      const t = N > 1 ? i / (N - 1) : 0;
      const th = t * Math.PI * 2 * d.turns, r = R * (0.32 + 0.68 * t);
      return { p, th, target: new THREE.Vector3(Math.cos(th) * r, 0.18 * (galaxyHash(p.id, 1) - 0.5), Math.sin(th) * r), pos: new THREE.Vector3() };
    });
    this.byPaper = Object.fromEntries(this.papers.map((n) => [n.p.id, n]));
    // 개념: 그 개념을 쓰는 논문들의 가운데 + 약간 흩뿌림 (여러 논문이 쓰면 그 사이에)
    this.concepts = Object.entries(users || {}).map(([cid, us]) => {
      const ns = us.map((u) => this.byPaper[u.paperId]).filter(Boolean);
      if (!ns.length) return null;
      const c = new THREE.Vector3(); ns.forEach((n) => c.add(n.target)); c.multiplyScalar(1 / ns.length);
      const a = galaxyHash(cid, 2) * Math.PI * 2, s = 0.25 + 0.35 * galaxyHash(cid, 3);
      c.x += Math.cos(a) * s; c.z += Math.sin(a) * s; c.y += 0.25 * (galaxyHash(cid, 4) - 0.5);
      return { id: cid, target: c, pos: new THREE.Vector3(), papers: ns };
    }).filter(Boolean);
    this.conceptById = Object.fromEntries(this.concepts.map((c) => [c.id, c]));
    // 먼지: 나선 띠를 따라 + 원반 전체에 옅게
    this.dust = [];
    for (let i = 0; i < d.dust; i++) {
      const t = galaxyHash("d" + i, 5), band = i % 3 !== 0;
      const th = band ? t * Math.PI * 2 * d.turns + 0.35 * (galaxyHash("d" + i, 6) - 0.5) : galaxyHash("d" + i, 7) * Math.PI * 2;
      const r = band ? R * (0.32 + 0.68 * t) + 0.45 * (galaxyHash("d" + i, 8) - 0.5) : R * 1.1 * Math.sqrt(galaxyHash("d" + i, 9));
      this.dust.push({ target: new THREE.Vector3(Math.cos(th) * r, 0.3 * (galaxyHash("d" + i, 10) - 0.5), Math.sin(th) * r), pos: new THREE.Vector3() });
    }
    const pts = (n, size, color, opacity) => {
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(1, n) * 3), 3));
      const m = new THREE.PointsMaterial({ size, map: dot, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
      const o = new THREE.Points(geo, m); o.raycast = () => {}; o.frustumCulled = false; this.spinG.add(o); return o;
    };
    const lines = (n, color) => {
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(1, n) * 6), 3));
      const o = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      o.raycast = () => {}; o.frustumCulled = false; this.spinG.add(o); return o;
    };
    this.dustPts = pts(this.dust.length, 0.05, HUD.cyan, 0.3);
    this.conceptPts = pts(this.concepts.length, 0.07, HUD.cyan, 0.7);
    this.paperPts = pts(this.papers.length, 0.2, "#ffffff", 1);
    this.spiral = lines(this.papers.length - 1, HUD.cyan);             // 연도 나선 (논문을 순서대로 잇는 선)
    this.links = lines(this.concepts.reduce((s, c) => s + c.papers.length, 0), HUD.cyan); // 논문 ↔ 개념 (아주 옅게)
    this.focusPt = pts(1, 0.5, HUD.cyan2, 0);                          // 조준 자리의 논문 (크게)
    this.selPt = pts(1, 0.42, "#ffffff", 0);                            // 선택한 논문
    this.selConcepts = pts(40, 0.14, "#ffffff", 0);                     // 선택한 논문의 개념 (밝게)
    this.rays = lines(40, HUD.cyan2);                                   // 선택한 논문 → 그 개념 (빛줄기)
    // 연도 표시 (그해 첫 논문 옆, 첫 화면에서만)
    this.years = new THREE.Group(); this.spinG.add(this.years);
    let prev = null, lastTh = -9;
    for (const n of this.papers) {
      if (n.p.year === prev) continue; prev = n.p.year;
      if (n.th - lastTh < 0.45) continue; // 앞 연도 표시와 너무 가까우면 건너뜀 (겹쳐 읽을 수 없음)
      lastTh = n.th;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: galaxyYearLabel(n.p.year), transparent: true, depthWrite: false, opacity: 0 }));
      sp.scale.set(0.5, 0.2, 1); sp.userData.node = n; sp.raycast = () => {}; this.years.add(sp);
    }
    this.buildCard();
    this.t0 = performance.now(); // 퍼지는 연출 시작
    this.snapTo(this.papers.length - 1, true); // 처음엔 최신 논문이 앞에
  },
  // 조준 카드 (장면에 고정). hud의 대상 규칙과 같게: .target 클래스, hudKind/hudLabel, press-feedback, pullable
  buildCard() {
    const d = this.data, w = d.cardW, h = w * 0.3;
    this.cardCv = canvasOf(1100, Math.round(1100 * 0.3)); this.cardTex = texOf(this.cardCv);
    const grp = new THREE.Group();
    this.cardMesh = flatMesh(new THREE.PlaneGeometry(w, h), this.cardTex, 0); this.cardMesh.renderOrder = 8;
    grp.add(this.cardMesh, hitMesh(w * 1.04, h * 1.1));
    const el = document.createElement("a-entity"); el.id = "focus-card";
    this.el.sceneEl.appendChild(el);
    el.setObject3D("mesh", grp);
    el.object3D.position.set(d.cardPos.x, d.cardPos.y, d.cardPos.z);
    el.hudKind = "focus"; el.hudLabel = "";
    el.setAttribute("press-feedback", "");
    el.setAttribute("pullable", "");
    el.addEventListener("pinchstart", () => { const n = this.papers[this.focus]; if (n) this.el.emit("paper-select", { id: n.p.id }); });
    this.card = el; this.cardHot = null;
  },
  // 논문 i를 조준 자리로 (앞 = 카메라 쪽 = 각도 π/2)
  yawFor(i) { return this.papers[i].th - Math.PI / 2; },
  // 은하는 계속 돌아감(끝이 없음) → 지금 각도에서 가장 가까운 같은 자리(2π 배수)로 맞춤
  snapTo(i, now) { const y = this.yawFor(i); this.snapYaw = y + 2 * Math.PI * Math.round((this.yaw - y) / (2 * Math.PI)); if (now) this.yaw = this.snapYaw; },
  focusPaper(id) { const i = this.papers?.findIndex((n) => n.p.id === id); if (i >= 0) { this.vel = 0; this.snapTo(i); } },
  step(dir) { const N = this.papers.length, i = (((this.focus < 0 ? 0 : this.focus) + dir) % N + N) % N; this.vel = 0; this.snapTo(i); },
  // 선택한 논문과 그 개념 (hud가 부름). null이면 해제
  setSelected(id, conceptIds = []) { this.selId = id; this.selConcepts_ = conceptIds; this.selT = performance.now(); this.drawCard(true); },

  tick(t, dt) {
    if (!this.papers || !dt) return;
    const now = performance.now(), d = this.data, R = d.radius;
    // 1) 퍼지는 연출: 가운데서 바깥으로, 안쪽(오래된 논문)부터
    const bt = now - this.t0, bursting = bt < d.burstMs + 700;
    if (bursting || !this.placed) {
      const place = (n) => { const r = n.target.length() / R; n.pos.copy(n.target).multiplyScalar(galaxyEase((bt - r * 600) / d.burstMs)); };
      for (const n of this.papers) place(n); for (const n of this.concepts) place(n); for (const n of this.dust) place(n);
      this.placed = !bursting;
      this.write(this.paperPts, this.papers.map((n) => n.pos));
      this.write(this.conceptPts, this.concepts.map((n) => n.pos));
      this.write(this.dustPts, this.dust.map((n) => n.pos));
      const sp = this.spiral.geometry.attributes.position;
      for (let i = 0; i < this.papers.length - 1; i++) { const a = this.papers[i].pos, b = this.papers[i + 1].pos; sp.setXYZ(i * 2, a.x, a.y, a.z); sp.setXYZ(i * 2 + 1, b.x, b.y, b.z); }
      sp.needsUpdate = true;
      const lp = this.links.geometry.attributes.position; let k = 0;
      for (const c of this.concepts) for (const n of c.papers) { lp.setXYZ(k++, n.pos.x, n.pos.y, n.pos.z); lp.setXYZ(k++, c.pos.x, c.pos.y, c.pos.z); }
      lp.needsUpdate = true;
    }
    // 2) 밝기 (hud가 정한 목표로 천천히)
    this.op += (this.dim - this.op) * (1 - Math.exp(-dt / 250));
    const op = this.op, idle = this.dim >= 0.99;
    this.paperPts.material.opacity = op;
    this.conceptPts.material.opacity = 0.7 * op;
    this.dustPts.material.opacity = 0.3 * op;
    this.spiral.material.opacity = 0.35 * op;
    this.links.material.opacity = 0.05 * op;
    for (const s of this.years.children) { s.position.copy(s.userData.node.pos).add(this.tmp.set(0, 0.28, 0)); s.material.opacity += ((idle ? 0.8 : 0) - s.material.opacity) * 0.1; }
    // 3) 돌리기: 편 손 좌우 (속도로), 손을 멈추면 가장 가까운 논문에 맞춰 멈춤
    this.rotateByHand(dt);
    if (!this.rot) {
      this.vel *= Math.exp(-dt / 350);
      if (Math.abs(this.vel) < 0.25) {
        if (this.snapYaw == null) this.snapTo(this.nearest());
        this.yaw += (this.snapYaw - this.yaw) * (1 - Math.exp(-dt / 160));
      } else this.snapYaw = null;
    } else this.snapYaw = null;
    this.yaw += this.vel * dt / 1000;
    // (9/30) 나선 끝에서 멈추게 했더니 최신 논문에서 시작할 때 한쪽으로는 돌지 않았음 → 끝없이 돌게 (최신 다음 = 가장 오래된 논문)
    this.spinG.rotation.y = this.yaw;
    // 4) 조준 자리의 논문
    const f = this.nearest();
    if (f !== this.focus) { this.focus = f; this.drawCard(true); }
    const fn = this.papers[f];
    this.write(this.focusPt, [fn.pos]); this.focusPt.material.opacity = Math.max(0.4, op);
    // 5) 선택한 논문: 별 + 그 개념이 밝아지고 빛줄기가 뻗어 나감
    const sel = this.selId && this.byPaper[this.selId];
    const cs = sel ? (this.selConcepts_ || []).map((id) => this.conceptById[id]).filter(Boolean).slice(0, 40) : [];
    this.write(this.selPt, sel ? [sel.pos] : []); this.selPt.material.opacity = sel ? 1 : 0;
    this.write(this.selConcepts, cs.map((c) => c.pos), 40); this.selConcepts.material.opacity = cs.length ? Math.max(0.5, op * 3) : 0;
    const grow = galaxyEase((now - this.selT) / 900), rp = this.rays.geometry.attributes.position;
    for (let i = 0; i < 40; i++) {
      const c = cs[i];
      if (!c) { rp.setXYZ(i * 2, 0, 0, 0); rp.setXYZ(i * 2 + 1, 0, 0, 0); continue; }
      rp.setXYZ(i * 2, sel.pos.x, sel.pos.y, sel.pos.z);
      this.tmp2.copy(sel.pos).lerp(c.pos, grow); rp.setXYZ(i * 2 + 1, this.tmp2.x, this.tmp2.y, this.tmp2.z);
    }
    rp.needsUpdate = true; this.rays.material.opacity = cs.length ? 0.6 * Math.max(0.5, op * 3) : 0;
    // 6) 조준 카드: 은하가 물러나도 논문을 바꿀 수 있게 보이되, 상세 창이 열리면 숨김
    // 카드는 패널이 열려 있어도 선명하게 (논문을 바꿀 수 있게). 상세 창이 열렸을 때만 흐리게 (그때는 레이도 잠김)
    const cardOp = this.detailOpen ? 0.35 : 1;
    this.cardMesh.material.opacity += (cardOp - this.cardMesh.material.opacity) * 0.15;
    if (this.compact !== this.wasCompact) { this.wasCompact = this.compact; this.drawCard(); }
    const cp = this.data.cardPos, ks = this.compact ? 0.5 : 1, ky = this.compact ? cp.y - 0.2 : cp.y;
    const co = this.card.object3D;
    co.position.y += (ky - co.position.y) * 0.2;
    co.scale.setScalar(co.scale.x + (ks - co.scale.x) * 0.2);
    const hot = this.el.sceneEl.components["hand-cursor"]?.target === this.card;
    if (hot !== this.cardHot) { this.cardHot = hot; this.drawCard(); }
    const hittable = this.cardMesh.material.opacity > 0.3;
    if (this.card.classList.contains("target") !== hittable) { this.card.classList.toggle("target", hittable); this.el.emit("hud-hit-dirty"); }
  },
  nearest() {
    let best = 0, bd = Infinity;
    this.papers.forEach((n, i) => { const dd = Math.abs(Math.atan2(Math.sin(n.th - Math.PI / 2 - this.yaw), Math.cos(n.th - Math.PI / 2 - this.yaw))); if (dd < bd) { bd = dd; best = i; } });
    return best;
  },
  drawCard(changed) {
    const n = this.papers?.[this.focus];
    drawFocusCard(this.cardCv, { paper: n?.p, selected: n && n.p.id === this.selId, hot: this.cardHot, compact: this.compact });
    this.cardTex.needsUpdate = true;
    if (n) { this.card.hudRef = n.p.id; this.card.hudLabel = `${n.p.year} · ${n.p.title}`; }
  },
  write(o, list, cap) {
    const a = o.geometry.attributes.position;
    list.forEach((p, i) => a.setXYZ(i, p.x, p.y, p.z));
    o.geometry.setDrawRange(0, list.length);
    a.needsUpdate = true;
  },
  // 편 손 좌우 = 돌리기. 돌리는 동안 커서는 멈춤 (hand-cursor.hold)
  rotateByHand(dt) {
    const hc = this.el.sceneEl.components["hand-cursor"];
    const busy = hc?.holdOwner && hc.holdOwner !== "galaxy"; // 층 구조를 잡고 펼치는 중이면 양보
    // 편 손 기준 (9/30 "돌리기가 안 됨": 모델의 Open_Palm 점수는 편 손도 0.6~0.8이라 0.8 기준을 거의 못 넘었음) → 시작 0.55 / 멈춤 0.35
    const o = hc?.openness ?? 0, openEnough = this.rot ? o > 0.35 : o > 0.55;
    // z-버퍼처럼 (9/30 사용자 지적 "패널과 은하가 동시에 멈춤"): 회전은 커서가 빈 공간(= 뒤의 은하)을 가리킬 때만 시작.
    // 패널·카드·노드 위(더 앞의 대상)나 HTML 위에서는 그 대상이 우선. 한번 돌기 시작하면 커서는 멈춰 있으므로 계속 돔
    const overSomething = !!hc?.target || !!hc?.overUi;
    const open = hc?.mode === "hand" && openEnough && !hc.pinching && this.canRotate && !busy && hc.filtered && (this.rot || !overSomething);
    if (open) {
      if (!this.rot) { this.rot = { x: hc.filtered[0] }; hc.hold = hc.norm?.slice() ?? null; hc.holdOwner = "galaxy"; }
      const x = hc.filtered[0];
      this.vel = 0.7 * this.vel + 0.3 * ((x - this.rot.x) * this.data.rotateGain * 1000 / dt);
      this.rot.x = x;
    } else if (this.rot) {
      this.rot = null;
      if (hc?.holdOwner === "galaxy") { hc.hold = null; hc.holdOwner = null; }
    }
  },
});
