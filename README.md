# source — 웹 앱 (정적 사이트 루트)

브라우저에서 여는 A-Frame 앱입니다. 서버 코드는 없고, 학습 내용은 `tools/`가 미리 만든 JSON을 읽습니다.

- 로컬 실행: `npx serve -l 5173 source` → <http://localhost:5173> (웹캠은 HTTPS 또는 localhost에서만 열림)
- 온라인: <https://gunhyeok0803.github.io/Immersive_Interaction/> (`gh-pages` 브랜치 = 이 폴더)

## 조작 (웹캠 손 하나, 손이 안 잡히면 마우스)

원칙: 돌리기 = 편 손 좌우, 선택 = 핀치, 뒤로 = 주먹.

| 손 동작 | 결과 | 마우스·키보드 대체 |
| --- | --- | --- |
| 편 손 좌우 (첫 화면, 빈 공간에서) | 논문 은하가 돌아 앞의 조준 카드에 다른 논문 | 휠, ←/→ |
| 조준 카드 핀치 | 그 논문 선택 (빛줄기) | 클릭 |
| 논문 고른 뒤 손바닥 펴기 | 학습 경로가 연구 기법 · 전공 · 기초 층으로 펼쳐지고, 이어서 좌우 패널 4장 | 선택된 카드 한 번 더 클릭 |
| 층이 펼쳐진 뒤 편 손 좌우 | 층 구조 회전 | — |
| 패널·개념 노드·버튼 핀치 | 상세 창 (개념마다 6단계: 왜 → 직관 → 정의·식/구조 → 핵심 → 풀어 보기 → 연결) | 클릭 |
| 주먹 0.6초 | 한 단계 뒤로 (층 → 패널 → 논문 선택 해제) | Esc |

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `index.html` | 장면 선언(A-Frame 엔티티·컴포넌트), 상세 창(스크롤 없이 단계별), 커서 옆 이름표, 손 뼈대 표시, 진단 칸, 손 핀치로 HTML 버튼 누르기 |
| `js/hand-cursor.js` | `hand-cursor`: 웹캠 손 추적(MediaPipe Gesture Recognizer, 한 손) → 커서·핀치·편 손·주먹, 핀치 직전 커서 고정, 가림막(`.blocker`) 판정. `press-feedback`: 누른 순간 대상이 번쩍. 추론 장치(GPU/CPU) 자동 선택 |
| `js/hud.js` | `hud`: 논문 패널 4장, 상세 창의 학습 단계, 논문 로드, 손바닥 펴기 → 층 → 패널 순서, 은하는 첫 화면에서만 돌게 |
| `js/paper-galaxy.js` | `paper-galaxy`: 3D 코어 = 논문 44편의 은하(연도 = 나선, 주변 점 = 개념)와 조준 카드 |
| `js/concept-stack.js` | `concept-stack`(층 구조, 펼치기·편 손 회전) · `stack-layer`(층) · `concept-node`(개념) |
| `js/study-panel.js` | 개념 그래프·카드·학습 경로 읽기 + 상세 창 HTML |
| `serve.json` | 로컬 서버 캐시 끄기 |

## data/

| 파일 | 내용 | 만드는 스크립트 |
| --- | --- | --- |
| `papers.json` | 교수님 논문 44편 (연구실 페이지 DOI → OpenAlex) | `tools/fetch-papers.mjs` |
| `related-papers.json` | 논문마다 웹 유사 논문 5편 (논문 DB) | `tools/fetch-related.mjs` |
| `study/graph.json` | 개념 그래프: 개념 90개(L1 기초 · L2 전공 · L3 연구 기법)와 선수 관계 | `tools/build-concept-graph.mjs graph` |
| `study/concepts/<id>.json` | 개념 카드: 직관·정의·식(필요할 때만)·구조·핵심·연습 문제·코드(필요할 때만)·참고 자료 | `tools/build-concept-graph.mjs cards` |
| `study/paths/<paperId>.json` | 논문 요약 + 이 논문을 읽기 위한 개념 학습 경로 | `tools/build-concept-graph.mjs paths` |
| `study/common.json`, `study/modules/`, `study/papers/` | 이전 단계의 생성물. 화면에선 쓰지 않고, 개념 그래프를 만들 때 논문 키워드(방법 힌트)의 입력 기록 | `tools/build-common-set.mjs`, `tools/build-paper-packs.mjs` |
