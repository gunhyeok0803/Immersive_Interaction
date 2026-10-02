# 시스템 학습 노트

2026-09-30 코드 기준 (커밋 `1075122`). AI(Claude Code)가 만든 코드와 시스템을 그대로 믿고 두지 않고, 따로 받아 공부하고 검증하기 위한 노트.

- 0~4장: 구조와 코드 설명 (코드 파일을 옆에 열고 읽기)
- 5장: 자가 테스트 30문항 (답은 접혀 있음)
- 6장: 값을 직접 바꿔 보며 확인하는 실습
- 7장: 예상 질문과 답
- 8장: 수정 내용 (바꾼 것 · 수치 · 코드 전 → 후 · 코드 검토 결함)

---

## 0. 한 장 요약

```text
[미리, 내 PC에서]  데이터 만들기 (tools/, Node)                       [발표 때, 브라우저에서]  앱 (source/, A-Frame)
                                                                        
 fetch-papers.mjs ─ 연구실 논문 44편 (제목·초록·DOI)                    index.html ── 장면 선언 + HTML 상세 창
 fetch-links.mjs  ─ 무료 원문 주소 + 빈 초록 채우기                          │
 build-concept-graph.mjs ─ Codex CLI(GPT-6-Luna)에게                       ├ hand-cursor   웹캠 손 → 커서·핀치·편 손·주먹
        │   graph  : 개념 90개 + 선수 관계                                 ├ paper-galaxy  논문 은하 (돌리기·조준 카드)
        │   cards  : 개념 카드 90장 (6단계 내용)                           ├ concept-stack  손바닥 펴기 = 층 펼치기    
        │   paths  : 논문별 학습 경로 44개                                 ├ hud           상태 관리 (패널·상세 창·뒤로)
        │   briefs : 논문 요약 44개 (문제·방법·결과·의미)                    │
        │   + 코드 검사: 순환 제거, 경로 정렬, 보기 번호 통일                └ study-panel   JSON → 상세 창 HTML
        ▼
 source/data/study/*.json  ───────────── 정적 파일로 배포 (GitHub Pages) ──────────▶ 브라우저가 fetch로 읽음
```

- 서버가 없다. 학습 내용은 **미리 만들어 둔 JSON**이고 브라우저는 읽기만 한다. (실시간 OpenAI API 계획은 결제·시연 안정성 때문에 버림. API 호출 0회)
- 입력은 **웹캠 속 손 하나**. 손이 1초 이상 안 보이면 마우스로 자동 전환.
- 핵심 인터랙션 하나: **핀치로 논문을 잡고 → 손을 펴는 만큼 → 개념 층이 L3 → L2 → L1로 다가옴.**

---

## 1. A-Frame 기초 (이것만 알면 코드가 읽힌다)

A-Frame = three.js 위에 HTML 태그로 3D 장면을 쓰는 프레임워크. 구조는 **ECS (Entity–Component–System)**.

| 용어 | 뜻 | 이 프로젝트의 예 |
| --- | --- | --- |
| Entity | 장면 속 물체 하나. `<a-entity>` 태그 | `#galaxy`, `#stack`, `#cursor` |
| Component | 엔티티에 붙이는 기능. 속성 이름이 곧 컴포넌트 이름 | `paper-galaxy="radius: 4.6"` |
| schema | 컴포넌트가 받는 값과 기본값 | `rotateGain: { default: 3.0 }` |
| `init()` | 붙을 때 한 번 | 메시 만들기, 이벤트 등록 |
| `tick(t, dt)` | **매 프레임** (dt = 지난 프레임부터 ms) | 애니메이션, 손 값 읽기 |
| `remove()` | 떨어질 때 | 텍스처 정리 |
| 이벤트 | `el.emit("이름", detail)` → 부모로 버블링 → `addEventListener` | `paper-select`, `concept-select` |

등록: `AFRAME.registerComponent("이름", { schema, init, tick, remove })`.

**왜 컴포넌트로 나눴나**: 기능마다 파일·책임이 나뉘고, 서로는 **이벤트로만** 대화한다. 은하가 층 구조의 내부를 몰라도 된다.

**three.js를 직접 쓰는 곳**: 캔버스에 글자를 그려 텍스처로 붙이는 패널·카드(`canvasOf`, `texOf`, `flatMesh` — hud.js), 은하의 점(`THREE.Points`)과 선(`LineSegments`).

---

## 2. 브라우저 앱: 파일별

### 2.1 `index.html` — 장면 선언과 HTML 상세 창

```html
<a-scene ... hand-cursor="pointer: knuckle; pinchStart: 0.28; pinchEnd: 0.45; graceMs: 300">
  <a-entity id="camera" camera="fov: 70" position="0 1.5 0" look-controls="enabled: false">
    <a-entity id="cursor" position="0 0 -1.5"> 링 · 원호 · 점 </a-entity>
  </a-entity>
  <a-entity id="ray" raycaster="objects: .target, .blocker; ... interval: 0"></a-entity>
  <a-entity id="galaxy" position="0 2.75 -7.5" paper-galaxy="radius: 4.6; tilt: 0.5; cardW: 1.7"></a-entity>
  <a-entity id="hud" hud="src: data/papers.json"></a-entity>
  <a-entity id="stack" position="0 1.5 -2.6" concept-stack="yawMax: 0.6; yawGain: 2.4; cols: 3"></a-entity>
</a-scene>
```

- `hand-cursor`는 **장면(a-scene)에 붙은** 컴포넌트다. 그래서 다른 곳에서 `sceneEl.components["hand-cursor"]`로 손 상태를 읽는다.
- 커서는 **카메라의 자식** → 항상 화면의 그 자리. 카메라 조작(look-controls)은 끔: 손 = 커서이므로.
- 레이(`#ray`)는 `.target`(누를 수 있는 것)과 `.blocker`(앞을 가리는 것)만 본다. `interval: 0` = 매 프레임 검사.
- 스크립트 순서: `hand-cursor → study-panel → hud → concept-stack → paper-galaxy`. **hud.js가 그리기 도우미(`canvasOf` 등)를 정의**하므로 뒤 두 파일보다 먼저.
- 아래쪽 `<script>`가 하는 일:
  - `hud-focus` 이벤트를 받아 상세 창에 HTML을 넣고 `paginate()`로 **스크롤 없이 쪽 나누기** (개념 카드는 `section.stage` 6단계 단위, ⑤는 문제마다 한 화면).
  - `pinch-empty`(3D 대상이 없는 핀치) → 커서 위치의 HTML 버튼을 `elementFromPoint`로 찾아 `click()`. **손으로 HTML 버튼을 누르는 방법.**
  - 보기 고르기: 한 번만, 정답 초록·오답 빨강 + 해설 표시.
  - 진단 칸: 추적 fps, 추론 ms, 손 없음 %, 화면 fps, 손 편 정도, 손 모양. 손 뼈대(`drawBones`).

### 2.2 `js/hand-cursor.js` — 손을 입력으로 바꾸는 파이프라인

