// 개념 지식 그래프의 스키마·프롬프트 (build-concept-graph.mjs가 씀). 2026-09-29 사용자와 정한 사양:
//  - 학습 단위는 논문이 아니라 "개념". 연구실 논문 전체에 필요한 개념을 학부 1~2학년 기초부터 쌓아 올린다
//  - 개념끼리는 선수 지식(prerequisites)으로 잇고, 응용(어디에 쓰이는지)은 그 역방향으로 계산한다
//  - 개념 카드 = 직관 + 정의 + 핵심 식, 연습 문제 + 풀이, 코드 예시 + 참고 자료
//  - 논문은 입구: 논문을 고르면 "이 논문을 읽으려면 이 순서로" 개념 경로가 켜진다
// 이전 학습 팩의 문제(사용자 지적): 지식 대신 "초록에는 ~라고 되어 있다" 같은 논문 해설을 썼고, 개념끼리 이어지지 않았음.
// 그래서 여기서는 개념 카드에서 논문·초록 이야기를 금지하고, 교과서처럼 개념 자체를 가르치게 한다.

export const FIELDS = ["math", "physics", "mechanics", "signal", "cs", "ml", "vision", "graphics", "hci", "systems", "stats"];
export const FIELD_NAME = { math: "수학", physics: "물리", mechanics: "역학", signal: "신호처리", cs: "컴퓨터과학", ml: "기계학습", vision: "컴퓨터비전", graphics: "그래픽스", hci: "HCI", systems: "시스템", stats: "통계" };
const slug = { type: "string", description: "영문 소문자·숫자·하이픈 (예: fourier-transform)" };

// 1) 개념 그래프: 이름·수준·분야·선수 개념
export const GRAPH_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["concepts"],
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "name", "english", "level", "field", "one_line", "prerequisites"],
        properties: {
          id: slug,
          name: { type: "string", description: "한국어 이름 (짧게)" },
          english: { type: "string", description: "영어 용어" },
          level: { type: "integer", enum: [1, 2, 3], description: "1 = 학부 1~2학년 기초, 2 = 전공 핵심, 3 = 연구 기법" },
          field: { type: "string", enum: FIELDS },
          one_line: { type: "string", description: "이 개념이 무엇인지 한 문장 (논문 이야기 없이)" },
          prerequisites: { type: "array", items: slug, description: "이 개념을 이해하기 전에 알아야 할 개념 id (목록 안의 것만)" },
        },
      },
    },
  },
};

export const GRAPH_PROMPT = `너는 공과대학 교육과정 설계자다. 한국어로 쓴다(용어는 영어 병기).
아래는 한 연구실의 논문 목록이다. 이 연구실의 연구를 이해하는 데 필요한 지식을 "개념 그래프"로 설계한다.
목표: 학부 1~2학년(미적분·선형대수·일반물리·프로그래밍 기초만 아는 학생)이 이 그래프를 아래에서 위로 공부하면 이 연구실 논문들을 읽을 수 있게 되는 것.
규칙:
1. 개념은 70~90개. 수준 1(학부 1~2학년 기초: 미적분·선형대수·확률·일반물리·프로그래밍의 필요한 부분), 수준 2(전공 핵심: 신호처리·동역학·컴퓨터비전·기계학습·그래픽스·HCI 방법론 등), 수준 3(이 연구실이 직접 쓰는 연구 기법).
2. 한 개념 = 한 번에 공부할 수 있는 크기. "선형대수"처럼 과목 전체가 아니라 "고유값과 고유벡터"처럼 쪼갠다.
3. prerequisites는 "이것을 모르면 이 개념을 이해할 수 없는" 직접 선수 개념만 1~4개. 목록 안의 id만 쓴다. 순환이 없어야 한다. 수준 1 개념도 다른 수준 1 개념을 선수로 가질 수 있다.
4. 수준 3 개념은 반드시 수준 2 개념을 선수로 가진다. 수준 2 개념은 수준 1 개념을 선수로 가진다. 모든 개념이 결국 수준 1까지 이어져야 한다.
5. 논문 목록에 나오는 방법·측정·분석을 빠짐없이 덮는다 (영상·음성·무선·생체 신호 측정, 희소 관측 복원, 카메라 기하·3D 복원·렌더링, 사용자 실험·통계, 네트워크·데이터 시스템 등).
6. one_line은 개념 자체의 설명이다. "논문", "초록", "이 연구는" 같은 말을 쓰지 않는다.`;

