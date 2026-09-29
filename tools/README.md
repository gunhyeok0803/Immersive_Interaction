# tools — 데이터 준비 스크립트 (Node 18+, 외부 패키지 없음)

웹 앱이 읽는 `source/data/`를 미리 만듭니다. 번호 순서대로 실행합니다. 이미 만든 결과는 건너뛰고, `--force`면 다시 만듭니다.

| 순서 | 스크립트 | 하는 일 | AI 사용 |
| --- | --- | --- | --- |
| 1 | `fetch-papers.mjs <연구실 URL>` | 연구실 페이지의 DOI → OpenAlex 조회 → `papers.json` | 없음 |
| 2 | `fetch-related.mjs` | 논문마다 유사 논문 수집 (Semantic Scholar 추천 → Crossref 폴백) → `related-papers.json` | 없음 |
| 3 | `build-common-set.mjs [plan\|modules]` | 최근 논문 → 연구 주제 묶기(`common.json`, HUD 상단 덱) → 주제별 모듈 세트(`modules/`) | Codex CLI |
| 4 | `build-paper-packs.mjs [--foundations]` | 논문별 학습 팩 → `study/papers/` (3단계 모듈이 있어야 함). 지금은 5단계의 키워드 입력으로만 씀 | Codex CLI |
| 5 | `build-concept-graph.mjs [graph\|cards\|paths]` | 개념 그래프(`graph.json`) → 개념 카드(`concepts/`) → 논문별 학습 경로(`paths/`). 화면이 읽는 학습 내용 | Codex CLI |
| - | `capture-screens.mjs [--history]` | 발표용 화면 캡처 (헤드리스 Edge, 1600×900) → `evidence/screens/` | 없음 |

다른 교수님으로 바꾸려면 1~5를 새 URL로 다시 실행합니다.

## lib/

| 파일 | 내용 |
| --- | --- |
| `codex.mjs` | Codex CLI(`codex exec --output-schema`) 호출, 동시 실행, 사용 한도 감지. 기본 모델 `gpt-6-luna`·`max` |
| `common-prompts.mjs` | 공통 세트의 스키마·프롬프트 (주제 묶기, 모듈 세트) |
| `concept-prompts.mjs` | 개념 그래프·개념 카드·학습 경로의 스키마·프롬프트 (초록·논문 해설 금지 규칙 포함) |
| `paper-prompts.mjs` | 논문 팩의 스키마·프롬프트, 카드 스키마(공통) |

AI 생성은 API 키 없이 ChatGPT 로그인된 Codex CLI로 돌립니다. 모델·추론 단계는 `--model`/`--effort` 또는 `CODEX_MODEL`/`CODEX_EFFORT`로 바꿉니다.
