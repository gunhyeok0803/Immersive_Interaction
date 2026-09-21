/* hand-cursor: MediaPipe 손 랜드마크(또는 마우스)를 3D 커서 + pinch 이벤트로 바꾸는 A-Frame 컴포넌트.
 * 원리 설명: docs/09-how-it-works.md §1, §5
 *
 * 2026-09-21 v2 (핸드트래킹 UX 가이드라인 반영):
 *  - 포인터 = 엄지끝·검지끝의 중간점 (핀치해도 거의 안 움직이는 "안정된 핀치 위치", Ultraleap 권고)
 *  - One Euro 필터 (가만히 있으면 떨림 제거, 빨리 움직이면 지연 없음)
 *  - 대상 유지(sticky): 레이가 대상을 벗어나도 graceMs 동안은 같은 대상으로 핀치 인정
 *  - 커서 링이 핀치 강도에 따라 줄어들고, 호버·핀치 시 색이 바뀜 (Meta: 커서+호버 상태 항상 표시)
 *
 * 필요한 엔티티: #camera(커서 #cursor는 자식), #cursor 안에 #cursor-ring, #ray(raycaster useWorldCoordinates)
 * 이벤트: 대상에 pinchstart/pinchend, scene에 pinch-empty / pinchend-any / hand-cursor-mode / hand-cursor-debug
 */

// One Euro 필터 (Casiez et al. 2012). 값 하나용.
class OneEuro {
  constructor({ minCutoff = 1.0, beta = 0.3, dCutoff = 1.0 } = {}) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.x = null; this.dx = 0; this.t = null;
  }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(x, t) {
    if (this.x === null) { this.x = x; this.t = t; return x; }
    const dt = Math.max((t - this.t) / 1000, 1e-3);
    this.t = t;
    const dxRaw = (x - this.x) / dt;
    const aD = OneEuro.alpha(this.dCutoff, dt);
    this.dx = aD * dxRaw + (1 - aD) * this.dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = OneEuro.alpha(cutoff, dt);
    this.x = a * x + (1 - a) * this.x;
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; this.t = null; }
}