// 2) 개념 카드: 여러 개를 한 번에
// 2026-09-30 사용자 지적 "네트워크 같은 건 식이 아니라 실제 개념이 중요한데 너무 획일화됐다" → 식·코드는 필요할 때만(null 허용),
// 식이 없는 개념은 structure(구성 요소·관계·동작 흐름)로 설명, 문제는 계산(calc)과 보기 고르기(choice)로 나눔
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const CARD = {
  type: "object", additionalProperties: false,
  required: ["id", "intuition", "definition", "formula", "structure", "key_points", "practice", "code", "references", "used_in_lab"],
  properties: {
    id: slug,
    intuition: { type: "string", description: "왜 이 개념이 필요한지, 머릿속 그림 3~5문장" },
    definition: { type: "string", description: "정확한 정의 2~4문장" },
    formula: nullable({
      type: "object", additionalProperties: false,
      required: ["latex", "symbols", "reading"],
      properties: {
        latex: { type: "string", description: "대표 식 하나. KaTeX 문법, $ 없이" },
        symbols: { type: "array", items: { type: "object", additionalProperties: false, required: ["symbol", "meaning"], properties: { symbol: { type: "string" }, meaning: { type: "string", description: "뜻과 단위" } } } },
        reading: { type: "string", description: "이 식을 말로 읽으면 무엇을 뜻하는지 1~2문장" },
      },
    }),
    structure: nullable({
      type: "object", additionalProperties: false,
      required: ["parts", "flow"],
      properties: {
        parts: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "role"], properties: { name: { type: "string" }, role: { type: "string", description: "이 구성 요소가 하는 일 한 문장" } } }, description: "구성 요소 3~6개" },
        flow: { type: "string", description: "구성 요소들이 어떤 순서·관계로 동작하는지 3~5문장. 구체적인 예를 따라가며" },
      },
    }),
    key_points: { type: "array", items: { type: "string" }, description: "꼭 기억할 점 3~5개, 흔한 오해 포함" },
    practice: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["kind", "question", "choices", "answer", "solution"],
        properties: {
          kind: { type: "string", enum: ["calc", "choice"], description: "calc = 스스로 계산·서술한 뒤 풀이 확인, choice = 보기 중 하나 고르기" },
          question: { type: "string" },
          choices: { type: "array", items: { type: "string" }, description: "choice면 보기 3~4개, calc면 빈 배열" },
          answer: { type: "integer", description: "choice면 정답 보기 번호(0부터), calc면 -1" },
          solution: { type: "string", description: "calc: 풀이 과정과 답. choice: 왜 정답인지 + 나머지 보기가 왜 틀렸는지" },
        },
      },
      description: "연습 문제 2~3개. 쉬운 것부터",
    },
    code: nullable({
      type: "object", additionalProperties: false,
      required: ["snippet", "what_it_shows"],
      properties: {
        snippet: { type: "string", description: "Python 3 + numpy(필요하면 matplotlib·scipy)만 쓰는 25줄 이하 예시. 복사해 실행 가능하게" },
        what_it_shows: { type: "string", description: "이 코드를 돌리면 무엇을 확인할 수 있는지 1~2문장" },
      },
    }),
    references: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["title", "source", "where"], properties: { title: { type: "string" }, source: { type: "string", description: "저자 또는 기관" }, where: { type: "string", description: "장·절 또는 강의 회차" } } },
      description: "실제로 있는 유명 교재·공개 강의 1~3개 (URL 없이)",
    },
    used_in_lab: { type: "string", description: "이 연구실 연구에서 이 개념이 하는 일 한 문장 (예: 걸음걸이 영상에서 몸통 움직임을 추정할 때 쓴다). '초록'·'논문에 명시' 같은 말 금지" },
  },
};
export const CARDS_SCHEMA = { type: "object", additionalProperties: false, required: ["cards"], properties: { cards: { type: "array", items: CARD } } };