```text
웹캠 640×480 ─▶ MediaPipe Gesture Recognizer (recognizeForVideo)
                 │ landmarks: 손 관절 21점 (x,y 0~1)      gestures: [{categoryName, score}]
                 ▼
 feedHand(lm, ts, cats)
  ① 포인터 = 검지·중지 뿌리 관절(5·9) 중간, x는 거울 반전 (1 - x)
  ② setNorm → One Euro 필터 → 고정(lock/hold) 적용 → 카메라 앞 1.5m 평면 위 3D 위치
  ③ 핀치 비율 = |엄지끝4 - 검지끝8| / |손목0 - 중지뿌리9|  (EMA 0.5)
  ④ 편 정도 openness = Open_Palm 점수 (EMA 0.4)
  ⑤ 주먹 = Closed_Fist ≥ 0.6 을 600ms 유지 → close-all {via:"fist"}
  ⑥ 핀치 직전 고정: 비율 < 0.36 이면 커서 고정, 600ms 안에 핀치 안 되면 풀고 손을 벌릴 때까지 재고정 금지
  ⑦ 핀치 판정: 비율 < 0.28 (그리고 검지가 말려 있지 않음) → 켜짐 / > 0.45 → 꺼짐   (히스테리시스)
 tick()
  ⑧ 눈(카메라) → 커서 방향으로 레이, 매 프레임 intersectedEls 직접 읽기 (readRay)
  ⑨ 커서 모양: 링 축소·색, 원호(핀치 강도 / 펼친 정도 / 주먹 남은 시간은 빨강)
```

핵심 코드와 이유:

| 무엇 | 코드 | 왜 |
| --- | --- | --- |
| 포인터 | `knucklePoint = (lm) => [1 - (lm[5].x + lm[9].x) / 2, ...]` | 손가락을 모으거나 펴도 뿌리 관절은 거의 안 움직임 (9/30 "손을 펴니까 커서가 움직인다") |
| 비율로 판정 | `pinchRatio`: 엄지–검지 거리 **÷ 손 크기** | 카메라에서 멀어져도(손이 작게 찍혀도) 같은 기준 |
| 히스테리시스 | 켜짐 0.28 / 꺼짐 0.45 | 경계에서 켜졌다 꺼졌다 떨리지 않게 |
| One Euro 필터 | `cutoff = minCutoff + beta·|속도|` (minCutoff 4, beta 0.6) | 가만히 있으면 강하게 평활(떨림 제거), 빨리 움직이면 약하게(지연 없음) |
| 핀치 직전 고정 | `lock = { pt, from, t }` | 손가락을 모으는 동작 자체가 커서를 흔들어 옆 대상이 눌리던 문제 |
| hold | `hc.hold`, `hc.holdOwner = "stack"` | 손바닥으로 층을 돌리는 동안 커서를 잡은 자리에 멈춤 |
| 대상 유지 | `graceMs: 300` | 레이가 살짝 벗어나도 직전 대상으로 핀치 인정 (조준과 확정 분리) |
| 가림막 | `if (first?.classList.contains("blocker")) first = null;` | z-버퍼처럼: 가장 앞에 맞은 게 층 프레임이면 뒤 패널은 못 잡음 |
| 매 프레임 읽기 | `readRay()` | raycaster 이벤트는 "새로 들어온" 대상이 있을 때만 나서, 겹친 대상에서 누락됨 |
| 추론 장치 | 시작할 때 GPU·CPU 각각 8프레임 재서 중앙값 빠른 쪽 | 이 PC(Intel Arc)는 GPU 126~149ms > CPU 59~84ms |
| 마우스 폴백 | 손 1000ms 없으면 `setMode("mouse")`, 같은 `setNorm`/`setPinch` 경로 | 시연 중 손을 놓쳐도 계속 진행 |

`press-feedback` (같은 파일 끝): 핀치한 대상이 0.22초 동안 밝아지고(`color.setScalar(1 + 1.3·sin)`) 크기가 18% 튐. 9/30 "선택됐을 때 피드백이 명확하지 않다" → 확인은 즉시, 대상 위에서.

### 2.3 `js/paper-galaxy.js` — 논문 은하

- **배치(나선)**: 논문을 연도순으로 i = 0..N-1, `t = i/(N-1)`, 각도 `th = t·2π·0.92`, 반지름 `r = R·(0.32 + 0.68t)`. 안쪽 = 오래된 논문, 바깥 = 최신. `turns 0.92` < 1이라 한 방향에 두 논문이 겹치지 않음.
- **개념 점**: 그 개념을 쓰는 논문들 위치의 **평균** + 약간 흩뿌림 → 여러 논문이 공유하는 개념은 그 사이에.
- **퍼지는 연출**: 처음 1.8초, 가운데에서 바깥으로 (안쪽부터 먼저).
- **돌리기** (`rotateByHand`): **편 손 좌우** (9/30 사용자 원칙: 돌리기 = 편 손, 선택 = 핀치, 뒤로 = 주먹)
  - 손 모드, 편 정도 > 0.55 (이미 도는 중이면 > 0.35), 핀치 아님, 커서가 빈 공간(카드·HTML 위가 아님)
  - **초기 화면에서만**: `canRotate` = 상세 창·층 구조·좌우 패널이 모두 닫혀 있고, 논문을 막 골라 손바닥(= 펼치기)을 기다리는 중도 아닐 때 (hud가 정함). 다른 논문은 주먹으로 접은 뒤 돌림
  - 돌리는 동안 커서는 `hold`로 멈춤
  - 속도: `vel = 0.7·vel + 0.3·(dx · rotateGain · 1000/dt)` (rotateGain 3 = 사용자 지정)
  - 손을 멈추면 감속(`exp(-dt/350)`) → 속도 < 0.25면 **가장 가까운 논문으로 스냅**. 끝없이 돎(최신 다음 = 가장 오래된 논문).
  - 전에는 패널이 열려 있어도 돌아 "손을 펴면 은하가 돈다"(펼치기와 겹침)는 문제가 있었음. 잠깐 '빈 곳 핀치 끌기'로 바꿨다가, 핀치는 선택만 하게 하고 편 손으로 되돌림
- **조준 카드** `#focus-card`: 화면 아래 가운데 고정. 앞에 온 논문의 연도·제목. 핀치 → `paper-select {id}`. 층이 펼쳐지면 작은 "▼ 핀치 = 층 접기" 버튼으로 바뀜(`compact`).
- **밝기**(hud가 정함): 첫 화면 1 / 논문 선택 0.2 / 상세 창·층 구조 0.08. 은하는 배경으로 물러나고 글자는 카드 하나에만.
- 마우스·키보드 대체: 휠, ←/→.

### 2.4 `js/concept-stack.js` — 층 구조

펼치기·접기는 hud가 정한다 (9/30 변경, 아래 2.5의 `tickPalm`):

```text
 카드 핀치(새 논문) ─▶ 논문 로드, '손바닥 펴기'를 기다림 (armPalm)
                          │ 편 정도 ≥ 0.5 를 0.2초 유지 (시간 제한 없음)
                          │   또는 선택된 카드를 한 번 더 핀치 (예비)
                          ▼
                     층 구조를 끝까지 펼침 (open) ─▶ 0.9초 뒤 좌우 패널이 뒤에 펼쳐짐
 펼쳐진 동안: 편 손 좌우 = 층 회전 / 노드 핀치 = 개념 카드
 주먹·Esc: 층과 좌우 패널을 같이 접기 → 한 번 더 = 논문 해제
```