AFRAME.registerComponent("hand-cursor", {
  schema: {
    pointer: { default: "pinch" },  // 'pinch' = 엄지·검지 중간점 | 'tip' = 검지 끝
    minCutoff: { default: 1.0 },    // One Euro: 낮을수록 정지 시 더 부드럽고(느림) 높을수록 반응 빠름
    beta: { default: 0.3 },         // One Euro: 클수록 빠른 움직임에서 지연이 줄어듦
    pinchStart: { default: 0.28 },  // 핀치 시작 비율 (엄지-검지 거리 / 손 폭)
    pinchEnd: { default: 0.45 },    // 핀치 종료 비율. 시작보다 크게 (히스테리시스)
    ratioSmooth: { default: 0.5 },  // 핀치 비율 EMA 계수 (1 = 필터 없음)
    graceMs: { default: 300 },      // 대상 유지 시간
    dist: { default: 1.5 },         // 커서를 놓을 카메라 앞 거리
    lostMs: { default: 1000 },      // 손이 이 시간 이상 안 보이면 마우스 폴백
  },

  init() {
    this.fx = new OneEuro({ minCutoff: this.data.minCutoff, beta: this.data.beta });
    this.fy = new OneEuro({ minCutoff: this.data.minCutoff, beta: this.data.beta });
    this.target = null;        // 현재(또는 grace 안의) 대상
    this.targetLostAt = 0;
    this.rayHit = null;        // 실제로 레이가 맞는 대상
    this.pinching = false;
    this.ratio = 1;
    this.lastHandTs = 0;
    this.mode = "mouse";
    this.camEl = document.getElementById("camera");
    this.cursorEl = document.getElementById("cursor");
    this.ringEl = document.getElementById("cursor-ring");
    this.rayEl = document.getElementById("ray");
    this.origin = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.cursorWorld = new THREE.Vector3();

    this.rayEl.addEventListener("raycaster-intersection", (e) => {
      this.rayHit = e.detail.els[0] ?? null;
      if (this.rayHit) { this.target = this.rayHit; this.targetLostAt = 0; }
    });
    this.rayEl.addEventListener("raycaster-intersection-cleared", () => {
      this.rayHit = null;
      this.targetLostAt = performance.now();
    });

    // 마우스 폴백: 같은 setNorm / setPinch 경로
    window.addEventListener("mousemove", (e) => {
      if (this.mode === "mouse") this.setNorm(e.clientX / innerWidth, e.clientY / innerHeight, performance.now());
    });
    window.addEventListener("mousedown", (e) => {
      const onUi = e.target && e.target.closest && e.target.closest(".ui");
      if (this.mode === "mouse" && !onUi) this.setPinch(true);
    });
    window.addEventListener("mouseup", () => { if (this.mode === "mouse") this.setPinch(false); });
  },

  // 화면 정규화 좌표 (0~1, 좌상단 원점) → One Euro → 카메라 앞 평면 위 3D 위치
  setNorm(x, y, t) {
    const ax = this.fx.filter(x, t), ay = this.fy.filter(y, t);
    const cam = this.camEl.getObject3D("camera");
    const d = this.data.dist;
    const hh = d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const hw = hh * cam.aspect;
    this.cursorEl.object3D.position.set((ax * 2 - 1) * hw, (1 - ay * 2) * hh, -d);
  },

  setPinch(on) {
    if (on === this.pinching) return;
    this.pinching = on;
    if (on) {
      if (this.target) { this.grabbed = this.target; this.target.emit("pinchstart", { ratio: this.ratio }); }
      else { this.grabbed = null; this.el.emit("pinch-empty", { ratio: this.ratio }); }
    } else {
      this.el.emit("pinchend-any");
      if (this.grabbed) this.grabbed.emit("pinchend");
      this.grabbed = null;
    }
    this.el.emit("hand-cursor-debug", this.debugState());
  },

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === "hand") { this.fx.reset(); this.fy.reset(); }
    this.el.emit("hand-cursor-mode", { mode });
  },

  // MediaPipe 결과 입력. lm: 21개 {x,y,z}. 거울을 고려해 x 반전
  feedHand(lm, ts) {
    this.lastHandTs = ts;
    this.setMode("hand");
    const tip = lm[8], thumb = lm[4], wrist = lm[0], midMcp = lm[9];
    const px = this.data.pointer === "pinch" ? (tip.x + thumb.x) / 2 : tip.x;
    const py = this.data.pointer === "pinch" ? (tip.y + thumb.y) / 2 : tip.y;
    this.setNorm(1 - px, py, ts);
    const handSize = Math.hypot(wrist.x - midMcp.x, wrist.y - midMcp.y) || 1e-6;
    const raw = Math.hypot(tip.x - thumb.x, tip.y - thumb.y) / handSize;
    this.ratio = this.data.ratioSmooth * raw + (1 - this.data.ratioSmooth) * this.ratio;
    if (!this.pinching && this.ratio < this.data.pinchStart) this.setPinch(true);
    else if (this.pinching && this.ratio > this.data.pinchEnd) this.setPinch(false);
  },

  debugState() {
    return {
      mode: this.mode, ratio: this.ratio, pinching: this.pinching,
      target: this.target?.paperEl?.paper?.title ?? this.target?.id ?? "",
      rayHit: !!this.rayHit,
    };
  },

  tick(t) {
    if (this.mode === "hand" && t - this.lastHandTs > this.data.lostMs) {
      this.setPinch(false);
      this.setMode("mouse");
    }
    // 대상 유지: 레이가 벗어난 뒤 graceMs 지나면 해제 (핀치 중에는 유지)
    if (!this.rayHit && this.target && !this.pinching && performance.now() - this.targetLostAt > this.data.graceMs) {
      this.target = null;
    }
    // 눈(카메라)에서 커서를 지나는 방향으로 레이
    this.camEl.object3D.getWorldPosition(this.origin);
    this.cursorEl.object3D.getWorldPosition(this.cursorWorld);
    this.dir.copy(this.cursorWorld).sub(this.origin).normalize();
    this.rayEl.setAttribute("raycaster", { origin: this.origin, direction: this.dir });

    // 커서 모양: 핀치 강도에 따라 링 축소, 대상 위에서 노란색, 핀치 중 채움
    if (this.ringEl) {
      const { pinchStart, pinchEnd } = this.data;
      const strength = this.mode === "hand"
        ? THREE.MathUtils.clamp((pinchEnd - this.ratio) / (pinchEnd - pinchStart), 0, 1)
        : (this.pinching ? 1 : 0);
      const s = 1 - 0.45 * strength;
      this.ringEl.object3D.scale.set(s, s, s);
      const color = this.pinching ? "#ffd166" : this.target ? "#ffe9a8" : "#9ef";
      if (this._ringColor !== color) { this._ringColor = color; this.ringEl.setAttribute("color", color); }
    }
    if ((t | 0) % 6 === 0) this.el.emit("hand-cursor-debug", this.debugState());
  },
});

/* MediaPipe 시작 도우미. 성공 시 매 프레임 hand-cursor.feedHand 호출. 실패 시 예외 */
async function startHandTracking({ videoEl, sceneEl, version = "1.0.1", onFps } = {}) {
  const { HandLandmarker, FilesetResolver } = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/vision_bundle.mjs`);
  const vision = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm`);
  const landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.6,
  });
  videoEl.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
  await new Promise((r) => (videoEl.onloadeddata = r));

  let last = -1, frames = 0, fpsT = performance.now(), running = true;
  const loop = () => {
    if (!running) return;
    const now = performance.now();
    if (videoEl.currentTime !== last) {
      last = videoEl.currentTime;
      const res = landmarker.detectForVideo(videoEl, now);
      const hc = sceneEl.components["hand-cursor"];
      if (hc && res.landmarks && res.landmarks.length) hc.feedHand(res.landmarks[0], now);
      frames++;
      if (now - fpsT > 1000) { onFps?.(frames); frames = 0; fpsT = now; }
    }
    requestAnimationFrame(loop);
  };
  loop();
  return { stop() { running = false; videoEl.srcObject?.getTracks().forEach((t) => t.stop()); } };
}
window.startHandTracking = startHandTracking;
