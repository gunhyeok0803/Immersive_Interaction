/* hand-cursor: MediaPipe 손 랜드마크(또는 마우스)를 3D 커서 + pinch 이벤트로 바꾸는 A-Frame 컴포넌트.
 * 원리 설명: docs/09-how-it-works.md §1
 *
 * 필요한 엔티티:
 *   #camera  : a-camera. 커서(#cursor)는 이 카메라의 자식이어야 함
 *   #cursor  : 카메라 앞 평면에 놓이는 커서 엔티티
 *   #ray     : raycaster="objects: .target; useWorldCoordinates: true"
 *
 * 내보내는 이벤트 (대상 엔티티에): pinchstart, pinchend
 * 내보내는 이벤트 (scene에):     hand-cursor-mode {mode: 'hand'|'mouse'}
 */
AFRAME.registerComponent("hand-cursor", {
  schema: {
    smooth: { default: 5 },        // ④ 이동 평균 프레임 수. 클수록 부드럽고 느림
    pinchStart: { default: 0.25 }, // ⑦ 핀치 시작 비율 (엄지-검지 거리 / 손 폭)
    pinchEnd: { default: 0.40 },   // ⑦ 핀치 종료 비율. 시작보다 크게 (히스테리시스)
    dist: { default: 1.5 },        // ⑤ 커서를 놓을 카메라 앞 거리
    lostMs: { default: 1000 },     // 손이 이 시간 이상 안 보이면 마우스 폴백
    hud: { default: true },
  },

  init() {
    this.buf = [];
    this.target = null;      // 현재 레이가 맞고 있는 엔티티
    this.pinching = false;
    this.lastHandTs = 0;
    this.mode = "mouse";
    this.camEl = document.getElementById("camera");
    this.cursorEl = document.getElementById("cursor");
    this.rayEl = document.getElementById("ray");
    this.origin = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.cursorWorld = new THREE.Vector3();

    this.rayEl.addEventListener("raycaster-intersection", (e) => { this.target = e.detail.els[0] ?? null; });
    this.rayEl.addEventListener("raycaster-intersection-cleared", () => { this.target = null; });

    // 마우스 폴백: 같은 setNorm / setPinch 경로를 탄다
    window.addEventListener("mousemove", (e) => {
      if (this.mode === "mouse") this.setNorm(e.clientX / innerWidth, e.clientY / innerHeight);
    });
    window.addEventListener("mousedown", (e) => {
      const onUi = e.target && e.target.closest && e.target.closest(".ui");
      if (this.mode === "mouse" && !onUi) this.setPinch(true, 0);
    });
    window.addEventListener("mouseup", () => { if (this.mode === "mouse") this.setPinch(false, 1); });
  },

  // ⑤ 화면 정규화 좌표 (0~1, 좌상단 원점) → 카메라 앞 평면 위 3D 위치
  setNorm(x, y) {
    this.buf.push([x, y]);
    if (this.buf.length > this.data.smooth) this.buf.shift();
    const ax = this.buf.reduce((s, p) => s + p[0], 0) / this.buf.length;
    const ay = this.buf.reduce((s, p) => s + p[1], 0) / this.buf.length;
    const cam = this.camEl.getObject3D("camera");
    const d = this.data.dist;
    const hh = d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const hw = hh * cam.aspect;
    this.cursorEl.object3D.position.set((ax * 2 - 1) * hw, (1 - ay * 2) * hh, -d);
  },

  setPinch(on, ratio) {
    if (on === this.pinching) return;
    this.pinching = on;
    if (on) {
      if (this.target) this.target.emit("pinchstart", { ratio });
      else this.el.emit("pinch-empty", { ratio });
    } else {
      this.el.emit("pinchend-any");
      if (this.target) this.target.emit("pinchend");
    }
  },

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.el.emit("hand-cursor-mode", { mode });
  },

  // ①~③ MediaPipe 결과 입력. lm: 21개 {x,y,z}. 거울을 고려해 x 반전
  feedHand(lm, ts) {
    this.lastHandTs = ts;
    this.setMode("hand");
    const tip = lm[8], thumb = lm[4], wrist = lm[0], midMcp = lm[9];
    this.setNorm(1 - tip.x, tip.y);
    const handSize = Math.hypot(wrist.x - midMcp.x, wrist.y - midMcp.y) || 1e-6;
    const ratio = Math.hypot(tip.x - thumb.x, tip.y - thumb.y) / handSize;
    this.lastRatio = ratio;
    if (!this.pinching && ratio < this.data.pinchStart) this.setPinch(true, ratio);
    else if (this.pinching && ratio > this.data.pinchEnd) this.setPinch(false, ratio);
  },

  tick(t) {
    if (this.mode === "hand" && t - this.lastHandTs > this.data.lostMs) {
      this.setPinch(false, 1);
      this.setMode("mouse");
    }
    // ⑥ 눈(카메라)에서 커서를 지나는 방향으로 레이
    this.camEl.object3D.getWorldPosition(this.origin);
    this.cursorEl.object3D.getWorldPosition(this.cursorWorld);
    this.dir.copy(this.cursorWorld).sub(this.origin).normalize();
    this.rayEl.setAttribute("raycaster", { origin: this.origin, direction: this.dir });
  },
});

/* MediaPipe 시작 도우미. 성공 시 매 프레임 hand-cursor.feedHand 호출.
 * 반환: {stop()} . 실패 시 예외 (호출 쪽에서 마우스 폴백 안내) */
async function startHandTracking({ videoEl, sceneEl, version = "1.0.1", onFps } = {}) {
  const { HandLandmarker, FilesetResolver } = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/vision_bundle.mjs`);
  const vision = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm`);
  const landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1, // 한 손만. 다른 손은 필기용
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