- 전에는 `pullable` 컴포넌트가 "핀치 → 놓음 → 편 만큼 펼침 → 0.75 넘으면 고정"을 처리했지만, 실제 손의 편 정도가 낮고 흔들려(진단 칸 37%) 끝까지 가지 못해 없앰.

**`concept-stack`** (`#stack`):
- `open()` / `fold()`로 `uTarget`(펼침 0 또는 1)을 정하고, 매 프레임 `u += (uTarget - u)·(1 - e^(-dt/90))`로 부드럽게 따라감.
- `rotate()`: 펼쳐진 동안 편 손 좌우(0.55 넘게 펴고 빈 곳을 가리킬 때 시작, 커서는 `hold`로 멈춤) → `yawTarget` (±0.6rad). 핀치로는 돌지 않음.
- `setPath(concepts)`: 논문의 학습 경로로 **엔티티를 동적으로 생성** — 수준마다 `stack-layer`, 그 안에 개념마다 `concept-node` + `press-feedback`. 선수 관계선은 레이 판정에서 뺌(`lines.raycast = () => {}`: 선의 기본 판정 폭이 다른 대상을 가로챔).
- 층 자리 `LEVEL_POSE`: L3 z 0.15 / L2 0.5 / L1 0.8 → **기초(L1)가 나에게 가장 가깝게** (사용자 결정).

**`stack-layer`**: 보이는 동안(불투명도 > 0.3) `.blocker` 클래스 → 뒤의 패널이 레이에 안 잡힘.
**`concept-node`**: 완전히 펼쳐졌을 때만 `.target` → 핀치하면 `concept-select {concept}`.

### 2.5 `js/hud.js` — 상태 관리자

- `init()`: papers.json 로드(연도순 정렬) → 개념 그래프, 개념→논문 역색인 → 패널 4장 생성 → `galaxy.setPapers()`.
- **패널 4장**: 왼쪽 = 논문 요약 · 학습 경로, 오른쪽 = 필요한 개념 · 관련 논문 (사용자 결정 "좌우 2장씩 크게"). 크기는 위아래 HTML(170px / 110px) 사이를 채우게 계산.
- **이벤트 처리**:

| 들어오는 이벤트 | 하는 일 |
| --- | --- |
| `paper-select {id}` | 다른 논문이면 `loadPaper` (경로 JSON 읽기 → `buildPaperSteps` → `stack.setPath` → 은하 `setSelected`로 빛줄기) + 손바닥 기다림. 이미 고른 논문이면 층 펼치기·접기 |
| `concept-select` | 그 개념 카드 단계로 상세 창 열기 |
| 패널 `pinchstart` | 그 패널의 단계로 상세 창 열기 |
| `close-all` (주먹·Esc) | `back()`: 상세 창 → 층 구조 + 좌우 패널(같이) → 논문 해제, **한 단계씩** |

- **상세 창 단계** (`buildPaperSteps`): 논문 요약 → 학습 경로 → 개념 카드들(**L3 → L2 → L1, top-down**) → 관련 논문. `StudyPanel.topDown()`이 순서를 정함.
- **상세 창이 열리면** `lockRay(true)`: 레이 대상을 `.hud-locked`(아무것도 없음)로 → 3D는 전혀 안 잡히고 HTML만 누름.
- `tick()`: 매 프레임 은하 밝기·`canRotate`·`compact`, 층 구조 `visibility`·`interactive`를 정함. `tickPalm()`: 손바닥 편 정도를 커서 원호로 보여 주고 기준을 넘으면 `openStack()`. `hitDirty`면 레이 대상 목록 새로 읽기.

### 2.6 `js/study-panel.js` — JSON → HTML

- 개념 카드 6단계: `section.stage` 6개. ① 왜(이 논문에서 하는 일 + 먼저 알아야 할 개념) ② 직관 ③ 정의·식(식이 없으면 **정의·구조**) ④ 핵심 ⑤ 풀어 보기(계산형 = 풀이 가림 / 보기형 = 고르면 정답·해설) ⑥ 연결(코드, 위에 쌓이는 개념, 이 개념을 쓰는 다른 논문).
- `topDown(path, g)`: 저장된 경로(기초가 앞)를 **뒤집고 수준 L3 → L1로 안정 정렬**. 선수 개념은 항상 같거나 낮은 수준이라, 이 순서면 어떤 개념도 자기 선수 개념보다 먼저 나온다 (44개 경로 모두 코드로 확인).
- 수식은 KaTeX로. `\( … \)` 안만 수식, 나머지는 이스케이프(`esc`) — 생성된 글에 HTML이 섞여도 안전.

---

## 3. 전체 흐름 한 번 따라가기 (이벤트 추적)

"은하를 돌리고 → 논문을 고르고 → 손바닥을 펴서 층을 펼치고 → 개념을 누르고 → 주먹으로 뒤로"

| # | 손 | 코드에서 일어나는 일 |
| --- | --- | --- |
| 1 | 빈 공간에서 편 손을 좌우로 | `paper-galaxy.rotateByHand`: 편 정도 > 0.55, 대상 없음 → `hold`, 속도 → 멈추면 스냅. 조준 카드 글자 갱신 (초기 화면에서만) |
| 2 | 카드 위에서 엄지·검지를 모음 | 비율 < 0.36 → `lock`(커서 고정). 원호가 차오름 |
| 3 | 붙임 (< 0.28) | `setPinch(true)` → 카드에 `pinchstart` → ① `press-feedback` 번쩍 ② `paper-galaxy`가 `paper-select` |
| 4 | | `hud.loadPaper` → 경로 JSON → `stack.setPath`, 은하 빛줄기. `armPalm = true` (아직 아무것도 안 펼침) |
| 5 | 손바닥을 폄 | `tickPalm`: 커서 원호 = 편 정도. 0.5 이상 0.2초 → `openStack()` → 층이 펼쳐짐, `stack-layer`가 `.blocker`가 됨 |
| 6 | | 0.9초 뒤 좌우 패널이 뒤에 펼쳐짐 (`panelsAt`). 은하는 `canRotate = false` |
| 7 | 편 손 좌우 | `concept-stack.rotate()` → 층 회전, 노드가 `.target` |
| 8 | 손을 오므림 | 회전 끝, 커서 `hold` 풀림 |
| 9 | 노드 핀치 | `concept-select` → `hud.showSteps` → `lockRay(true)` → `hud-focus` → index.html이 쪽 나눠 표시 |
| 10 | 주먹 0.6초 | `close-all {via:"fist"}` → `hud.back()` → 상세 창 닫힘. 한 번 더 → 층과 좌우 패널이 같이 접힘 |

---

## 4. 데이터 생성: `tools/`

