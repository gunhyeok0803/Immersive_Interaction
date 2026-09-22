// Cloudflare Worker: POST /study → OpenAI 학습 팩. KV 캐시(STUDY_KV 바인딩이 있으면).
// 배포: worker/ 에서 `npx wrangler deploy` (wrangler.toml 참고). 시크릿: `npx wrangler secret put OPENAI_API_KEY`
// 로컬 서버(tools/study-server.mjs)와 같은 코어를 씀.
import { generateStudyPack, corsHeaders, DEFAULT_MODEL } from "../tools/study-core.mjs";

export default {
  async fetch(req, env) {
    const headers = corsHeaders(req.headers.get("origin"), env.ALLOWED_ORIGIN || "*");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, hasKey: !!env.OPENAI_API_KEY }), { headers });
    }
    if (req.method === "POST" && url.pathname === "/study") {
      try {
        const body = await req.json();
        const id = String(body.paperId || "").replace(/[^A-Za-z0-9_-]/g, "");
        if (!id || !body.title) return new Response(JSON.stringify({ error: "paperId, title 필요" }), { status: 400, headers });
        const key = `study:${id}`;
        if (env.STUDY_KV && !body.force) {
          const cached = await env.STUDY_KV.get(key);
          if (cached) return new Response(cached, { headers });
        }
        if (!env.OPENAI_API_KEY) return new Response(JSON.stringify({ error: "OPENAI_API_KEY 시크릿 없음" }), { status: 503, headers });
        const out = await generateStudyPack(body, { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || DEFAULT_MODEL });
        const record = JSON.stringify({ paperId: id, title: body.title, ...out });
        if (env.STUDY_KV) await env.STUDY_KV.put(key, record, { expirationTtl: 60 * 60 * 24 * 30 });
        return new Response(record, { headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers });
  },
};
