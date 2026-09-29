// 공통 공부 세트 스키마·프롬프트 (build-common-set.mjs가 씀). 교수님 최근 논문(2023~2026)의 공통분모를 모듈로 묶고,
// 모듈마다 top-down(논문 키워드 → 사용 툴 → CS → 공학수학 → 역학 → 물리)으로 공부할 거리를 만든다.
// 피지컬 AI 동향은 기초 학습 밖의 "부록"으로 따로 만들고, 출처 URL이 있는 항목만 넣는다.

import { CARD_SCHEMA } from "./paper-prompts.mjs";

export const RECENT_FROM = 2023;
export const LAYER_ORDER = ["cs", "engineering_math", "mechanics", "physics"];

const slug = { type: "string", description: "영문 소문자·숫자·하이픈만 (예: xr-collab)" };

// 1단계: 최근 논문들을 4~6개 모듈로 묶기
export const PLAN_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["research_overview", "modules"],
  properties: {
    research_overview: { type: "string", description: "교수님 최근 연구 흐름 3~5문장" },
    modules: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "title", "summary", "paper_ids", "why_grouped"],
        properties: {
          id: slug, title: { type: "string" }, summary: { type: "string" },
          paper_ids: { type: "array", items: { type: "string" } },
          why_grouped: { type: "string" },
        },
      },
    },
  },
};

export const PLAN_PROMPT = `너는 연구실 진학을 준비하는 학부생의 스터디 설계자다. 한국어로 쓴다(고유명사·약어는 원어).
아래는 한 교수님의 최근(${RECENT_FROM}~) 논문 목록이다. 이 논문들을 공부할 때 공통으로 필요한 지식 묶음(모듈) 4~6개를 만든다.
규칙:
1. 모듈은 "주제 분류"가 아니라 "같은 기초·도구를 공유하는 논문 묶음"이다. 예: 카메라로 사람 움직임을 재는 논문들, XR 원격 협업 시스템 논문들.
2. 모든 논문은 1개 이상의 모듈에 들어간다. 한 논문이 두 모듈에 들어가도 된다.
3. paper_ids에는 목록에 있는 id만 쓴다. 지어내지 않는다.
4. research_overview는 교수님이 최근 어디에 집중하는지 3~5문장. 초록에 근거한다.`;

// 2단계: 모듈 하나의 공부 세트
export const MODULE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["intro", "roadmap", "keywords", "tools", "layers"],
  properties: {
    intro: { type: "string", description: "이 모듈을 공부하면 어떤 논문들이 읽히는지 3~4문장" },
    roadmap: { type: "array", items: { type: "string" }, description: "공부 순서 요약 4~6단계" },
    keywords: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["term", "definition_one_line", "appears_in"],
        properties: { term: { type: "string" }, definition_one_line: { type: "string" }, appears_in: { type: "array", items: { type: "string" } } },
      },
    },
    tools: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "category", "what_for", "used_in", "evidence", "first_step"],
        properties: {
          name: { type: "string" },
          category: { type: "string", enum: ["library", "framework", "engine", "hardware", "sensor", "dataset", "platform", "method"] },
          what_for: { type: "string" },
          used_in: { type: "array", items: { type: "string" } },
          evidence: { type: "string", enum: ["abstract", "inferred"], description: "초록에 이름이 나오면 abstract, 아니면 inferred" },
          first_step: { type: "string", description: "처음 해 볼 것 한 줄" },
        },
      },
    },
    layers: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["level", "title", "cards"],
        properties: {
          level: { type: "string", enum: LAYER_ORDER },
          title: { type: "string" },
          cards: { type: "array", items: CARD_SCHEMA },
        },
      },
    },
  },
};

export const MODULE_PROMPT = `너는 대학원 진학을 준비하는 학부생의 스터디 코치다. 한국어로 쓴다(고유명사·약어는 원어).
아래 모듈에 속한 교수님 논문들을 읽기 위한 "공통 공부 세트"를 만든다. 논문 하나가 아니라 묶음 전체에 쓰이는 지식만 넣는다.
읽는 순서는 위에서 아래로(top-down): 논문 키워드 → 사용 툴 → CS → 공학수학 → 역학 → 물리. 위를 읽으면 아래가 왜 필요한지 보이게 쓴다.
규칙:
1. 논문에 없는 내용을 지어내지 않는다. 초록에 근거하고, 확실하지 않으면 "초록에는 없음"이라고 쓴다.
2. keywords 6~10개. appears_in에는 이 모듈의 논문 id만 쓴다.
3. tools 3~6개. 초록에 이름이 나온 것은 evidence=abstract. 초록에 없지만 이런 연구에 보통 쓰이는 것은 evidence=inferred로 표시한다(inferred는 절반 이하).
4. layers는 정확히 4개, 순서는 cs → engineering_math → mechanics → physics. 층마다 카드 2~3개. 카드의 discipline은 층과 같게 쓴다(cs→cs, engineering_math→engineering_math, mechanics→mechanics, physics→physics).
5. 역학·물리 층도 반드시 채운다. 모듈이 직접 기대지 않으면 장치·센서·환경에 숨은 가장 가까운 원리를 고르고 links_to_paper에 연결을 구체적으로 적는다. 억지 연결이면 "간접 연결"이라고 밝힌다.
6. links_to_paper에는 어느 논문(제목 일부)의 무엇과 이어지는지 쓴다.
7. check.question은 카드 본문만으로 답할 수 있어야 한다. 층 안에서 remember/understand → apply/analyze 순. if_wrong_go_to는 되돌아갈 카드 제목.
8. 카드 본문 5~8문장, 짧은 문장.`;