| 단계 | 파일 | 하는 일 |
| --- | --- | --- |
| 논문 수집 | `fetch-papers.mjs` | 연구실 페이지의 DOI를 기준으로 논문 DB(OpenAlex)에서 제목·초록·연도 → `papers.json` (44편) |
| 원문·초록 보강 | `fetch-links.mjs` | OpenAlex의 무료 PDF(`pdf_url`, 19편)·저장소 사본(`repo_url`, 8편). 초록이 없으면 Semantic Scholar → Crossref (2편 보충, 5편은 끝내 없음) |
| 개념 그래프 | `build-concept-graph.mjs graph` | 44편 요약을 Codex에 → 개념 90개 + 선수 관계. **코드 검사** `validate()` |
| 개념 카드 | `... cards` | 4개씩 묶어 생성 → `tidyCard()`로 정리 |
| 학습 경로 | `... paths` | 논문마다 필요한 개념과 "이 논문에서 하는 일" → `order()`로 선수 순서 정렬 |
| 논문 요약 | `... briefs` | 초록 전체로 문제·방법·결과·의미 각 1~2문장 → 경로 파일의 `brief`. 초록이 없으면 제목만으로 쓰고 `from_title` 표시 (결과·의미는 비움) |
| Codex 호출 | `lib/codex.mjs` `codexJson()` | `codex exec`를 **빈 임시 폴더 + 읽기 전용 샌드박스**에서 `--output-schema`로 실행 → 스키마에 맞는 JSON만 받음 |

AI 결과를 그대로 믿지 않는 장치 (**코드가 검사**):

- `validate()`: 없는 선수 id 버림 → **깊이 우선 탐색으로 순환 간선 제거**(방문 중인 노드로 가는 간선을 끊음) → 모든 개념이 L1까지 닿는지 경고 → 응용 = 선수의 역방향으로 계산.
- `order()`: 모델이 경로 순서를 틀려도 선수 개념이 앞에 오게 재정렬 (저장 형식). 화면에서는 `topDown()`이 뒤집어 보여 줌.
- `tidyCard()`: 빈 식·구조·코드는 null, 보기가 모자란 보기형 문제는 계산형으로, 해설의 "○번"을 ①②③④로 통일(0부터 센 것·1부터 센 것이 섞여 있었음, 113개 수정).
- 스키마: 식·구조·코드는 nullable (식이 필요 없는 개념에 억지 식 금지). 식 369개 KaTeX 오류 0.

---

## 5. 자가 테스트 (먼저 떠올리고 펼치기)

### A. 구조

1. 이 앱에 서버가 있나? 학습 내용은 언제 만들어지나?
<details><summary>답</summary>없다. 정적 파일(GitHub Pages). 학습 내용은 내 PC에서 Codex CLI로 미리 만들어 JSON으로 저장했고, 브라우저는 fetch로 읽기만 한다.</details>

2. `hand-cursor`는 어느 엔티티에 붙어 있고, 다른 컴포넌트는 손 상태를 어떻게 읽나?
<details><summary>답</summary>`<a-scene>`에 붙어 있다. `this.el.sceneEl.components["hand-cursor"]`로 `norm`, `pinching`, `openness`, `target` 등을 읽는다.</details>

3. 스크립트 로드 순서에서 hud.js가 concept-stack.js·paper-galaxy.js보다 앞이어야 하는 이유는?
<details><summary>답</summary>그리기 도우미(`canvasOf`, `texOf`, `flatMesh`, `hitMesh`, `fit`, `HUD` 색 등)가 hud.js에 정의되어 있어서.</details>

4. 컴포넌트끼리 직접 함수를 부르지 않고 주로 무엇으로 대화하나? 예를 두 개.
<details><summary>답</summary>이벤트. `paper-select`(은하 → hud), `pinch-empty`(손 → index.html: 3D 대상 없는 핀치 = HTML 버튼 누르기), `concept-select`(노드 → hud), `close-all`(손·키보드 → hud).</details>

5. `tick(t, dt)`의 dt는 무엇이고, `u += (uTarget - u)·(1 - e^(-dt/90))`는 무슨 효과인가?
<details><summary>답</summary>지난 프레임부터 흐른 ms. 목표값을 지수적으로 부드럽게 따라가며, 프레임 속도가 달라도 같은 속도로 움직인다(시정수 90ms).</details>

### B. 손 입력

6. 커서 기준점은 어느 관절이고, 왜 엄지·검지 끝이 아닌가?
<details><summary>답</summary>검지·중지 뿌리 관절(5·9)의 중간. 손가락을 모으거나 펴도 거의 안 움직여서, 핀치나 손 펴기 중에 커서가 흘러가지 않는다.</details>

7. 핀치를 거리 그대로가 아니라 "비율"로 판정하는 이유는?
<details><summary>답</summary>엄지–검지 거리를 손 크기(손목–중지 뿌리)로 나눠서, 카메라와의 거리에 따라 손이 크게·작게 찍혀도 같은 기준이 되게.</details>

8. 핀치 켜짐 0.28, 꺼짐 0.45로 다르게 둔 것을 무엇이라 하고, 왜?
<details><summary>답</summary>히스테리시스. 경계 근처에서 값이 떨려도 켜졌다 꺼졌다 반복하지 않게.</details>

9. One Euro 필터가 이동 평균보다 나은 점은?
<details><summary>답</summary>속도에 따라 차단 주파수가 바뀜. 가만히 있으면 강하게 평활해 떨림을 없애고, 빨리 움직이면 약하게 해서 지연이 없다. 이동 평균은 둘 중 하나를 포기해야 함.</details>

10. "핀치 직전 고정(lock)"은 어떤 문제를 풀었나? 고정이 풀리는 세 가지 경우는?
<details><summary>답</summary>손가락을 모으는 동작이 커서를 흔들어 옆 대상이 눌리던 문제. 풀림: 핀치가 끝남 / 핀치 없이 0.55 이상으로 다시 벌림 / 600ms 안에 핀치가 안 됨(이때는 손을 벌릴 때까지 재고정 금지).</details>

11. "편 손" 판정을 직접 정한 비율 대신 Gesture Recognizer 점수로 바꾼 근거는?
<details><summary>답</summary>진단 칸에서 실제 손의 펴짐 값이 1.14였는데 직접 정한 기준은 1.55~1.9라 맞지 않았다. 학습된 공식 모델의 Open_Palm 점수가 손마다 덜 흔들림.</details>

12. 추론 장치를 GPU로 고정하지 않고 시작할 때 재는 이유와 이 PC의 결과는?
<details><summary>답</summary>PC마다 다르다. 이 PC(Intel Arc)는 GPU 126~149ms, CPU 59~84ms로 GPU가 더 느렸다. 추적 7fps(162ms)였던 원인.</details>

13. 주먹 닫기가 한 번 쥐었을 때 여러 번 닫히지 않게 하는 변수는? 손을 놓쳤을 때 타이머를 지우는 곳은?
<details><summary>답</summary>`fistDone` (손을 풀 때까지 다시 안 닫음). `setMode()`에서 `fistT`·`fistDone`을 초기화 (코드 검토에서 찾은 결함).</details>

14. 레이캐스터 이벤트 대신 매 프레임 `intersectedEls`를 읽는 이유는?
<details><summary>답</summary>raycaster 이벤트는 "새로 들어온" 대상이 있을 때만 난다. 겹친 대상에서 앞 대상이 빠지고 뒤 대상이 첫 번째가 되면 이벤트가 없어 놓친다.</details>