export const CARDS_PROMPT = `너는 좋은 공대 교과서를 쓰는 저자다. 한국어로 쓴다(용어는 영어 병기).
아래 개념들 각각에 대해 학부 1~2학년이 혼자 공부할 수 있는 개념 카드를 쓴다.
규칙:
1. 개념 자체를 가르친다. 논문·초록·"이 연구는" 이야기를 하지 않는다. (연구실과의 관계는 used_in_lab 한 문장에만)
2. 선수 개념은 이미 공부했다고 보고, 그 위에 쌓는다. 선수 개념의 이름을 설명 안에서 자연스럽게 언급해 연결을 보여 준다.
3. intuition은 비유나 그림으로 "왜 필요한가"부터. definition은 정확하게. 문장은 짧게.
4. 모든 개념을 같은 틀에 맞추지 않는다. 그 개념을 이해하는 데 무엇이 핵심인지 먼저 판단한다.
   - formula: 식을 알아야만 이해·계산할 수 있는 개념에만 쓴다 (예: 푸리에 변환, 광학 흐름, 고유값, 열전달). 교과서 표준 식, KaTeX LaTeX만, $ 없이, 기호마다 뜻과 단위.
     식이 핵심이 아니면 null. 식을 억지로 만들지 않는다 (나쁜 예: decode(encode(x))=x, D_{k+1}=f_k(D_k), 성공률 = 성공/N×100%).
   - structure: 구성 요소·관계·동작 흐름이 핵심인 개념에 쓴다 (예: 네트워크 통신 계층, 웹 XR 표준의 구성, 점군과 메시의 차이, 사용자 실험 설계 절차).
     구체적인 예를 따라가며 흐름을 설명한다. 식이 핵심인 개념이면 null이어도 된다. 둘 다 필요하면 둘 다 쓴다. 둘 다 null은 안 된다.
5. 연습 문제 2~3개는 개념의 성격에 맞게 고른다. 카드 내용만으로 풀 수 있어야 한다.
   - calc: 계산이나 짧은 서술. 숫자를 넣고, solution에 풀이 과정과 답. choices는 [], answer는 -1.
   - choice: 상황 판단("이 상황에서 무엇을 쓰는가"), 비교("A와 B의 차이"), 절차("올바른 순서" 또는 "잘못된 단계 찾기"). 보기 3~4개, 정답 하나, 그럴듯한 오답.
     solution에 왜 정답인지와 각 오답이 왜 틀렸는지.
   - formula가 있는 개념은 calc를 1개 이상. formula가 없는 개념은 choice 위주 (억지 계산 문제 금지).
6. code: 직접 돌려 보면 이해가 깊어지는 개념에만 (numpy 중심, 25줄 이하, 그대로 실행, 결과를 print나 그래프로). 아니면 null.
7. 참고 자료는 실제로 존재하는 유명 교재·공개 강의만 (예: Oppenheim "Signals and Systems", Szeliski "Computer Vision: Algorithms and Applications", MIT OCW 18.06). 모르면 적게 쓴다. 지어내지 않는다.`;

// 3) 논문 → 학습 경로
export const PATH_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["papers"],
  properties: {
    papers: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["paper_id", "summary", "core", "path"],
        properties: {
          paper_id: { type: "string" },
          summary: { type: "string", description: "이 논문이 무엇을 어떻게 풀었는지 2~3문장. '초록에는' 같은 말 금지" },
          core: { type: "array", items: slug, description: "이 논문의 중심 개념 id 1~3개 (주로 수준 3)" },
          path: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["concept", "role"], properties: { concept: slug, role: { type: "string", description: "이 논문에서 이 개념이 맡는 역할 한 문장" } } },
            description: "이 논문을 읽기 위해 공부할 개념 6~12개, 기초(수준 1)부터 중심 개념까지 공부 순서대로",
          },
        },
      },
    },
  },
};

export const PATH_PROMPT = `너는 학부생의 논문 읽기 지도교수다. 한국어로 쓴다.
아래 개념 그래프(id · 이름 · 수준 · 선수 개념)와 논문들을 보고, 논문마다 "이 논문을 읽으려면 이 순서로 공부하라"는 경로를 만든다.
규칙:
1. path의 개념은 그래프 id만 쓴다. 기초(수준 1)부터 시작해 중심 개념(core)에서 끝나는 공부 순서. 선수 개념이 뒤 개념보다 앞에 오게 한다.
2. role은 이 논문 안에서 그 개념이 하는 일 한 문장. 구체적으로 (예: "발 압력 중심의 흔들림을 주파수 성분으로 나눠 비교한다").
3. summary는 무엇을 어떻게 풀었는지. "초록", "명시", "이 논문은 ~라고 한다" 같은 해설조 표현을 쓰지 않는다.
4. 제목·초록에서 짐작할 수 있는 범위 안에서 쓰되, 모르는 수치는 쓰지 않는다.`;
