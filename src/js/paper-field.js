/* paper-field: papers.json을 읽어 논문 노드를 3D에 배치.
 * paper-node : hover 강조, pinch로 집기, 당겨서 열기, 다시 pinch로 되돌리기.
 * 원리 설명: docs/09-how-it-works.md §3, §5
 *
 * v2: 노드 = <a-entity paper-node> 안에
 *   - .vis     보이는 구 (반지름 = 크기)
 *   - .target  보이지 않는 히트 영역 (반지름 × hitScale). Meta/Apple 가이드의 "타깃은 보이는 것보다 크게"
 *   - 라벨 + 라벨 배경
 * 집는 동안(grabbed) 노드는 커서 방향의 pullDist 지점을 따라옴 (손에 붙어 오는 느낌).
 */

function hueOf(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

AFRAME.registerComponent("paper-field", {
  schema: {
    src: { default: "data/papers.json" },
    depth: { default: -3.5 },   // 노드 z (카메라 앞 거리). 가까울수록 크게 보임
    centerY: { default: 1.6 },
    gapY: { default: 0.55 },
    minR: { default: 0.16 },    // 최소 반지름. 멀리서도 겨냥 가능한 크기
    hitScale: { default: 1.7 }, // 히트 영역 배율
    max: { default: 60 },
  },

  async init() {
    const res = await fetch(this.data.src);
    const json = await res.json();
    const papers = json.papers.slice(0, this.data.max);
    this.el.emit("papers-loaded", { author: json.author, count: papers.length, source: json.source });

    const years = papers.map((p) => p.year).filter(Boolean);
    const minY = Math.min(...years), maxY = Math.max(...years);
    const byYear = {};
    for (const p of papers) (byYear[p.year] ??= []).push(p);

    if (!this.el.sceneEl.hasLoaded) await new Promise((r) => this.el.sceneEl.addEventListener("loaded", r, { once: true }));
    const cam = document.getElementById("camera").getObject3D("camera");
    const hh = Math.abs(this.data.depth) * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const width = 2 * hh * cam.aspect * 0.82;
    const tallest = Math.max(...Object.values(byYear).map((l) => l.length));
    const gapY = Math.min(this.data.gapY, (2 * hh * 0.72) / Math.max(1, tallest - 1));

    for (const [year, list] of Object.entries(byYear)) {
      const t = maxY === minY ? 0.5 : (Number(year) - minY) / (maxY - minY);
      const x = (t - 0.5) * width;
      list.sort((a, b) => b.cited - a.cited);
      list.forEach((p, i) => {
        const y = this.data.centerY + (i - (list.length - 1) / 2) * gapY;
        const z = this.data.depth + (i % 2) * 0.12;
        const r = Math.max(this.data.minR, 0.12 + 0.06 * Math.log10((p.cited ?? 0) + 1));
        // 히트 영역은 보이는 구보다 크게, 단 이웃과 겹치지 않게 (세로 간격의 48% 이하)
        const hitR = Math.min(r * this.data.hitScale, gapY * 0.48);
        const node = document.createElement("a-entity");
        node.setAttribute("position", `${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`);
        node.paper = p;
        node.setAttribute("paper-node", `radius: ${r.toFixed(3)}; hitRadius: ${hitR.toFixed(3)}; color: hsl(${hueOf(p.venue || "?")}, 55%, 55%)`);
        this.el.appendChild(node);
      });
    }

    // 연도 축: 선 + 눈금
    const axisY = this.data.centerY - hh * 0.82;
    const axis = document.createElement("a-box");
    axis.setAttribute("position", `0 ${axisY.toFixed(2)} ${this.data.depth}`);
    axis.setAttribute("width", width.toFixed(2)); axis.setAttribute("height", "0.01"); axis.setAttribute("depth", "0.01");
    axis.setAttribute("color", "#2f3b5c");
    this.el.appendChild(axis);
    const step = Math.max(1, Math.round((maxY - minY) / 6));
    for (let y = minY; y <= maxY; y += step) {
      const t = maxY === minY ? 0.5 : (y - minY) / (maxY - minY);
      const label = document.createElement("a-text");
      label.setAttribute("value", String(y));
      label.setAttribute("align", "center");
      label.setAttribute("width", "2.2");
      label.setAttribute("color", "#8892b0");
      label.setAttribute("position", `${((t - 0.5) * width).toFixed(2)} ${(axisY - 0.22).toFixed(2)} ${this.data.depth}`);
      this.el.appendChild(label);
    }
  },
});

AFRAME.registerComponent("paper-node", {
  schema: {
    radius: { default: 0.2 },
    hitRadius: { default: 0.26 },
    color: { default: "#6a8bd6" },
    pullDist: { default: 1.3 },      // 집었을 때 커서 방향으로 이 거리까지 당겨옴
    openThreshold: { default: 0.8 }, // 원위치에서 이만큼 벗어나 있으면 놓을 때 '열림'
    lerp: { default: 0.18 },
  },

  init() {
    const el = this.el, d = this.data;
    this.state = "idle"; // idle | grabbed | open | returning
    this.home = el.object3D.position.clone();
    this.goal = new THREE.Vector3();
    this.camEl = document.getElementById("camera");
    this.cursorEl = document.getElementById("cursor");
    this.camPos = new THREE.Vector3(); this.camDir = new THREE.Vector3(); this.cur = new THREE.Vector3();

    // 보이는 구
    const vis = document.createElement("a-sphere");
    vis.classList.add("vis");
    vis.setAttribute("radius", d.radius);
    vis.setAttribute("color", d.color);
    vis.setAttribute("material", "roughness: 0.6; metalness: 0.1");
    el.appendChild(vis);
    this.vis = vis;

    // 히트 영역 (투명). 레이는 이것에 맞음
    const hit = document.createElement("a-sphere");
    hit.classList.add("target");
    hit.setAttribute("radius", Math.max(d.radius, d.hitRadius).toFixed(3));
    hit.setAttribute("material", "opacity: 0; transparent: true; depthWrite: false");
    hit.paperEl = el;
    el.appendChild(hit);
    this.hit = hit;

    // 라벨 (호버 시)
    const title = el.paper?.title ?? "";
    const short = title.length > 64 ? title.slice(0, 64) + "…" : title;
    const labelWrap = document.createElement("a-entity");
    labelWrap.setAttribute("position", `0 ${(d.radius + 0.28).toFixed(2)} 0.05`);
    labelWrap.setAttribute("visible", "false");
    const bg = document.createElement("a-plane");
    bg.setAttribute("width", "2.6"); bg.setAttribute("height", "0.34");
    bg.setAttribute("color", "#0b0f1a"); bg.setAttribute("material", "opacity: 0.85; transparent: true");
    const label = document.createElement("a-text");
    label.setAttribute("value", short); label.setAttribute("align", "center");
    label.setAttribute("width", "2.4"); label.setAttribute("wrap-count", "48"); label.setAttribute("color", "#e6f1ff");
    label.setAttribute("position", "0 0 0.01");
    labelWrap.appendChild(bg); labelWrap.appendChild(label);
    el.appendChild(labelWrap);
    this.label = labelWrap;

    // 레이는 한 줄에 여러 노드를 관통할 수 있음 → 가장 가까운 것(els[0])만 호버로 인정
    this.ray = document.getElementById("ray");
    const isNearest = () => this.ray.components.raycaster?.intersectedEls[0] === hit;
    hit.addEventListener("raycaster-intersected", () => { if (isNearest()) this.setHover(true); });
    hit.addEventListener("raycaster-intersected-cleared", () => { if (this.hovered) this.setHover(false); });
    this.isNearest = isNearest;

    hit.addEventListener("pinchstart", () => {
      if (this.state === "idle" || this.state === "returning") {
        this.state = "grabbed";
        this.label.setAttribute("visible", "false");
        el.emit("paper-grab", { paper: el.paper }, true);
      } else if (this.state === "open") {
        this.close();
      }
    });

    el.sceneEl.addEventListener("pinchend-any", () => {
      if (this.state !== "grabbed") return;
      const pulled = el.object3D.position.distanceTo(this.home);
      if (pulled > d.openThreshold) { this.state = "open"; el.emit("paper-open", { paper: el.paper }, true); }
      else this.close();
    });
  },

  setHover(on) {
    this.hovered = on;
    if (this.state === "idle") {
      this.vis.setAttribute("color", on ? "#ffd166" : this.data.color);
      this.vis.object3D.scale.setScalar(on ? 1.15 : 1);
      this.label.setAttribute("visible", on ? "true" : "false");
    }
    this.el.emit(on ? "paper-hover" : "paper-unhover", { paper: this.el.paper }, true);
  },

  close() {
    this.state = "returning";
    this.vis.setAttribute("color", this.data.color);
    this.vis.object3D.scale.setScalar(1);
    this.el.emit("paper-close", { paper: this.el.paper }, true);
  },

  tick() {
    const pos = this.el.object3D.position, d = this.data;
    // 더 가까운 노드가 앞에 끼어들면 호버 해제, 가장 가까운 것이 되면 호버 시작
    const nearest = this.isNearest();
    if (this.hovered && !nearest) this.setHover(false);
    else if (!this.hovered && nearest) this.setHover(true);
    if (this.state === "grabbed") {
      // 커서 방향으로 pullDist 지점: 손에 붙어 오는 느낌
      this.camEl.object3D.getWorldPosition(this.camPos);
      this.cursorEl.object3D.getWorldPosition(this.cur);
      this.goal.copy(this.cur).sub(this.camPos).normalize().multiplyScalar(d.pullDist).add(this.camPos);
      pos.lerp(this.goal, d.lerp);
    } else if (this.state === "open") {
      // 화면 왼쪽 1/3 지점에 고정해 오른쪽 패널 자리 확보
      this.camEl.object3D.getWorldPosition(this.camPos);
      this.camEl.object3D.getWorldDirection(this.camDir);
      const cam = this.camEl.getObject3D("camera");
      const hw = d.pullDist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect;
      this.goal.copy(this.camPos).addScaledVector(this.camDir, -d.pullDist);
      this.goal.x -= hw * 0.45; this.goal.y -= 0.1;
      pos.lerp(this.goal, d.lerp);
    } else if (this.state === "returning") {
      pos.lerp(this.home, d.lerp);
      if (pos.distanceTo(this.home) < 0.01) { pos.copy(this.home); this.state = "idle"; if (this.hovered) this.setHover(true); }
    }
  },
});
