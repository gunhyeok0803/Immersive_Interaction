// 논문별 학습 팩의 스키마·프롬프트 (build-paper-packs.mjs가 씀). 카드 스키마는 공통 세트(common-prompts.mjs)와 공유.
// 기초 지식(CS·공학수학·역학·물리)과 툴은 공통 세트 모듈이 맡고, 논문 팩은 이 논문만의 내용 + "먼저 볼 모듈" 링크.
// 설계 근거: docs/01-topic-references.md §5 (Keshav 3-pass, 인출 연습, Bloom)

export const CARD_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "body", "discipline", "links_to_paper", "linked_keywords", "check", "next_resource"],
  properties: {
    title: { type: "string" },
    body: { type: "string", description: "5~8문장, 한국어" },
    discipline: { type: "string", enum: ["physics", "mechanics", "engineering_math", "math", "cs", "statistics", "signal_processing", "domain"] },
    links_to_paper: { type: "string", description: "논문의 어느 식·그림·문장과 이어지는지" },
    linked_keywords: { type: "array", items: { type: "string" } },
    check: {
      type: "object", additionalProperties: false,
      required: ["bloom", "question", "answer", "if_wrong_go_to"],
      properties: {
        bloom: { type: "string", enum: ["remember", "understand", "apply", "analyze"] },
        question: { type: "string" }, answer: { type: "string" }, if_wrong_go_to: { type: "string" },
      },
    },
    next_resource: { type: "string" },
  },
};

const strList = { type: "array", items: { type: "string" } };

// 논문별 "이 분야 공부하기" (학습 top-down: 논문 주제 → 필요한 기초로 내려감)
//   foundations: 공학수학·역학·물리(표준 수식 포함) + CS 지식, 각 1개
//   tools: 이 논문 분야에서 쓰는 도구와 처음 써 볼 방법
export const FOUNDATION_LEVELS = ["engineering_math", "mechanics", "physics", "cs"];
export const FOUNDATIONS_SCHEMA = {
  type: "array",
  items: {
    type: "object", additionalProperties: false,
    required: ["discipline", "concept", "explain", "equation", "link_to_paper", "evidence", "check", "module_card"],
    properties: {
      discipline: { type: "string", enum: FOUNDATION_LEVELS },
      concept: { type: "string", description: "개념 이름" },
      explain: { type: "string", description: "개념 설명 3~5문장" },
      equation: {
        type: "object", additionalProperties: false,
        required: ["latex", "variables"],
        properties: {
          latex: { type: "string", description: "교과서 표준 식 하나. KaTeX로 렌더되는 LaTeX만 ($ 없이). cs는 필요 없으면 빈 문자열" },
          variables: {
            type: "array",
            items: {
              type: "object", additionalProperties: false,
              required: ["symbol", "meaning"],
              properties: { symbol: { type: "string", description: "LaTeX 기호 ($ 없이)" }, meaning: { type: "string", description: "뜻과 단위" } },
            },
          },
        },
      },
      link_to_paper: { type: "string", description: "이 개념이 이 논문 주제의 어디에 쓰이는지, 왜 알아야 하는지 2~3문장" },
      evidence: { type: "string", enum: ["abstract", "inferred"], description: "초록에 이 개념이 직접 나오면 abstract, 논문의 장치·데이터·환경에서 추정했으면 inferred" },
      check: {
        type: "object", additionalProperties: false,
        required: ["question", "answer"],
        properties: {
          question: { type: "string", description: "식에 값을 넣어 계산하거나 논문 상황에 적용하는 문제" },
          answer: { type: "string", description: "풀이 과정 포함 정답" },
        },
      },
      module_card: { type: "string", description: "같은 개념을 다루는 공통 모듈 카드 제목. 없으면 빈 문자열" },
    },
  },
};

