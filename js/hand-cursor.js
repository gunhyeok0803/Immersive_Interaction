/* hand-cursor: MediaPipe 손 랜드마크(또는 마우스)를 3D 커서 + 핀치 클릭으로 바꾸는 A-Frame 컴포넌트.
 * 원리 설명: docs/13-how-and-why.md §2
 *
 * 2026-09-21 v2 (핸드트래킹 UX 가이드라인 반영):
 *  - 포인터 = 엄지끝·검지끝의 중간점 (핀치해도 거의 안 움직이는 "안정된 핀치 위치", Ultraleap 권고)
 *  - One Euro 필터 (가만히 있으면 떨림 제거, 빨리 움직이면 지연 없음)
 *  - 대상 유지(sticky): 레이가 대상을 벗어나도 graceMs 동안은 같은 대상으로 핀치 인정
 *  - 커서 링이 핀치 강도에 따라 줄어들고, 호버·핀치 시 색이 바뀜 (Meta: 커서+호버 상태 항상 표시)
 * 2026-09-24 v3: 커서 바깥 원호(#cursor-arc)가 핀치 강도를 연속으로 보여 줌 (가득 차면 집힘)
 * 2026-09-29 v5: 사용자 결정 "핀치 클릭만 쓰자" → 한 손, 가리키기 + 핀치 클릭만. 양손 늘리기·끌기·주먹은 뺐음.
 *   되돌리기는 화면의 버튼 또는 키보드 Esc.
 *
 * 2026-09-29 v6: 사용자 결정 "핀치 하나 + 잡은 채 움직이기". 핀치 판정은 그대로, 잡은 동안의 손 위치(norm)와
 *   손 크기(palm = 카메라 거리 대용)를 hud가 읽어 연속 조작(당겨 층 펼치기·돌리기)에 쓴다. pullProgress를 쓰면 원호가 그 값을 보여 줌.
 *
 * 필요한 엔티티: #camera(자식 #cursor), #cursor 안에 #cursor-ring·#cursor-arc, #ray(raycaster useWorldCoordinates)
 * 이벤트: 대상에 pinchstart, scene에 pinch-empty / pinchend-any / close-all({via:"key"}) / hand-cursor-mode / hand-cursor-debug
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

// HUD 색 (index.html의 CSS 토큰과 같음)
const CUR = { idle: "#bfeefa", hover: "#3fd0f0", pinch: "#e8fdff", arc: "#3fd0f0" };

// 엄지·검지 중간점 (x는 거울 보정). lm: MediaPipe 21점
const pinchPoint = (lm) => [1 - (lm[8].x + lm[4].x) / 2, (lm[8].y + lm[4].y) / 2];
// 검지·중지 뿌리 관절(5·9)의 중간 (2026-09-30 사용자 보고 "손을 펴니까 커서가 움직인다"): 손가락을 펴거나 모아도 거의 안 움직임
const knucklePoint = (lm) => [1 - (lm[5].x + lm[9].x) / 2, (lm[5].y + lm[9].y) / 2];
const pinchRatio = (lm) => {
  const hand = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) || 1e-6; // 손목–중지 뿌리 = 손 크기
  return Math.hypot(lm[8].x - lm[4].x, lm[8].y - lm[4].y) / hand;
};
// 검지가 말려 있음 = 끝이 둘째 관절보다 손목에 가까움 (주먹 쥐는 중에 핀치로 잘못 잡히지 않게)
const indexCurled = (lm) => {
  const d = (a) => Math.hypot(lm[a].x - lm[0].x, lm[a].y - lm[0].y);
  return d(8) < d(6);
};

AFRAME.registerComponent("hand-cursor", {
  schema: {
    pointer: { default: "knuckle" }, // 'knuckle' = 검지·중지 뿌리 관절(손가락을 펴거나 모아도 안정) | 'pinch' = 엄지·검지 끝 중간점 | 'tip' = 검지 끝
    minCutoff: { default: 4.0 },    // One Euro: 낮을수록 정지 시 더 부드럽고(느림). 시정수 = 1/(2π·minCutoff) → 4Hz면 40ms
    beta: { default: 0.6 },         // One Euro: 클수록 빠른 움직임에서 지연이 줄어듦
    pinchStart: { default: 0.28 },  // 핀치 시작 비율 (엄지-검지 거리 / 손 크기)
    pinchEnd: { default: 0.45 },    // 핀치 종료 비율. 시작보다 크게 (히스테리시스)
    arcFrom: { default: 0.7 },      // 원호가 차오르기 시작하는 비율. 이 값에서 0%, pinchStart에서 100%(= 클릭)
    ratioSmooth: { default: 0.5 },  // 핀치 비율 EMA 계수 (1 = 필터 없음)
    graceMs: { default: 300 },      // 대상 유지 시간
    dist: { default: 1.5 },         // 커서를 놓을 카메라 앞 거리
    lostMs: { default: 1000 },      // 손이 이 시간 이상 안 보이면 마우스 폴백
    lockAt: { default: 0.36 },      // 손가락이 이만큼 모이면 커서·대상 고정 (핀치하려는 순간의 흔들림이 선택을 바꾸지 않게)
    lockMs: { default: 600 },
    fistMs: { default: 600 },       // 주먹(Closed_Fist)을 이만큼 유지하면 한 단계 뒤로 (2026-09-30 사용자 요청 "주먹을 쥐면 닫기")
    fistScore: { default: 0.6 },    // 주먹으로 볼 모델 점수       // 고정한 뒤 이 시간 안에 핀치가 안 되면 자동 해제 (편하게 둔 손에서 고정이 풀리지 않던 위험)
    unlockAt: { default: 0.55 },    // 핀치하지 않고 이만큼 다시 벌리면 고정 해제
    extFrom: { default: 1.55 }, extTo: { default: 1.9 },       // 손가락 펴짐: 이 사이를 0~1로 (자연스럽게 놓은 손 ≈ 0)
    spreadFrom: { default: 0.75 }, spreadTo: { default: 1.25 }, // 손가락 벌어짐: 이 사이를 0~1로
  },

  init() {
    const d = this.data;
    this.fx = new OneEuro({ minCutoff: d.minCutoff, beta: d.beta });
    this.fy = new OneEuro({ minCutoff: d.minCutoff, beta: d.beta });
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
    this.arcEl = document.getElementById("cursor-arc");
    this.domEl = document.getElementById("cursor-dom"); // 패널 위에서 대신 보이는 HTML 커서
    this.overUi = false;

    // 키보드: Esc = 한 단계 뒤로
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") this.el.emit("close-all", { via: "key" }); });
    this.rayEl = document.getElementById("ray");
    this.origin = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.cursorWorld = new THREE.Vector3();

    // 주의: raycaster 이벤트는 "새로 들어온" 대상이 있을 때만 발생한다. 겹친 대상에서 앞 대상이 빠지고
    // 이미 맞고 있던 뒤 대상이 첫 번째가 되는 경우엔 이벤트가 없다. 그래서 매 프레임 intersectedEls를 직접 읽는다.
    this.readRay = () => {
      const rc = this.rayEl.components.raycaster;
      const els = rc?.intersectedEls ?? [];
      // 대상 목록(objects)이 바뀐 직후 한 프레임은 이전 교차 결과가 남아 있으므로 현재 선택자에 맞는 것만 받는다
      let first = els.find((e) => e.matches(rc.data.objects)) ?? null;
      // z-버퍼처럼 (2026-09-30 사용자 요청 "트래킹이 겹치지 않게"): 레이가 가장 먼저 닿은 것이 가림막(.blocker, 예: 층 구조의 프레임)이면
      // 그 뒤에 가려진 대상(패널 등)은 잡지 않는다. intersectedEls는 가까운 순서
      if (first?.classList.contains("blocker")) first = null;
      if (first) { this.rayHit = first; this.target = first; this.targetLostAt = 0; }
      else if (this.rayHit) { this.rayHit = null; this.targetLostAt = performance.now(); }
    };

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
    this.lastRaw = [x, y];
    // 마우스는 이미 정확하므로 필터를 거치지 않음 (필터는 손 떨림용)
    const ax = this.mode === "mouse" ? x : this.fx.filter(x, t);
    const ay = this.mode === "mouse" ? y : this.fy.filter(y, t);
    this.filtered = [ax, ay];
    // 핀치 직전 고정 (2026-09-30 사용자 보고 "핀치하는 동안 커서가 다른 곳으로 이동해 정확한 핀치가 안 된다"):
    //  locked = 손가락이 모이는 중 → 커서를 고정 지점에 둠 / drag = 핀치 중 → 고정 지점 + 핀치 순간 이후 손이 움직인 만큼
    let nx = ax, ny = ay;
    // hold: 논문을 잡고 펼치기·돌리기 하는 동안 커서를 잡은 자리에 멈춤 (pullable이 켜고 끔). 손을 펴는 동안 커서가 떠돌던 문제
    if (this.mode === "hand" && this.hold) { nx = this.hold[0]; ny = this.hold[1]; }
    else if (this.mode === "hand" && this.lock) {
      nx = this.lock.pt[0] + (this.lock.from ? ax - this.lock.from[0] : 0);
      ny = this.lock.pt[1] + (this.lock.from ? ay - this.lock.from[1] : 0);
    }
    this.norm = [nx, ny];
    const cam = this.camEl.getObject3D("camera");
    const dd = this.data.dist;
    const hh = dd * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const hw = hh * cam.aspect;
    this.cursorEl.object3D.position.set((nx * 2 - 1) * hw, (1 - ny * 2) * hh, -dd);
  },

  setPinch(on) {
    if (on === this.pinching) return;
    this.pinching = on;
    // 핀치 시작: 고정 지점을 기준으로 이후 손 움직임만 반영(잡고 끌기) / 핀치 끝: 고정 해제
    if (on && this.lock && this.filtered) this.lock.from = this.filtered.slice();
    if (!on) this.lock = null;
    if (on) {
      // 커서가 패널 등 HTML 위에 있으면 뒤에 가려진 3D 대상이 아니라 HTML을 누른 것으로 본다
      const live = this.target?.classList.contains("target") && this.target.matches(this.rayEl.components.raycaster?.data.objects || ".target");
      if (live && !this.overUi) this.target.emit("pinchstart", { ratio: this.ratio });
      else this.el.emit("pinch-empty", { ratio: this.ratio });
    } else this.el.emit("pinchend-any", {});
    this.el.emit("hand-cursor-debug", this.debugState());
  },

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === "hand") { this.fx.reset(); this.fy.reset(); } else this.lastLm = null;
    this.lock = null;
    this.fistT = null; this.fistDone = false; // 주먹을 쥔 채 손을 놓치면 타이머가 남아 다음 주먹이 바로 닫히던 문제 (코드 검토 9/30)
    this.el.emit("hand-cursor-mode", { mode });
  },

  // MediaPipe 결과 입력 (손 목록 중 첫 번째만 씀)
  // gestures: Gesture Recognizer의 손 모양 분류 (손마다 [{categoryName, score}])
  feedHands(list, ts, gestures) { if (list.length) this.feedHand(list[0], ts, gestures?.[0]); },
  feedHand(lm, ts, cats) {
    this.lastLm = lm; // 손 뼈대 표시용 (index.html)
    this.lastHandTs = ts;
    this.setMode("hand");
    const p = this.data.pointer;
    const [px, py] = p === "knuckle" ? knucklePoint(lm) : p === "pinch" ? pinchPoint(lm) : [1 - lm[8].x, lm[8].y];
    this.setNorm(px, py, ts);
    this.ratio = this.data.ratioSmooth * pinchRatio(lm) + (1 - this.data.ratioSmooth) * this.ratio;
    // 손 크기(손목–중지 뿌리) = 카메라와의 거리 대용. 손을 몸쪽으로 당기면(카메라에서 멀어지면) 작아진다. 떨림이 커서 EMA
    const palm = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);
    this.palm = this.palm ? 0.3 * palm + 0.7 * this.palm : palm;
    // 손을 편 정도 0~1 (2026-09-30 사용자 제안 "핀치로 잡고 손을 다 펴면 펼치기"). 몸쪽 당기기(손 크기)보다 안정적인 2D 값:
    //  펴짐 = 네 손가락 끝이 손목에서 떨어진 거리 평균 / 손 크기, 벌어짐 = 검지 끝–새끼 끝 거리 / 손 크기. 둘 다 차야 '활짝'
    const P = palm || 1e-6, d0 = (i) => Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y);
    const ext = (d0(8) + d0(12) + d0(16) + d0(20)) / 4 / P;
    const spread = Math.hypot(lm[8].x - lm[20].x, lm[8].y - lm[20].y) / P;
    const c01 = (v) => Math.min(1, Math.max(0, v));
    let open = (c01((ext - this.data.extFrom) / (this.data.extTo - this.data.extFrom)) + c01((spread - this.data.spreadFrom) / (this.data.spreadTo - this.data.spreadFrom))) / 2;
    // 공식 모델이 있으면 그 점수를 씀: 손 모양이 Open_Palm이면 그 확률, 아니면 0 (위의 기하 계산은 모델 없을 때의 대체값)
    if (cats) {
      const top = cats[0], palm = cats.find((c) => c.categoryName === "Open_Palm");
      this.gesture = top ? { name: top.categoryName, score: top.score } : null;
      open = palm ? palm.score : 0;
      // 주먹 유지 → 한 단계 뒤로. 한 번 닫으면 손을 풀 때까지 다시 닫지 않음
      const fist = top?.categoryName === "Closed_Fist" && top.score >= this.data.fistScore;
      if (fist && !this.pinching) {
        this.fistT ??= ts;
        if (!this.fistDone && ts - this.fistT >= this.data.fistMs) { this.fistDone = true; this.el.emit("close-all", { via: "fist" }); }
      } else { this.fistT = null; this.fistDone = false; }
    }
    this.openness = this.openness == null ? open : 0.4 * open + 0.6 * this.openness;
    this.handShape = { ext, spread };
    // 손가락이 모이기 시작하면 지금 커서 자리에 고정, 핀치 없이 다시 벌리면 해제
    if (this.ratio > this.data.unlockAt) this.lockBlocked = false; // 손을 벌리면 다시 고정할 수 있음
    if (!this.pinching && !this.lock && !this.lockBlocked && this.ratio < this.data.lockAt && this.norm) this.lock = { pt: this.norm.slice(), from: null, t: ts };
    else if (!this.pinching && this.lock && this.ratio > this.data.unlockAt) this.lock = null;
    else if (!this.pinching && this.lock && ts - this.lock.t > this.data.lockMs) { this.lock = null; this.lockBlocked = true; } // 시간 초과: 벌릴 때까지 재고정 안 함
    if (!this.pinching && !indexCurled(lm) && this.ratio < this.data.pinchStart) this.setPinch(true);
    else if (this.pinching && this.ratio > this.data.pinchEnd) this.setPinch(false);
  },

  // 3D 커서는 캔버스에 그려지므로 HTML 패널(.ui) 아래로 가려진다. 손 모드에서 커서가 .ui 위에 있으면
  // 같은 모양의 HTML 커서를 맨 위에 그리고 3D 커서는 숨긴다. (마우스 모드는 OS 포인터가 보이므로 불필요)
  updateDomCursor() {
    if (!this.domEl) return;
    let over = false;
    if (this.mode === "hand" && this.norm) {
      const cx = this.norm[0] * innerWidth, cy = this.norm[1] * innerHeight;
      over = !!document.elementFromPoint(cx, cy)?.closest(".ui"); // #cursor-dom은 pointer-events: none이라 걸리지 않음
      if (over) {
        const st = this.domEl.style;
        st.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
        st.setProperty("--p", this._arcQ ?? 0);
        st.setProperty("--arc", CUR.arc);
        st.setProperty("--rc", this._ringColor ?? CUR.idle);
        st.setProperty("--s", this.ringEl?.object3D.scale.x ?? 1);
      }
    }
    if (over !== this.overUi) {
      this.overUi = over;
      this.domEl.style.display = over ? "block" : "none";
      this.cursorEl.object3D.visible = !over;
    }
  },

  debugState() {
    return { mode: this.mode, ratio: this.ratio, pinching: this.pinching, openness: this.openness, shape: this.handShape, gesture: this.gesture, target: this.target?.hudLabel ?? this.target?.id ?? "", rayHit: !!this.rayHit };
  },

  tick(t) {
    const nowMs = performance.now(); // 손 시각은 performance.now() 기준
    if (this.mode === "hand" && nowMs - this.lastHandTs > this.data.lostMs) { this.setPinch(false); this.setMode("mouse"); }
    // 마지막 표본을 다시 넣어 필터가 목표에 수렴하게 (손: 프레임 누락 보정)
    if (this.mode === "hand" && this.lastRaw && nowMs - (this.fx.t ?? 0) > 12) this.setNorm(this.lastRaw[0], this.lastRaw[1], nowMs);
    this.readRay();
    // 대상 유지: 레이가 벗어난 뒤 graceMs 지나면 해제 (핀치 중에는 유지)
    if (!this.rayHit && this.target && !this.pinching && nowMs - this.targetLostAt > this.data.graceMs) this.target = null;
    // 눈(카메라)에서 커서를 지나는 방향으로 레이
    this.camEl.object3D.getWorldPosition(this.origin);
    this.cursorEl.object3D.getWorldPosition(this.cursorWorld);
    this.dir.copy(this.cursorWorld).sub(this.origin).normalize();
    this.rayEl.setAttribute("raycaster", { origin: this.origin, direction: this.dir });

    // 커서 모양: 핀치 강도에 따라 링 축소, 대상 위에서 청록, 핀치 중 밝은 청록
    if (this.ringEl) {
      const { pinchStart, pinchEnd } = this.data;
      const strength = this.mode === "hand" ? THREE.MathUtils.clamp((pinchEnd - this.ratio) / (pinchEnd - pinchStart), 0, 1) : (this.pinching ? 1 : 0);
      const s = 1 - 0.45 * strength;
      this.ringEl.object3D.scale.set(s, s, s);
      const color = this.pinching ? CUR.pinch : this.target ? CUR.hover : CUR.idle;
      if (this._ringColor !== color) { this._ringColor = color; this.ringEl.setAttribute("color", color); }
    }
    // 원호: 엄지·검지가 가까워질수록 차오르고, 가득 차면 클릭 (판정 기준을 눈에 보이게)
    // 무언가를 잡고 당기는 중이면(hud가 pullProgress를 씀) 당긴 정도를 보여 줌
    if (this.arcEl) {
      let v = 0;
      const fistV = this.mode === "hand" && this.fistT != null && !this.fistDone ? (nowMs - this.fistT) / this.data.fistMs : null;
      if (fistV != null) v = fistV; // 주먹 유지 중: 닫기까지 남은 시간 (빨간 원호)
      else if (this.pullProgress != null) v = this.pullProgress; // 잡고 펼치는 중이면 펼친 정도
      else if (this.mode === "hand" && !this.pinching) { const { arcFrom, pinchStart } = this.data; v = (arcFrom - this.ratio) / (arcFrom - pinchStart); }
      const arcCol = fistV != null ? "#f08a8a" : CUR.arc;
      if (arcCol !== this._arcCol) { this._arcCol = arcCol; this.arcEl.setAttribute("color", arcCol); }
      const q = Math.round(THREE.MathUtils.clamp(v, 0, 1) * 60) / 60; // 60단계로 끊어 지오메트리 재생성을 줄임
      if (q !== this._arcQ) {
        this._arcQ = q;
        this.arcEl.object3D.visible = q > 0;
        if (q > 0) this.arcEl.setAttribute("theta-length", q * 360);
      }
    }
    this.updateDomCursor();
    if ((t | 0) % 6 === 0) this.el.emit("hand-cursor-debug", this.debugState());
  },
});

/* MediaPipe 시작 도우미. 성공 시 매 프레임 hand-cursor.feedHands 호출. 실패 시 예외 */
async function startHandTracking({ videoEl, sceneEl, version = "1.0.1", onFps, onError, onInfo } = {}) {
  // MediaPipe wasm 글루 코드가 경고를 찍을 때 릴리스 빌드에 없는 전역 `dbg`를 호출해 "TypeError: dbg is not a function"이 남
  // (사용자 PC, Intel Arc에서 재현). 전역에 정의해 두면 경고만 찍고 진행함.
  if (typeof globalThis.dbg !== "function") globalThis.dbg = (...a) => console.debug("[mediapipe]", ...a);
  const { GestureRecognizer, FilesetResolver } = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/vision_bundle.mjs`);
  const vision = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm`);
  // 2026-09-30: Hand Landmarker → Gesture Recognizer (사용자 결정). 관절 21점은 그대로 주고, 학습된 모델이 손 모양(Open_Palm 등)도 분류한다.
  // "편 손" 판정을 임의 기준값 대신 공식 모델 점수로 (편하게 둔 손 실측이 펴짐 1.14로 임의 기준 1.55~1.9와 맞지 않았음)
  const MODEL = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
  const makeLandmarker = (delegate) => GestureRecognizer.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: "VIDEO",
    numHands: 1, // 한 손 = 마우스
  });
  videoEl.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
  await new Promise((r) => (videoEl.onloadeddata = r));
  try { await videoEl.play(); } catch {}
  // 일부 웹캠은 loadeddata 직후에도 크기가 0 → MediaPipe가 TypeError를 냄. 크기가 잡힐 때까지 대기
  for (let i = 0; i < 100 && !(videoEl.videoWidth > 0 && videoEl.videoHeight > 0); i++) await new Promise((r) => setTimeout(r, 30));
  if (!(videoEl.videoWidth > 0)) throw new Error("카메라 영상 크기를 읽지 못함 (videoWidth=0)");

  // 추론 장치 고르기 (2026-09-30 측정: 이 PC(Intel Arc)에서는 GPU 126ms > CPU 84ms로 GPU가 오히려 느렸음).
  // 실제 카메라 영상으로 GPU·CPU를 각각 재서 빠른 쪽을 쓴다. GPU 초기화가 실패하는 PC도 있으므로 실패하면 나머지만.
  let tsBench = performance.now();
  const bench = (lm) => {
    for (let i = 0; i < 3; i++) lm.recognizeForVideo(videoEl, (tsBench += 33)); // 준비 (첫 프레임은 느림)
    const ts = [];
    for (let i = 0; i < 8; i++) { const a = performance.now(); lm.recognizeForVideo(videoEl, (tsBench += 33)); ts.push(performance.now() - a); }
    return ts.sort((x, y) => x - y)[4]; // 중앙값
  };
  const cands = [];
  for (const delegate of ["GPU", "CPU"]) {
    try { const lm = await makeLandmarker(delegate); cands.push({ delegate, lm, ms: bench(lm) }); }
    catch (e) { console.warn(`${delegate} delegate failed`, e); onError?.(new Error(`${delegate} 추론 장치 실패 (${e.name}: ${e.message})`)); }
  }
  if (!cands.length) throw new Error("손 추적 모델을 만들지 못함 (GPU·CPU 모두 실패)");
  cands.sort((x, y) => x.ms - y.ms);
  const landmarker = cands[0].lm;
  for (const c of cands.slice(1)) c.lm.close();
  onInfo?.(`추론 장치: ${cands.map((c) => `${c.delegate} ${c.ms.toFixed(0)}ms`).join(" · ")} → ${cands[0].delegate} 사용`);

  // 성능 측정: 1초마다 추적 FPS, 추론 시간(평균·최대), 손이 안 잡힌 프레임 비율을 알림 (렉의 원인을 가르기 위해)
  let last = -1, frames = 0, fpsT = performance.now(), running = true, errCount = 0, detSum = 0, detMax = 0, noHand = 0;
  const loop = () => {
    if (!running) return;
    const now = performance.now();
    if (videoEl.currentTime !== last && videoEl.videoWidth > 0) {
      last = videoEl.currentTime;
      try {
        const d0 = performance.now();
        const res = landmarker.recognizeForVideo(videoEl, now);
        const dt = performance.now() - d0; detSum += dt; detMax = Math.max(detMax, dt);
        const hc = sceneEl.components["hand-cursor"];
        if (hc && res.landmarks?.length) hc.feedHands(res.landmarks, now, res.gestures); else noHand++;
        frames++;
      } catch (e) {
        // 프레임 하나의 오류로 추적 전체를 죽이지 않음. 처음 몇 번만 기록
        if (errCount++ < 3) { console.error("recognizeForVideo", e); onError?.(e); }
      }
      if (now - fpsT > 1000) {
        onFps?.(frames, { detAvg: frames ? detSum / frames : 0, detMax, noHandPct: frames ? Math.round((100 * noHand) / frames) : 0 });
        frames = 0; fpsT = now; detSum = 0; detMax = 0; noHand = 0;
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return { stop() { running = false; videoEl.srcObject?.getTracks().forEach((t) => t.stop()); } };
}
window.startHandTracking = startHandTracking;

/* press-feedback: 핀치(클릭)한 순간 그 대상이 "눌렸다"고 바로 보이게. 잡을 수 있는 3D 대상마다 붙인다 (hud.js, concept-stack.js).
 * 2026-09-30 사용자 지적 "선택됐을 때 피드백이 명확하지 않다" → 선택 확인은 즉시, 대상 위에서 (Meta·Apple 손 입력 가이드).
 * 0.22초 동안 밝게 번쩍(재질 색을 1보다 크게 → 텍스처가 밝아짐) + 크기가 살짝 튐. 끝나면 원래대로.
 * 크기는 다른 컴포넌트가 매 프레임 정하기도 하므로, 누른 순간의 크기를 기준으로 곱한다. */
AFRAME.registerComponent("press-feedback", {
  schema: { ms: { default: 220 }, bright: { default: 1.3 }, punch: { default: 0.18 } },
  init() {
    this.t0 = -1;
    this.onPress = () => {
      this.t0 = performance.now();
      this.base = this.el.object3D.scale.clone(); this.lastSet = null;
      this.mats = [];
      this.el.object3D.traverse((o) => { if (o.material?.map) this.mats.push(o.material); }); // 투명 판정 영역(텍스처 없음)은 제외
    };
    this.el.addEventListener("pinchstart", this.onPress);
  },
  remove() { this.el.removeEventListener("pinchstart", this.onPress); this.restore(); },
  restore() { for (const m of this.mats || []) m.color.setScalar(1); },
  tick() {
    if (this.t0 < 0) return;
    const p = (performance.now() - this.t0) / this.data.ms;
    const sc = this.el.object3D.scale;
    // 다른 컴포넌트가 이번 프레임에 크기를 다시 정했으면(패널이 날아가는 중 등) 그 값을 새 기준으로
    if (this.lastSet && !sc.equals(this.lastSet)) this.base.copy(sc);
    if (p >= 1) { this.t0 = -1; this.restore(); if (this.lastSet && sc.equals(this.lastSet)) sc.copy(this.base); this.lastSet = null; return; }
    const k = Math.sin(Math.PI * p); // 0 → 1 → 0
    for (const m of this.mats) m.color.setScalar(1 + this.data.bright * k);
    sc.copy(this.base).multiplyScalar(1 + this.data.punch * k);
    this.lastSet = sc.clone();
  },
});
