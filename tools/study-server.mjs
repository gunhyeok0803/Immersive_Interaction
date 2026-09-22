// 로컬 /study 서버 (D6). 사용: node tools/study-server.mjs   (기본 포트 8787)
// 키: 프로젝트 루트 .env 의 OPENAI_API_KEY=...  또는 환경변수. .env는 .gitignore에 있음.
// 결과는 src/data/study/<paperId>.json 에 저장 → 정적 사이트가 서버 없이도 읽을 수 있음 (시연 폴백).

import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateStudyPack, corsHeaders, DEFAULT_MODEL } from "./study-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, "src", "data", "study");
const PORT = Number(process.env.PORT || 8787);

async function loadEnv() {
  const p = path.join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of (await readFile(p, "utf8")).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 200000) reject(new Error("body too large")); });
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

await loadEnv();
await mkdir(CACHE_DIR, { recursive: true });
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
if (!apiKey) console.warn("경고: OPENAI_API_KEY 가 없습니다. .env 에 넣어 주세요. 캐시된 팩만 제공합니다.");

let inflight = 0;
http.createServer(async (req, res) => {
  const headers = corsHeaders(req.headers.origin, process.env.ALLOWED_ORIGIN || "*");
  if (req.method === "OPTIONS") { res.writeHead(204, headers); return res.end(); }
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, headers); return res.end(JSON.stringify({ ok: true, hasKey: !!apiKey, model }));
  }

  if (req.method === "POST" && url.pathname === "/study") {
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      const id = String(body.paperId || "").replace(/[^A-Za-z0-9_-]/g, "");
      if (!id || !body.title) { res.writeHead(400, headers); return res.end(JSON.stringify({ error: "paperId, title 필요" })); }
      const cachePath = path.join(CACHE_DIR, `${id}.json`);
      if (!body.force && existsSync(cachePath)) {
        res.writeHead(200, headers); return res.end(await readFile(cachePath, "utf8"));
      }
      if (!apiKey) { res.writeHead(503, headers); return res.end(JSON.stringify({ error: "서버에 OPENAI_API_KEY 없음" })); }
      if (inflight >= 2) { res.writeHead(429, headers); return res.end(JSON.stringify({ error: "동시 요청 제한" })); }
      inflight++;
      const t0 = Date.now();
      console.log(`[study] ${id} ${body.title.slice(0, 50)} …`);
      let out;
      try { out = await generateStudyPack(body, { apiKey, model }); } finally { inflight--; }
      const record = { paperId: id, title: body.title, ...out };
      await writeFile(cachePath, JSON.stringify(record, null, 2), "utf8");
      console.log(`[study] ${id} 완료 ${((Date.now() - t0) / 1000).toFixed(1)}s tokens=${out.usage?.total_tokens ?? "?"}`);
      res.writeHead(200, headers); return res.end(JSON.stringify(record));
    } catch (e) {
      console.error("[study] 오류", e);
      res.writeHead(500, headers); return res.end(JSON.stringify({ error: e.message }));
    }
  }

  res.writeHead(404, headers); res.end(JSON.stringify({ error: "not found" }));
}).listen(PORT, () => console.log(`study server: http://localhost:${PORT}  (POST /study, GET /health)  cache=${CACHE_DIR}`));