15. 손으로 HTML 버튼(상세 창의 ◀ ▶, 보기)은 어떻게 누르나?
<details><summary>답</summary>3D 대상이 없는데 핀치하면 `pinch-empty` 이벤트 → index.html이 커서 위치를 `elementFromPoint`로 찾아 버튼이면 `click()`.</details>

### C. 은하·층 구조

16. 은하 나선에서 오래된 논문과 최신 논문은 각각 어디에? 반지름 식은?
<details><summary>답</summary>오래된 논문 = 안쪽, 최신 = 바깥. `r = R·(0.32 + 0.68t)`, t = i/(N-1), 각도 `th = t·2π·0.92`.</details>

17. 은하가 돌지 않는 경우는? (조건 두 가지 이상)
<details><summary>답</summary>빈 곳이 아니라 카드·패널·노드 위에서 핀치함(그건 선택) / 커서가 HTML 위 / 상세 창·층 구조·좌우 패널 중 하나라도 열려 있음(`canRotate = false`, 초기 화면이 아님) / 핀치하지 않고 손만 움직임(편 손으로는 돌지 않음).</details>

18. 은하가 멈출 때 어중간한 각도가 아니라 논문 하나에 딱 맞는 원리는?
<details><summary>답</summary>손을 떼면 속도가 감쇠하고, 0.25 미만이 되면 `nearest()`로 가장 가까운 논문의 각도(2π 배수 중 가장 가까운 것)로 스냅.</details>

19. 논문을 고른 뒤 층이 펼쳐지는 두 가지 방법과, 주먹으로 층을 접은 뒤 손을 펴도 다시 안 펼쳐지는 이유는?
<details><summary>답</summary>손바닥 펴기(편 정도 0.5 이상 0.2초) 또는 선택된 카드를 한 번 더 핀치. 손바닥 대기(`armPalm`)는 카드를 핀치할 때만 켜지고, 한 번 펼치거나 접으면 꺼지기 때문.</details>

20. 층 구조가 펼쳐졌을 때 뒤의 패널이 눌리지 않는 이유는?
<details><summary>답</summary>보이는 층(`stack-layer`)이 `.blocker` 클래스를 가짐. 레이가 가장 먼저 맞은 것이 blocker면 hand-cursor가 대상을 null로 둔다.</details>

21. 개념 노드는 언제부터 누를 수 있나?
<details><summary>답</summary>펼침 u > 0.9이고, 잡고 있는 중이 아니고, 상세 창이 닫혀 있을 때(`interactive`). 그때 `.target` 클래스가 붙는다.</details>

22. 층에서 L1(기초)이 나에게 가장 가깝게 오는 것은 누구의 결정이고, 코드 어디인가?
<details><summary>답</summary>내 결정. `concept-stack.js`의 `LEVEL_POSE` (L1 z 0.8이 가장 앞).</details>

### D. 상태·상세 창

23. 주먹(또는 Esc)을 누를 때마다 무엇이 순서대로 닫히나?
<details><summary>답</summary>`hud.back()`: 상세 창 → 층 구조와 좌우 패널을 같이 접기 → 논문 해제. 한 번에 한 단계. (펼칠 때 손바닥 한 번에 층·패널이 같이 나오므로 닫을 때도 같이)</details>

24. 상세 창이 열려 있을 때 3D 대상이 전혀 안 잡히게 하는 코드는?
<details><summary>답</summary>`hud.lockRay(true)`: 레이 대상을 `.hud-locked`(해당 없음)로 바꿈.</details>

25. 상세 창이 스크롤 대신 쪽을 나누는 이유와 그 함수는?
<details><summary>답</summary>손으로는 스크롤이 어렵다. index.html의 `paginate()` (개념 카드는 6단계 단위, ⑤는 문제마다 한 화면, 넘치면 `fixOverflow`로 다음 쪽).</details>

26. 공부 화면을 3D가 아니라 2D 패널로만 만든 이유는?
<details><summary>답</summary>찾는 과정은 3D로 탐색하지만, 실제 공부에는 필기·암기처럼 손을 멈춰야 하는 순간이 있다. 그때 화면이 손에 반응하면 방해가 되므로 반응하지 않는 2D로.</details>

### E. 데이터·AI

27. Codex를 빈 임시 폴더 + 읽기 전용으로 실행하는 이유는?
<details><summary>답</summary>모델이 저장소를 읽거나 고치지 못하게. 입력은 프롬프트뿐이고, 출력은 스키마에 맞는 JSON 하나.</details>

28. 개념 그래프에서 순환을 어떻게 없애나?
<details><summary>답</summary>깊이 우선 탐색 중 "방문 중"(state 1) 노드로 가는 선수 간선을 끊는다 (`validate()`).</details>

29. 학습 경로는 저장될 때와 화면에 보일 때 순서가 다르다. 각각 무엇이고 왜?
<details><summary>답</summary>저장: 선수 개념이 앞(기초 → 연구 기법, `order()`). 화면: `topDown()`으로 뒤집고 L3 → L1 정렬. 내가 정한 학습 방법이 top-down(상위 계층부터 배우고 기초로 내려감)이라서.</details>

30. 해설의 "0번/1번" 문제는 무엇이었고 어떻게 고쳤나?
<details><summary>답</summary>모델이 보기 번호를 0부터 센 해설과 1부터 센 해설을 섞어 써서 "정답은 0번"처럼 보였다. `tidyCard()`에서 "0번"이 있으면 0부터, 없으면 1부터 센 것으로 보고 ①②③④로 바꿈 (113개).</details>

---

## 6. 직접 해 보기 (이해했다는 증거)

로컬 실행: `npx serve -l 5173 source` → <http://localhost:5173>. 바꾼 뒤 새로고침, 확인하면 **원래 값으로 되돌리기**.

1. **은하 회전 속도**: `index.html`의 `paper-galaxy="..."`에 `rotateGain: 6` 추가 → 두 배로 빨라지는지. (기본값은 `paper-galaxy.js` schema의 3.0)
2. **핀치를 더 쉽게**: `<a-scene hand-cursor="... pinchStart: 0.28 ...">`를 0.33으로 → 원호가 더 빨리 차고 덜 오므려도 눌림. 대신 오작동이 늘어나는지 관찰.
3. **주먹 닫기 시간**: `hand-cursor.js` schema `fistMs: 600` → 1200. 빨간 원호가 더 천천히 참.
4. **층 배치**: `concept-stack.js` `LEVEL_POSE`의 L1 `z: 0.8` → 0.5. 기초 층이 덜 다가옴.
5. **이벤트 엿보기** (코드 수정 없이): 브라우저 개발자 도구(F12) 콘솔에
   ```js
   ["paper-select", "pinch-empty", "concept-select", "close-all"].forEach((n) =>
     document.querySelector("a-scene").addEventListener(n, (e) => console.log(n, e.detail)));
   ```
   입력하고 3장의 흐름을 따라 해 보면 이벤트가 순서대로 찍힌다.
