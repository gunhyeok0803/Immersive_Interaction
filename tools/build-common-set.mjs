// [3단계] 공통 공부 세트 생성 (Codex CLI). 사용:
//   node tools/build-common-set.mjs [plan|modules|trends|all] [--force] [--model 이름] [--effort 단계]
// plan    : 최근(2023~) 논문을 4~6개 모듈로 묶음      → source/data/study/common.json
// modules : 모듈마다 top-down 공부 세트                → source/data/study/modules/<id>.json
// trends  : 피지컬 AI 동향(웹 검색) + 출처 URL 확인     → source/data/study/trends.json
// 스키마·프롬프트는 lib/common-prompts.mjs. 이미 있는 결과는 건너뜀(--force면 다시).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codexJson, pool, parseArgs, DEFAULT_MODEL, DEFAULT_EFFORT } from "./lib/codex.mjs";
import {
  RECENT_FROM, LAYER_ORDER, PLAN_SCHEMA, PLAN_PROMPT, MODULE_SCHEMA, MODULE_PROMPT, TRENDS_SCHEMA, TRENDS_PROMPT,
} from "./lib/common-prompts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "source", "data", "study");
const INDEX = path.join(DIR, "common.json");
const MOD_DIR = path.join(DIR, "modules");
const TRENDS = path.join(DIR, "trends.json");

const opt = parseArgs(process.argv.slice(2), { force: false, model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, concurrency: 3 });
const step = opt._?.[0] || "all";
const model = `${opt.model} (${opt.effort})`;
const stamp = () => ({ model, via: "codex-cli", generated_at: new Date().toISOString() });
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const save = (p, j) => writeFile(p, JSON.stringify(j, null, 2), "utf8");

const { papers } = await readJson(path.join(ROOT, "source", "data", "papers.json"));
const recent = papers.filter((p) => (p.year ?? 0) >= RECENT_FROM);
const byId = Object.fromEntries(papers.map((p) => [p.id, p]));
const brief = (p, n = 1400) => `[${p.id}] ${p.title} (${p.year}, ${p.venue || "-"})\n초록: ${(p.abstract || "(초록 없음)").slice(0, n)}`;
await mkdir(MOD_DIR, { recursive: true });

async function plan() {
  if (!opt.force && existsSync(INDEX)) return console.log("plan: 있음, 건너뜀");
  console.log(`plan: 최근 논문 ${recent.length}편 → 모듈 묶기…`);
  const t0 = Date.now();
  const res = await codexJson({
    prompt: `${PLAN_PROMPT}\n\n논문 목록:\n${recent.map((p) => brief(p)).join("\n\n")}`,
    schema: PLAN_SCHEMA, model: opt.model, effort: opt.effort,
  });
  // 목록에 없는 id는 버리고, 어느 모듈에도 없는 논문은 알려 줌
  const valid = new Set(recent.map((p) => p.id));
  for (const m of res.modules) m.paper_ids = m.paper_ids.filter((id) => valid.has(id));
  const covered = new Set(res.modules.flatMap((m) => m.paper_ids));
  const orphan = recent.filter((p) => !covered.has(p.id)).map((p) => p.id);
  await save(INDEX, { ...stamp(), recent_from: RECENT_FROM, research_overview: res.research_overview, modules: res.modules });
  console.log(`plan: 모듈 ${res.modules.length}개 (${((Date.now() - t0) / 1000).toFixed(0)}s)${orphan.length ? `  ⚠ 모듈 없는 논문: ${orphan.join(",")}` : ""}`);
  for (const m of res.modules) console.log(`  - ${m.id} · ${m.title} (${m.paper_ids.length}편)`);
}

async function modules() {
  const index = await readJson(INDEX);
  const todo = index.modules.filter((m) => opt.force || !existsSync(path.join(MOD_DIR, `${m.id}.json`)));
  console.log(`modules: ${todo.length}개 생성`);
  await pool(todo, Number(opt.concurrency), async (m) => {
    const t0 = Date.now();
    const prompt = `${MODULE_PROMPT}\n\n모듈: ${m.title} (id=${m.id})\n묶은 이유: ${m.why_grouped}\n\n이 모듈의 논문:\n${m.paper_ids.map((id) => brief(byId[id], 1800)).join("\n\n")}`;
    try {
      const pack = await codexJson({ prompt, schema: MODULE_SCHEMA, model: opt.model, effort: opt.effort });
      pack.layers.sort((a, b) => LAYER_ORDER.indexOf(a.level) - LAYER_ORDER.indexOf(b.level));
      const missing = LAYER_ORDER.filter((l) => !pack.layers.some((x) => x.level === l && x.cards.length));
      await save(path.join(MOD_DIR, `${m.id}.json`), { ...stamp(), id: m.id, title: m.title, summary: m.summary, paper_ids: m.paper_ids, pack });
      console.log(`  ${m.id} ${((Date.now() - t0) / 1000).toFixed(0)}s  카드 ${pack.layers.map((l) => `${l.level}:${l.cards.length}`).join(" ")}${missing.length ? `  ⚠ 빈 층: ${missing}` : ""}`);
    } catch (e) { if (e.usageLimit) throw e; console.error(`  [실패] ${m.id} ${e.message}`); }
  });
}

// 출처 URL이 실제로 열리는지 확인. X/Threads 등은 봇을 막아 403이 날 수 있어 status를 남겨 둔다
async function checkUrl(url) {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (link check)" }, signal: AbortSignal.timeout(15000) });
    return r.status;
  } catch { return 0; }
}

async function trends() {
  if (!opt.force && existsSync(TRENDS)) return console.log("trends: 있음, 건너뜀");
  const index = await readJson(INDEX);
  const today = new Date().toISOString().slice(0, 10);
  console.log("trends: 웹 검색으로 피지컬 AI 동향 수집…");
  const t0 = Date.now();
  const res = await codexJson({
    prompt: `${TRENDS_PROMPT(today)}\n\n연구실 모듈:\n${index.modules.map((m) => `- id=${m.id} · ${m.title}: ${m.summary}`).join("\n")}`,
    schema: TRENDS_SCHEMA, model: opt.model, effort: opt.effort, search: true,
  });
  const ids = new Set(index.modules.map((m) => m.id));
  let bad = 0;
  for (const it of res.items) {
    it.related_modules = it.related_modules.filter((id) => ids.has(id));
    for (const s of it.sources) { s.status = await checkUrl(s.url); s.ok = s.status >= 200 && s.status < 400; if (!s.ok) bad++; }
  }
  await save(TRENDS, { ...stamp(), as_of: res.as_of || today, items: res.items });
  console.log(`trends: ${res.items.length}개 (${((Date.now() - t0) / 1000).toFixed(0)}s), 열리지 않은 출처 ${bad}개`);
  for (const it of res.items) console.log(`  - ${it.title}  [${it.sources.map((s) => s.status).join(",")}]`);
}

if (step === "plan" || step === "all") await plan();
if (step === "modules" || step === "all") await modules();
if (step === "trends" || step === "all") await trends();