export const TOOLS_SCHEMA = {
  type: "array",
  items: {
    type: "object", additionalProperties: false,
    required: ["name", "category", "what_for", "link_to_paper", "evidence", "first_step"],
    properties: {
      name: { type: "string" },
      category: { type: "string", enum: ["library", "framework", "engine", "hardware", "sensor", "dataset", "platform", "method"] },
      what_for: { type: "string", description: "이 도구가 하는 일 1문장" },
      link_to_paper: { type: "string", description: "이 논문 주제에서 어디에 쓰이는지 1문장" },
      evidence: { type: "string", enum: ["abstract", "inferred"], description: "초록에 이름이 나오면 abstract, 이 분야에서 보통 쓰는 도구면 inferred" },
      first_step: { type: "string", description: "학부생이 처음 해 볼 것 한 줄 (설치·예제·튜토리얼 수준)" },
    },
  },
};

export const FOUNDATION_PROMPT = `너는 대학원 진학을 준비하는 학부생의 스터디 코치다. 한국어로 쓴다(고유명사·약어는 원어).
목표: 이 논문 한 편을 계기로 "이 분야를 공부한다"는 느낌이 들게, 논문 주제(위)에서 필요한 기초(아래)로 내려가는 학습 세트를 만든다.
foundations는 공학수학(engineering_math), 역학(mechanics), 물리(physics), CS(cs)에서 각각 정확히 1개씩, 이 순서로.
tools는 이 논문 분야에서 쓰는 도구 3~5개.
규칙:
1. 식은 교과서에 나오는 표준 식만 쓴다. 논문 속 식이라고 주장하지 않는다. 식을 지어내지 않는다.
2. 공학수학·역학·물리는 반드시 식 하나를 넣는다. cs는 핵심 식(손실 함수, 복잡도 등)이 있으면 넣고 없으면 latex를 빈 문자열, variables를 빈 배열로 둔다.
3. latex는 KaTeX로 렌더되는 문법만, $ 기호 없이. 기호마다 뜻과 단위를 variables에 적는다.
4. link_to_paper는 "이 개념이 이 논문 주제의 어디에 쓰이는지, 왜 알아야 하는지"를 쓴다. 논문 속 세부 식·수치를 안다고 가정하지 않는다.
5. 초록에 그 개념이 직접 드러나면 evidence=abstract, 논문의 장치·센서·데이터·환경에서 추정했으면 evidence=inferred. 억지 연결이면 link_to_paper에 "간접 연결"이라고 밝힌다.
6. check.question은 식에 값을 넣어 계산하거나 논문 상황에 적용해 보는 문제. answer에는 풀이 과정을 쓴다. 예시 값은 논문 측정값이 아니라고 밝힌다.
7. 아래 공통 모듈 카드 중 같은 개념이 있으면 그 제목을 module_card에 그대로, 없으면 빈 문자열.
8. tools는 초록에 이름이 나오면 evidence=abstract, 이 분야에서 보통 쓰는 도구면 inferred. first_step은 실제로 해 볼 수 있는 한 줄.
9. 문장은 짧게.`;