6. **손 상태 보기**: 콘솔에 `document.querySelector("a-scene").components["hand-cursor"]` → `openness`, `ratio`, `lock`, `hold`, `holdOwner`를 손을 움직이며 확인.

---

## 7. 예상 질문과 내 답 (소리 내 연습)

| 질문 | 답의 요지 |
| --- | --- |
| 코드는 AI가 짠 것 아닌가? 본인은 무엇을 했나? | 코드는 Claude가 썼다. 나는 ① 무엇을 만들지(주제·핵심 경험·학습 방법 top-down) ② 실제 손으로 써 보고 문제 발견(커서 흘러감, 돌리기 안 됨, 주먹 안 됨, 패널·은하 동시 반응) ③ AI 제안 중 선택·거부(추천과 다른 선택, 해설형 카드 폐기, top-down 오해 두 번 정정) ④ 결과 검증을 했다. 그리고 AI가 만든 코드를 그대로 두지 않고 따로 받아 공부·검증했다 — 어느 파일이든 열어서 설명할 수 있다. |
| 왜 WebXR이 아니라 MediaPipe? | WebXR 손 추적은 헤드셋이 필요하다. 목표는 노트북 웹캠 하나로 브라우저에서 바로 쓰는 것. |
| 손 추적이 불안정하면? | 측정부터: 진단 칸의 추론 ms로 GPU가 더 느린 걸 찾아 장치 실측 선택. 커서 흔들림은 One Euro + 뿌리 관절 포인터 + 핀치 직전 고정. 그래도 안 되면 1초 뒤 마우스로 자동 전환. |
| top-down이면 기초는 언제 배우나? | 논문(L3)에서 시작해 막히는 개념에서 아래로 내려간다. 바닥은 학부 1~2학년 기초(L1). 아는 개념은 건너뛴다. |
| AI가 만든 학습 내용이 틀리면? | 코드 검사(순환 제거, 경로 정렬, 스키마, KaTeX 오류 0, 보기 번호 통일)는 했지만 내용의 정확성은 완전하지 않다. 제목·초록 기반이라 원문 수준의 깊이는 없다 (회고의 한계). |
| 기능이 많은데 핵심은? | 하나: 핀치로 잡고 손을 펴서 기초까지 펼치기. 은하 돌리기·주먹은 거기까지 가기 위한 보조. |
| 왜 공부 화면은 2D? | 필기·암기로 손을 멈추는 순간 화면이 반응하면 방해. 찾기는 3D, 공부는 2D. |
| z-버퍼처럼 했다는 게 무슨 뜻? | 레이에 맞은 것 중 가장 앞의 것만 반응. 앞의 층 프레임이 가림막(.blocker)이면 뒤의 패널은 안 눌리고, 은하는 커서가 빈 공간일 때만 돈다. |

---

## 8. 수정 내용 — 무엇을 어떻게 바꿨나

AI가 처음 만든 것을 써 보고 바꾼 것 (문제 → 전·후 → 확인), 바꾼 수치, 바꾼 코드, 코드 검토로 고친 결함. 발표 자료의 "수정 내용 ① 바꾼 수치 / ② 바꾼 코드" 두 장의 원본. "확인"의 **실제 손** = 내 손으로 확인, **합성** = 합성 손 좌표·마우스·가짜 웹캠으로만 확인.

### 손 입력 (`hand-cursor.js`)

| 문제 (발견) | 전 → 후 | 확인 |
| --- | --- | --- |
| 손을 펴거나 핀치하면 커서가 흘러감 | 포인터: 엄지·검지 끝 중간 → 검지·중지 뿌리 관절(5·9) 중간 (`knucklePoint`) | 합성 |
| 핀치하는 동안 커서가 옆으로 가서 옆 대상이 눌림 | 없음 → 손가락이 모이면(비율 < 0.36) 커서 고정, 600ms 안에 핀치 안 되면 풀고 손을 벌릴 때까지 재고정 금지 (`lock`, `lockBlocked`) | 합성 (A/B) |
| 추적 7fps, 추론 162ms | 추론 장치 GPU 고정 → 시작할 때 GPU·CPU를 재서 빠른 쪽 (가짜 웹캠 시험은 CPU, 10/1 실제 웹캠은 GPU 8ms · CPU 25ms → GPU) | **실제 손** (10/1 영상: 추적 29~31fps, 추론 13~25ms, 손 없음 0%) |
| 편 손 판정이 내 손과 안 맞음 (실측 펴짐 1.14, 기준 1.55~1.9) | 직접 정한 비율 기준 → Gesture Recognizer의 Open_Palm 점수 | **실제 손** (10/1 영상: 편 손 51~57%, 기준 50%. 여유가 작음) |
| 닫을 때 주먹을 쥐어도 안 닫힘 | 없음 → Closed_Fist ≥ 0.6을 0.6초 유지하면 한 단계 뒤로, 빨간 원호로 남은 시간 표시 | **실제 손** (10/1 영상: Closed_Fist 95~97%, 9번 모두 한 단계씩) |
| 선택됐는지 불분명 | 없음 → 누른 대상이 0.22초 번쩍·튐 (`press-feedback`), 커서 자리 파문 | 합성 |

### 3D 화면

| 문제 (발견) | 전 → 후 | 확인 |
| --- | --- | --- |
| 가운데가 논문인지 알 수 없고 정적 | 코어 링·논문 칩 → 논문 44편의 은하(연도 = 나선). 위쪽 연구 주제 분류 삭제 | 캡처 |
| 몸쪽으로 당기기가 잘 인식 안 됨 | 손 크기로 당기기 → 핀치로 잡은 뒤 손을 펴는 만큼 펼치기 (`pullable`) | 합성 |
| 은하 돌리기가 안 됨 | 나선 끝에서 멈춤 → 끝없이 돎 / 시작 기준 0.8 → 0.55(유지 0.35) / 속도 이득 5 → 10 → 6 → 3 (내가 지정) | **실제 손** |
| 패널이 열려도 은하가 돌고, 패널과 은하가 동시에 멈춤 | 전체 잠금 → z-버퍼처럼: 보이는 층 프레임은 가림막(`.blocker`), 은하는 커서가 빈 공간일 때만 돎 | 합성 |
| 핀치 후 손을 펴면 층 대신 은하가 돎, 좌우 패널이 먼저 떠서 가운데가 안 보임 | 은하 돌리기: 패널이 열려 있어도 편 손 좌우 → **편 손 좌우는 그대로, 초기 화면에서만 (손바닥 대기 중에도 안 돎)** / 층 펼치기: 편 만큼 조금씩(0.75에서 고정, 시간 제한) → **손바닥 0.5 이상 0.2초면 한 번에 끝까지, 시간 제한 없음, 카드 한 번 더 핀치도 가능** / 순서: 층 → 0.9초 뒤 좌우 패널 (`pullable` 삭제) | 합성 |

### 학습 내용 (`tools/`, `study-panel.js`)

