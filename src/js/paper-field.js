/* paper-field: papers.json을 읽어 논문 노드를 3D에 배치.
 * paper-node : hover 강조, pinch로 집기, 당겨서 열기, 다시 pinch로 되돌리기.
 * 원리 설명: docs/09-how-it-works.md §3
 */

// 문자열 → 0~360 색상 각도 (같은 저널 = 같은 색)
function hueOf(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

AFRAME.registerComponent("paper-field", {
  schema: {
    src: { default: "data/papers.json" },
    width: { default: 9 },     // 연도축 전체 가로 길이 (장면 단위)
    depth: { default: -4.5 },  // 노드가 놓이는 z (카메라 앞 거리)
    centerY: { default: 1.6 }, // 카메라 눈높이
    gapY: { default: 0.5 },    // 같은 해 논문 세로 간격
    max: { default: 60 },      // 노드 수 상한 (프레임 유지)
  },

  async init() {
    const res = await fetch(this.data.src);
    const json = await res.json();
    const papers = json.papers.slice(0, this.data.max);
    this.el.emit("papers-loaded", { author: json.author, count: papers.length, source: json.source });

    // x = 연도. 같은 해는 위아래로 쌓기
    const years = papers.map((p) => p.year).filter(Boolean);
    const minY = Math.min(...years), maxY = Math.max(...years);
    const byYear = {};
    for (const p of papers) (byYear[p.year] ??= []).push(p);

    // 화면 크기에 맞춰 폭·간격 결정: 카메라 앞 depth 거리에서 보이는 영역의 85%만 씀
    if (!this.el.sceneEl.hasLoaded) await new Promise((r) => this.el.sceneEl.addEventListener("loaded", r, { once: true }));
    const cam = document.getElementById("camera").getObject3D("camera");
    const hh = Math.abs(this.data.depth) * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const width = 2 * hh * cam.aspect * 0.85;
    const tallest = Math.max(...Object.values(byYear).map((l) => l.length));
    const gapY = Math.min(this.data.gapY, (2 * hh * 0.75) / Math.max(1, tallest - 1));

    for (const [year, list] of Object.entries(byYear)) {
      const t = maxY === minY ? 0.5 : (Number(year) - minY) / (maxY - minY);
      const x = (t - 0.5) * width;
      list.sort((a, b) => b.cited - a.cited);
      list.forEach((p, i) => {
        const y = this.data.centerY + (i - (list.length - 1) / 2) * gapY;
        const z = this.data.depth + (i % 2) * 0.15; // 살짝 앞뒤로 어긋나게
        const r = 0.12 + 0.06 * Math.log10((p.cited ?? 0) + 1); // 로그 크기
        const node = document.createElement("a-sphere");
        node.classList.add("target");
        node.setAttribute("radius", r.toFixed(3));
        node.setAttribute("position", `${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`);
        node.setAttribute("color", `hsl(${hueOf(p.venue || "?")}, 55%, 55%)`);
        node.setAttribute("paper-node", "");
        node.paper = p;
        this.el.appendChild(node);
      });
    }

    // 연도 눈금
    for (let y = minY; y <= maxY; y += Math.max(1, Math.round((maxY - minY) / 6))) {
      const t = (y - minY) / (maxY - minY);
      const label = document.createElement("a-text");
      label.setAttribute("value", String(y));
      label.setAttribute("align", "center");
      label.setAttribute("width", "2.5");
      label.setAttribute("color", "#8892b0");
      label.setAttribute("position", `${((t - 0.5) * width).toFixed(2)} ${(this.data.centerY - hh * 0.85).toFixed(2)} ${this.data.depth}`);
      this.el.appendChild(label);
    }
  },
});

AFRAME.registerComponent("paper-node", {
  schema: {
    pullDist: { default: 1.2 },   // 열렸을 때 카메라 앞 거리
    openThreshold: { default: 0.8 }, // 이만큼 당겨졌으면 '열림'
    lerp: { default: 0.15 },       // 보간 비율
  },

  init() {
    const el = this.el;
    this.state = "idle"; // idle | grabbed | open | returning
    this.home = el.object3D.position.clone();
    this.homeScale = el.object3D.scale.clone();
    this.goal = new THREE.Vector3();
    this.camEl = document.getElementById("camera");
    this.camPos = new THREE.Vector3();
    this.camDir = new THREE.Vector3();
    this.baseColor = el.getAttribute("color");

    // 제목 라벨 (hover 시만 표시)
    const label = document.createElement("a-text");
    label.setAttribute("value", (el.paper?.title ?? "").slice(0, 70) + (el.paper?.title?.length > 70 ? "…" : ""));
    label.setAttribute("align", "center");
    label.setAttribute("width", "2.8");
    label.setAttribute("color", "#e6f1ff");
    label.setAttribute("position", `0 ${Number(el.getAttribute("radius")) + 0.18} 0`);
    label.setAttribute("visible", "false");
    el.appendChild(label);
    this.label = label;

    el.addEventListener("raycaster-intersected", () => {
      if (this.state === "idle") { el.setAttribute("color", "#ffd166"); label.setAttribute("visible", "true"); }
      el.emit("paper-hover", { paper: el.paper }, true);
    });
    el.addEventListener("raycaster-intersected-cleared", () => {
      if (this.state === "idle") { el.setAttribute("color", this.baseColor); label.setAttribute("visible", "false"); }
      el.emit("paper-unhover", {}, true);
    });

    el.addEventListener("pinchstart", () => {
      if (this.state === "idle") {
        this.state = "grabbed";
        label.setAttribute("visible", "false");
        el.emit("paper-grab", { paper: el.paper }, true);
      } else if (this.state === "open") {
        this.close();
      }
    });

    // 어떤 노드 위에서든 핀치가 풀리면 grabbed 상태를 정리
    el.sceneEl.addEventListener("pinchend-any", () => {
      if (this.state !== "grabbed") return;
      const pulled = el.object3D.position.distanceTo(this.home);
      if (pulled > this.data.openThreshold) {
        this.state = "open";
        el.emit("paper-open", { paper: el.paper }, true);
      } else {
        this.close();
      }
    });
  },

  close() {
    this.state = "returning";
    this.el.setAttribute("color", this.baseColor);
    this.el.emit("paper-close", { paper: this.el.paper }, true);
  },

  tick() {
    const pos = this.el.object3D.position;
    if (this.state === "grabbed" || this.state === "open") {
      // 카메라 앞 pullDist 지점을 목표로 보간
      this.camEl.object3D.getWorldPosition(this.camPos);
      this.camEl.object3D.getWorldDirection(this.camDir); // 카메라가 보는 방향(-z)의 반대가 나오므로 부호 주의
      this.goal.copy(this.camPos).addScaledVector(this.camDir, -this.data.pullDist);
      this.goal.y -= 0.15;
      if (this.state === "open") {
        // 열리면 화면 왼쪽 1/3 지점으로 비켜 패널 자리 확보. 화면 비율에 따라 계산해 좁은 화면에서도 보이게
        const cam = this.camEl.getObject3D("camera");
        const hw = this.data.pullDist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect;
        this.goal.x -= hw * 0.45;
      }
      pos.lerp(this.goal, this.data.lerp);
    } else if (this.state === "returning") {
      pos.lerp(this.home, this.data.lerp);
      if (pos.distanceTo(this.home) < 0.01) { pos.copy(this.home); this.state = "idle"; }
    }
  },
});