// module_id는 실제 모듈 id만 나오도록 enum으로 묶는다
export function paperPackSchema(moduleIds) {
  return {
    type: "object", additionalProperties: false,
    required: ["pass1_overview", "keywords", "pass2_understanding", "foundations", "tools", "module_refs", "pass3_reconstruct"],
    properties: {
      foundations: FOUNDATIONS_SCHEMA,
      tools: TOOLS_SCHEMA,
      pass1_overview: {
        type: "object", additionalProperties: false,
        required: ["one_paragraph", "five_c", "reading_goal"],
        properties: {
          one_paragraph: { type: "string" },
          five_c: {
            type: "object", additionalProperties: false,
            required: ["category", "context", "correctness", "contributions", "clarity"],
            properties: {
              category: { type: "string" }, context: { type: "string" }, correctness: { type: "string" },
              contributions: strList, clarity: { type: "string" },
            },
          },
          reading_goal: { type: "string" },
        },
      },
      keywords: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["term", "definition_one_line", "where_in_paper"],
          properties: { term: { type: "string" }, definition_one_line: { type: "string" }, where_in_paper: { type: "string" } },
        },
      },
      pass2_understanding: {
        type: "object", additionalProperties: false,
        required: ["method_flow", "key_evidence", "critical_questions"],
        properties: {
          method_flow: strList,
          key_evidence: {
            type: "array",
            items: {
              type: "object", additionalProperties: false,
              required: ["claim", "evidence", "caveat"],
              properties: { claim: { type: "string" }, evidence: { type: "string" }, caveat: { type: "string" } },
            },
          },
          critical_questions: strList,
        },
      },
      module_refs: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["module_id", "why", "focus_cards"],
          properties: {
            module_id: { type: "string", enum: moduleIds },
            why: { type: "string", description: "이 논문을 읽는 데 이 모듈이 왜 필요한지 1~2문장" },
            focus_cards: { ...strList, description: "그 모듈에서 먼저 볼 카드 제목(목록에 있는 것만)" },
          },
        },
      },
      pass3_reconstruct: {
        type: "object", additionalProperties: false,
        required: ["restate_in_own_words_prompt", "assumptions_to_challenge", "to_reproduce_you_need"],
        properties: {
          restate_in_own_words_prompt: { type: "string" },
          assumptions_to_challenge: strList,
          to_reproduce_you_need: strList,
        },
      },
    },
  };
}

export const PAPER_PACK_PROMPT = `너는 대학원 진학을 준비하는 학부생의 스터디 코치다. 모든 출력은 한국어로 쓴다(고유명사·약어는 원어 유지).
기초 지식(CS·공학수학·역학·물리)과 사용 툴은 "공통 공부 세트" 모듈에 이미 있다. 이 팩에는 이 논문만의 내용을 쓰고, 기초는 모듈로 연결한다.
규칙:
1. 논문에 없는 내용을 지어내지 않는다. 초록만 있으면 초록 범위에서 쓰고, 확실하지 않은 수치·결과는 "초록에는 없음"이라고 쓴다.
2. 순서: 1차 개요(5C) → 핵심 키워드 → 2차 이해(방법·근거·비판 질문) → 기초과학·CS(foundations) → 사용 툴(tools) → 먼저 볼 공통 모듈 → 3차 재구성. foundations와 tools는 아래 [기초과학 규칙]을 따른다.
3. pass1_overview.one_paragraph는 책을 펼쳤을 때 요약으로도 쓰인다. 3~5문장, 무엇을·어떻게·무엇을 보였는지.
4. keywords는 5~8개. where_in_paper는 초록/방법/결과 중 하나. 모듈 키워드와 겹쳐도 이 논문에서의 의미로 쓴다.
5. module_refs는 1~2개. 아래 모듈 목록의 id만 쓰고, focus_cards에는 그 모듈의 카드 제목을 그대로 1~3개 고른다.
6. 문장은 짧게.

[기초과학 규칙]
${FOUNDATION_PROMPT.split("\n").slice(1).join("\n")}`;

// 공통 모듈 목록(층별 카드 제목까지)을 프롬프트에 넣을 텍스트로
export function modulesDigest(modules) {
  return modules.map((m) => [
    `- id=${m.id} · ${m.title}: ${m.summary}`,
    ...(m.pack?.layers ?? []).map((l) => `    [${l.level}] ${l.cards.map((c) => c.title).join(" / ")}`),
  ].join("\n")).join("\n");
}

// papers.json 항목 → 프롬프트 본문
export function paperInput({ title, venue, year, abstract }) {
  return [
    "수준: 학부생",
    `제목: ${title}`,
    `학회/저널: ${venue || "(미상)"} · 연도: ${year ?? "(미상)"}`,
    `초록: ${abstract || "(초록 없음 — 제목·학회로만 추정하고, 추정임을 명시)"}`,
  ].join("\n");
}