| 문제 (발견) | 전 → 후 | 확인 |
| --- | --- | --- |
| 실시간 API는 결제·시연 안정성 문제 | OpenAI API 실시간 생성 → Codex CLI로 미리 생성해 JSON 저장 (API 호출 0회) | 생성 결과 검토 |
| "초록엔 ~로 명시" 같은 해설은 공부가 아님, 개념끼리 안 이어짐 | 논문별 해설 카드 → 개념 90개 그래프 + 논문별 학습 경로 | 데이터 검사 |
| 모든 개념에 식이 붙어 획일적 | 식 필수 → 식은 필요할 때만, 없으면 구성·흐름(구조)과 보기 고르기 문제 | KaTeX 오류 0 |
| 해설에 "정답은 0번"처럼 보임 | 0부터·1부터 센 번호 섞임 → ①②③④로 통일 (113개) | 스크립트 검사 |
| 학습 경로가 기초부터 나와 top-down과 모순 | 상세 창 순서 L1 → L3 에서 L3 → L1로 (`topDown`) | 44개 경로 코드 검사 |

### 상세 창·논문 요약·뒤로 가기 (10/1 시연 영상 검토)

영상에서 브라우저 화면이 1434×755(2배 해상도)라 쪽이 많이 나뉨. 확인은 같은 화면 크기의 헤드리스 브라우저. 요약·원문 링크는 같은 날 사용자 지적.

| 문제 (발견) | 전 → 후 | 확인 |
| --- | --- | --- |
| 학습 경로 12개가 4쪽(한 쪽 3개), 창 아래 1/3이 빈 채로 다음 쪽 핀치 3번 | 개념 + "이 논문에서 하는 일" 한 줄씩 → **개념 이름만 두 줄(1~6 / 7~12)**, 하는 일은 개념 카드 ① 왜에서 (`pathHtml`, `.steps.two`) | 합성: 4쪽 → 1쪽 |
| 층 화면에서 처음까지 주먹 3번, "패널만 남은" 쓸모없는 중간 단계 | 층 접기 → 패널 접기 → 해제 → **층과 패널을 같이 접기** → 해제 (`back()`) | 합성: 상세 창에서 처음까지 4번 → 3번 |
| 논문 요약이 2~3문장(77~181자)이라 너무 간단 | 짧은 요약 → **문제·방법·결과·의미(400~500자) + 다음 쪽에 초록 원문** (`briefs`, `summaryHtml`). 좌우 패널은 짧은 요약 그대로 | 생성 결과 검토 |
| 원문(DOI) 링크가 출판사로 가서 학교 밖에서는 막힘 | DOI 하나 → **무료 PDF → 저장소 사본 → 출판사 페이지** 순, 이름에 무료 여부 표시 (`fetch-links.mjs`) | 44편 중 무료 27편 |
| 상세 창 한 줄이 85자, 글씨가 작고 창 아래가 빔 | 창 폭 `82vh × 1.857`(1150px) → **최대 1000px**, 본문 16.5 → **19px** | 합성: 한 줄 66자. 대신 긴 단계는 두 쪽으로 (예: 9쪽 → 10쪽) |

### 바꾼 수치

값의 변화는 작업 기록(편집 이력)에서 순서대로 뽑은 것.

| 값 | 파일 | 변화 | 왜 |
| --- | --- | --- | --- |
| 은하 회전 이득 `rotateGain` | `paper-galaxy.js` | 4 → 5 → 10 → 6 → **3** | "돌리기 안 됨" → 올림 → 너무 빠름 → 줄임 → 내가 3으로 지정 |
| 은하 돌리기 시작 기준 (편 정도) | `paper-galaxy.js` `openEnough` | 0.8 → 0.55 (도는 중 유지 0.35) (그대로, 대신 초기 화면에서만) | 모델의 Open_Palm 점수는 편 손도 0.6~0.8이라 0.8을 거의 못 넘음 |
| 은하 크기·자리 | `index.html` `#galaxy` | 반지름 3.2 → 4.2 → 3.2 → **4.6**, 자리 `0 1.5 -5.4` → `0 1.35 -7` → `0 1.95 -7.5` → **`0 2.75 -7.5`**, 기울기 0.55 → 0.42 → **0.5** | 패널과 겹침·글자 가림을 피해 뒤·위로, "은하 크기 키워줘" |
| 조준 카드 흐림 조건 | `paper-galaxy.js` `cardOp` | `canRotate ? 1 : 0.35` → **`detailOpen ? 0.35 : 1`** | 패널이 열리면 카드가 흐려져 은하와 같이 멈춘 것처럼 보임 → 상세 창일 때만 흐리게 |
| 핀치 직전 고정 `lockAt` | `hand-cursor.js` | 0.42 → **0.36** (+ `lockMs` 600 시간 초과 추가) | 편하게 둔 손도 0.42 아래라 고정이 안 풀림 |
| 주먹 유지 시간 `fistMs` | `hand-cursor.js` | 3000 → **600** ms | 3초는 너무 김. 주먹 = 한 단계 뒤로 |
| 층 끝까지 펼침 `commitAt` | `concept-stack.js` `pullable` | 0.9 → 0.75 → **손바닥 0.5 이상 0.2초면 한 번에 (`PALM_OPEN`, hud.js)** | 편 손 점수가 0.9·0.75까지 잘 안 올라감 (실제 37%) |
| 층 회전 끝 `rotateUntil` | `concept-stack.js` `pullable` → `rotate()` | 0.5 → **0.35** | 편 손 판정을 모델 점수로 바꾸면서 `commitAt`과 함께 그 점수 범위에 맞춤 |
| One Euro `minCutoff` / `beta` | `hand-cursor.js` | 1.0 → 1.8 → **4.0** / 0.3 → 0.5 → **0.6** | 멈춘 뒤 커서가 늦게 도착 (1Hz면 수렴 약 0.8초 → 4Hz면 0.2초) |
| 핀치 켜짐 / 꺼짐 | `index.html` `hand-cursor` | 0.25 → **0.28** / 0.40 → **0.45** | 첫 프로토타입(9/21)에서 조정. 켜짐은 조금 쉽게, 꺼짐은 더 벌려야 풀리게 (구체적 이유는 기록 없음) |
| 레이 대상 | `index.html` `#ray` | `.target` → **`.target, .blocker`** | 가림막(층 프레임)도 레이가 맞게 해서 뒤를 막음 |
| 상세 창 폭 | `index.html` `#detail` | `min(82vh × 1.857, 95vw)` → **`min(1000px, 82vh × 1.857, 95vw)`** | 한 줄 85자 → 66자 (10/1 영상 검토) |
| 상세 창 글자 | `index.html` `.sbody` · `.lead` · `.chip` | 16.5 · 18 · 15px → **19 · 20 · 16px** | 작아서 읽기 어려움 (10/1 영상 검토) |

### 바꾼 코드 (전 → 후)

**① 커서 기준점** (`hand-cursor.js` `feedHand`)

```js
// 전: 엄지 끝(4)·검지 끝(8)의 중간 — 핀치하거나 손을 펴면 이 점 자체가 움직임
const px = this.data.pointer === "pinch" ? (tip.x + thumb.x) / 2 : tip.x;
// 후: 검지·중지 뿌리 관절(5·9)의 중간 — 손가락을 움직여도 거의 그대로
const knucklePoint = (lm) => [1 - (lm[5].x + lm[9].x) / 2, (lm[5].y + lm[9].y) / 2];
```

