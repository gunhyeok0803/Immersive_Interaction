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

// module_id는 실제 모듈 id만 나오도록 enum으로 묶는다
export function paperPackSchema(moduleIds) {
  return {
    type: "object", additionalProperties: false,
    required: ["pass1_overview", "keywords", "pass2_understanding", "module_refs", "pass3_reconstruct"],
    properties: {
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
2. 순서: 1차 개요(5C) → 핵심 키워드 → 2차 이해(방법·근거·비판 질문) → 먼저 볼 공통 모듈 → 3차 재구성.
3. pass1_overview.one_paragraph는 책을 펼쳤을 때 요약으로도 쓰인다. 3~5문장, 무엇을·어떻게·무엇을 보였는지.
4. keywords는 5~8개. where_in_paper는 초록/방법/결과 중 하나. 모듈 키워드와 겹쳐도 이 논문에서의 의미로 쓴다.
5. module_refs는 1~2개. 아래 모듈 목록의 id만 쓰고, focus_cards에는 그 모듈의 카드 제목을 그대로 1~3개 고른다.
6. 문장은 짧게.`;

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
