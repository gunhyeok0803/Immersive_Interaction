// /study 공통 코어: 논문 → OpenAI Responses API 요청 → 학습 팩 JSON
// 로컬 서버(study-server.mjs)와 Cloudflare Worker(worker/index.mjs)가 같이 씀. 의존성 없음(fetch).
// 설계 근거: docs/07-api-and-dev-plan.md §2.5, docs/01-topic-references.md §5 (Keshav 3-pass, 인출 연습, Bloom)

export const DEFAULT_MODEL = "gpt-5.6-terra";

const card = {
  type: "object", additionalProperties: false,
  required: ["title", "body", "discipline", "links_to_paper", "linked_keywords", "check", "next_resource"],
  properties: {
    title: { type: "string" },
    body: { type: "string", description: "5~8문장, 한국어" },
    discipline: { type: "string", enum: ["math", "physics_mechanics", "cs", "statistics", "signal_processing", "domain"] },
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

export const STUDY_PACK_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["pass1_overview", "keywords", "pass2_understanding", "layers", "pass3_reconstruct"],
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
            contributions: { type: "array", items: { type: "string" } }, clarity: { type: "string" },
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
        method_flow: { type: "array", items: { type: "string" } },
        key_evidence: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            required: ["claim", "evidence", "caveat"],
            properties: { claim: { type: "string" }, evidence: { type: "string" }, caveat: { type: "string" } },
          },
        },
        critical_questions: { type: "array", items: { type: "string" } },
      },
    },
    layers: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["level", "title", "cards"],
        properties: {
          level: { type: "string", enum: ["background", "applied", "foundation"] },
          title: { type: "string" },
          cards: { type: "array", items: card },
        },
      },
    },
    pass3_reconstruct: {
      type: "object", additionalProperties: false,
      required: ["restate_in_own_words_prompt", "assumptions_to_challenge", "to_reproduce_you_need"],
      properties: {
        restate_in_own_words_prompt: { type: "string" },
        assumptions_to_challenge: { type: "array", items: { type: "string" } },
        to_reproduce_you_need: { type: "array", items: { type: "string" } },
      },
    },
  },
};

export const STUDY_COACH_PROMPT = `너는 대학원 진학을 준비하는 학부생의 스터디 코치다. 모든 출력은 한국어로 쓴다(고유명사·약어는 원어 유지).
규칙:
1. 논문에 없는 내용을 지어내지 않는다. 초록만 있으면 초록 범위에서 쓰고, 확실하지 않은 수치·결과는 "초록에는 없음"이라고 쓴다.
2. 읽는 순서는 위에서 아래로(top-down): 1차 개요(5C) → 핵심 키워드 → 2차 이해(방법·근거·비판 질문) → 지식 층(배경 → 응용 → 기초과학) → 3차 재구성.
3. layers는 반드시 background, applied, foundation 순서로 3개. 층마다 카드 3~4개. 위 층을 읽으면 아래 층이 왜 필요한지 알 수 있게 쓴다.
4. foundation(기초과학) 층에는 이 논문이 기대는 물리·역학 원리(예: 강체 운동학, 압력중심과 무게중심, 진동·파동, 카메라 투영 기하, 전자기파 전파)가 해당되면 반드시 1개 이상 discipline=physics_mechanics 카드로 넣는다. 해당되지 않으면 math 또는 signal_processing으로 대체하고 그 이유를 links_to_paper에 적는다.
5. 각 카드의 check.question은 카드 본문만으로 답할 수 있어야 하고, bloom 단계를 표시한다. 층 안에서 remember/understand → apply/analyze 순으로 어려워지게 한다. if_wrong_go_to는 되돌아갈 카드 제목.
6. keywords는 5~8개. where_in_paper는 초록/방법/결과 중 하나.
7. 문장은 짧게. 카드 본문 5~8문장, 개요 문단 3~5문장.`;

// OpenAlex 초록 등 입력을 프롬프트 본문으로
export function buildUserContent({ title, venue, year, abstract, fulltext_excerpt, level = "undergraduate" }) {
  return [
    `수준: ${level}`,
    `제목: ${title}`,
    `학회/저널: ${venue || "(미상)"} · 연도: ${year ?? "(미상)"}`,
    `초록: ${abstract || "(초록 없음 — 제목·학회로만 추정하고, 추정임을 명시)"}`,
    `원문 발췌: ${fulltext_excerpt ? fulltext_excerpt.slice(0, 10000) : "(없음)"}`,
  ].join("\n");
}

// OpenAI Responses API 호출 (fetch). 반환: 파싱된 학습 팩 + usage
export async function generateStudyPack(paper, { apiKey, model = DEFAULT_MODEL, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY 없음");
  const body = {
    model,
    input: [
      { role: "system", content: STUDY_COACH_PROMPT },
      { role: "user", content: buildUserContent(paper) },
    ],
    text: { format: { type: "json_schema", name: "study_pack", schema: STUDY_PACK_SCHEMA, strict: true } },
  };
  const res = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const json = await res.json();
  // output_text 편의 필드가 없을 수 있으므로 output 배열에서 텍스트를 모음
  let text = json.output_text;
  if (!text) {
    text = (json.output ?? [])
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join("");
  }
  const pack = JSON.parse(text);
  return { pack, usage: json.usage ?? null, model: json.model ?? model, generated_at: new Date().toISOString() };
}

export function corsHeaders(origin, allowed) {
  const ok = !allowed || allowed === "*" || allowed.split(",").map((s) => s.trim()).includes(origin);
  return {
    "access-control-allow-origin": ok ? (origin || "*") : "null",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json; charset=utf-8",
  };
}