**② 손 추적 모델과 추론 장치** (`startHandTracking`)

```js
// 전: 관절만 주는 Hand Landmarker, GPU 먼저 (실패할 때만 CPU)
landmarker = await makeLandmarker("GPU");            // HandLandmarker.createFromOptions
const res = landmarker.detectForVideo(videoEl, now);
// 후: 관절 + 손 모양 분류를 주는 Gesture Recognizer, GPU·CPU를 둘 다 재서 빠른 쪽
for (const delegate of ["GPU", "CPU"]) { const lm = await makeLandmarker(delegate); cands.push({ delegate, lm, ms: bench(lm) }); }
cands.sort((x, y) => x.ms - y.ms);
const res = landmarker.recognizeForVideo(videoEl, now);   // res.landmarks + res.gestures
```

**③ 주먹 판정** (`feedHand`)

```js
// 전: 네 손가락 끝이 둘째 관절보다 손목에 가까우면 주먹 (직접 만든 기하 규칙), 3초 유지
const fist = indexCurled && curled(12, 10) && curled(16, 14) && curled(20, 18);
// 후: 학습된 모델의 분류 점수, 0.6초 유지
const fist = top?.categoryName === "Closed_Fist" && top.score >= this.data.fistScore;
```

**④ 편 손 판정** (`feedHand`)

```js
// 전: 손가락 펴짐·벌어짐 비율을 직접 정한 구간(1.55~1.9, 0.75~1.25)으로 0~1
let open = (c01((ext - extFrom) / (extTo - extFrom)) + c01((spread - spreadFrom) / (spreadTo - spreadFrom))) / 2;
// 후: 모델이 있으면 Open_Palm 점수 (위 식은 모델이 없을 때의 대체값으로만 남김)
if (cats) { const palm = cats.find((c) => c.categoryName === "Open_Palm"); open = palm ? palm.score : 0; }
```

**⑤ 가림막 (z-버퍼처럼)** (`hand-cursor.js` `readRay`, `concept-stack.js` `stack-layer.pose`)

```js
// 추가: 레이가 가장 먼저 맞은 것이 가림막이면 대상 없음
if (first?.classList.contains("blocker")) first = null;
// 추가: 보이는 층은 가림막
const block = op > 0.3;
if (this.el.classList.contains("blocker") !== block) { this.el.classList.toggle("blocker", block); this.el.emit("hud-hit-dirty"); }
```

**⑥ 은하는 초기 화면에서만** (`hud.js` `tick`)

```js
// 전: 패널이 열려 있어도 빈 공간이면 편 손으로 돎 → 손바닥 펴기(층 펼치기)와 겹침
gx.canRotate = !busy;
// 후: 상세 창·층 구조·좌우 패널이 모두 닫혀 있고, 손바닥(= 펼치기) 대기 중도 아닐 때만
gx.canRotate = !this.focusFan && st.uTarget === 0 && st.u < 0.05 && this.paperFan.uTarget === 0 && !this.panelsAt && !this.armPalm;
```

**⑦ 학습 경로 순서** (`study-panel.js`, `hud.js`)

```js
// 전: 저장된 순서 그대로 (기초 L1이 먼저)
${path.path.map((s) => ...)}
// 후: 뒤집고 수준 L3 → L2 → L1로 안정 정렬
function topDown(path, g) {
  const list = (path?.path || []).filter((s) => g?.byId[s.concept]).reverse();
  return list.map((s, i) => [s, i]).sort((a, b) => g.byId[b[0].concept].level - g.byId[a[0].concept].level || a[1] - b[1]).map(([s]) => s);
}
```

**⑧ 해설 번호 통일** (`build-concept-graph.mjs` `tidyCard`)

```js
// 추가: 해설에 "0번"이 있으면 0부터 센 것, 없으면 1부터 센 것으로 보고 ①②③④로 바꿈
const zero = /(^|[^0-9])0번/.test(p.solution);
p.solution = p.solution.replace(/(^|[^0-9])(\d)번/g, (m, pre, d) => { const j = zero ? +d : +d - 1; return j >= 0 && j < p.choices.length ? pre + String.fromCharCode(0x2460 + j) : m; });
```

**⑨ 주먹: 층과 패널을 같이 접기** (`hud.js` `back`)

```js
// 전: 층만 접고, 패널은 주먹 한 번 더
if (this.stack().uTarget > 0) { this.foldStack(); return; }
// 후: 손바닥 한 번에 같이 펼쳐지므로 같이 접음
if (this.stack().uTarget > 0) { this.foldStack(); this.paperFan.uTarget = 0; return; }
```

### 코드 검토로 고친 결함 (별도 에이전트 검토 → 수정)

| 결함 | 고친 것 |
| --- | --- |
| 주먹을 쥔 채 손을 놓치면 다음 주먹이 바로 닫힘 | `setMode()`에서 주먹 타이머 초기화 |
| 개념을 끼워 넣으면 패널의 단계 번호가 어긋남 | `showSteps()`가 단계 목록을 복사해서 씀 |
| 펼치는 도중 다시 핀치하면 층이 반쯤 남음 | `pullable.onStart`가 이전 동작을 먼저 끝냄 |
| 사라진 대상에 핀치가 들어감 | `setPinch()`가 대상이 아직 `.target`인지 확인 |
| 툴팁 종류 불일치, 쓰지 않는 이벤트 | 개념 노드만 툴팁, 미사용 이벤트 삭제 |
| 층 엔티티가 초기화 전에 그려지며 렌더 루프 전체가 멈춤 | `stack-layer.pose()`·`concept-node.show()`에 초기화 확인 |

---

## 부록: 숫자 암기표

| 항목 | 값 |
| --- | --- |
| 논문 / 개념 / 경로 | 44편 / 90개 (L1 27 · L2 37 · L3 26) / 44개 (6~12개씩) |
| 카드 | 식 51 · 구조 90 · 코드 29, 문제 계산 54 · 보기 145, 수식 369개 KaTeX 오류 0 |
| 핀치 | 켜짐 0.28 / 꺼짐 0.45, 고정 0.36 (600ms), 해제 0.55 |
| 필터 | One Euro minCutoff 4, beta 0.6 |
| 손바닥 | 층 펼치기 0.5 이상 0.2초, 층 회전 시작 0.55 / 유지 0.35, 좌우 패널은 층 뒤 0.9초 |
| 손 동작 원칙 | 돌리기 = 편 손 좌우 (은하는 초기 화면에서만, 층은 펼쳐진 동안), 선택 = 핀치, 뒤로 = 주먹 |
| 주먹 | Closed_Fist ≥ 0.6, 600ms |
| 은하 | 반지름 4.6, 0.92바퀴, 회전 이득 3, 밝기 1 / 0.2 / 0.08 |
| 층 | L3 z 0.15 · L2 0.5 · L1 0.8 (L1이 가장 앞) |
| 장치 | 이 PC: CPU 59~84ms < GPU 126~149ms → CPU |
| 손 놓침 | 1000ms 후 마우스 |
