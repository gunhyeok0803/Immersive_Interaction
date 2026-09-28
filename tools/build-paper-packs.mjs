// [4단계] 논문별 학습 팩 사전 생성 (Codex CLI, API 키·결제 불필요 — ChatGPT 로그인 사용)
// 사용: node tools/build-paper-packs.mjs [--foundations] [--limit N] [--only W123,W456] [--force] [--concurrency 3] [--model 이름] [--effort 단계]
//   기본      : 팩이 없는 논문만 전체 팩 생성
//   --foundations : 이미 있는 팩에 '기초과학·CS'(foundations)와 '사용 툴'(tools)만 채움 (나머지 내용은 그대로)
// 먼저 공통 세트가 있어야 함: node tools/build-common-set.mjs
// 결과: source/data/study/papers/<paperId>.json
//   논문 팩 = 개요·키워드·2차 이해 · 기초과학·CS(공학수학·역학·물리는 수식 포함, CS) · 사용 툴 · 먼저 볼 공통 모듈 · 재구성.
//   유사 논문(웹)은 fetch-related.mjs가 따로 모음. 스키마·프롬프트는 lib/paper-prompts.mjs.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codexJson, pool, parseArgs, DEFAULT_MODEL, DEFAULT_EFFORT } from "./lib/codex.mjs";
import {
  paperPackSchema, PAPER_PACK_PROMPT, FOUNDATIONS_SCHEMA, TOOLS_SCHEMA, FOUNDATION_PROMPT, FOUNDATION_LEVELS, modulesDigest, paperInput,
} from "./lib/paper-prompts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "source", "data");
const STUDY = path.join(DATA, "study");
const CACHE_DIR = path.join(STUDY, "papers");
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

const opt = parseArgs(process.argv.slice(2), { foundations: false, limit: Infinity, only: null, force: false, concurrency: 3, model: DEFAULT_MODEL, effort: DEFAULT_EFFORT });
const only = opt.only ? new Set(String(opt.only).split(",")) : null;
const modelName = `${opt.model} (${opt.effort})`;

// 공통 모듈(카드 제목까지) 읽기
const index = await readJson(path.join(STUDY, "common.json"));
const modules = await Promise.all(index.modules.map(async (m) => {
  const p = path.join(STUDY, "modules", `${m.id}.json`);
  return existsSync(p) ? { ...m, pack: (await readJson(p)).pack } : m;
}));
if (modules.some((m) => !m.pack)) console.warn("경고: 아직 생성되지 않은 모듈이 있음 → focus_cards가 비정확할 수 있음");
const cardTitles = Object.fromEntries(modules.map((m) => [m.id, new Set((m.pack?.layers ?? []).flatMap((l) => l.cards.map((c) => c.title)))]));
const allTitles = new Set(Object.values(cardTitles).flatMap((s) => [...s]));
const digest = modulesDigest(modules);

const packPath = (id) => path.join(CACHE_DIR, `${id}.json`);
// foundations 정리: 공학수학 → 역학 → 물리 → CS 순, 분야당 1개, 모듈에 없는 카드 제목은 비움
function tidyFoundations(list) {
  const out = FOUNDATION_LEVELS.map((lv) => list.find((f) => f.discipline === lv)).filter(Boolean);
  for (const f of out) if (f.module_card && !allTitles.has(f.module_card)) f.module_card = "";
  return out;
}

const { papers } = await readJson(path.join(DATA, "papers.json"));
await mkdir(CACHE_DIR, { recursive: true });
const todo = [];
for (const p of papers) {
  if (only && !only.has(p.id)) continue;
  const exists = existsSync(packPath(p.id));
  if (opt.foundations) {
    if (!exists) continue; // 팩이 먼저 있어야 함
    const pk = (await readJson(packPath(p.id))).pack;
    if (!opt.force && pk.foundations?.length === FOUNDATION_LEVELS.length && pk.tools?.length) continue;
  } else if (!opt.force && exists) continue;
  todo.push(p);
}
todo.splice(Number(opt.limit));
console.log(`${opt.foundations ? "기초과학·CS·툴" : "논문 팩"} 생성 대상 ${todo.length}편 (전체 ${papers.length}, 동시 ${opt.concurrency}, 모델 ${modelName})`);

const header = (rules) => [rules, "도구·명령은 쓰지 말고, 아래 정보만 보고 스키마에 맞는 JSON 하나로만 답한다.",
  "", "공통 모듈 목록 (id · 제목 · 층별 카드 제목):", digest];

let done = 0; const failed = [];
await pool(todo, Number(opt.concurrency), async (p) => {
  const t0 = Date.now();
  try {
    if (opt.foundations) {
      const prompt = [...header(FOUNDATION_PROMPT), "", "논문:", paperInput(p)].join("\n");
      const schema = { type: "object", additionalProperties: false, required: ["foundations", "tools"], properties: { foundations: FOUNDATIONS_SCHEMA, tools: TOOLS_SCHEMA } };
      const res = await codexJson({ prompt, schema, model: opt.model, effort: opt.effort });
      const record = await readJson(packPath(p.id));
      record.pack.foundations = tidyFoundations(res.foundations);
      record.pack.tools = res.tools;
      record.foundations_model = modelName;
      await writeFile(packPath(p.id), JSON.stringify(record, null, 2), "utf8");
      const f = record.pack.foundations;
      console.log(`[${++done}/${todo.length}] ${p.id} ${((Date.now() - t0) / 1000).toFixed(0)}s  ${f.map((x) => `${x.concept}(${x.evidence})`).join(" / ")}  | 툴 ${res.tools.length}`);
    } else {
      const prompt = [...header(PAPER_PACK_PROMPT), "", "논문:", paperInput(p)].join("\n");
      const pack = await codexJson({ prompt, schema: paperPackSchema(modules.map((m) => m.id)), model: opt.model, effort: opt.effort });
      // 모듈에 없는 카드 제목은 버림 (UI에서 이동할 수 없으므로)
      for (const r of pack.module_refs) r.focus_cards = r.focus_cards.filter((t) => cardTitles[r.module_id]?.has(t));
      pack.foundations = tidyFoundations(pack.foundations);
      const record = { paperId: p.id, title: p.title, model: modelName, via: "codex-cli", generated_at: new Date().toISOString(), pack };
      await writeFile(packPath(p.id), JSON.stringify(record, null, 2), "utf8");
      console.log(`[${++done}/${todo.length}] ${p.id} ${((Date.now() - t0) / 1000).toFixed(0)}s  → ${pack.module_refs.map((r) => r.module_id).join(", ")}  ${p.title.slice(0, 40)}`);
    }
  } catch (e) { if (e.usageLimit) throw e; failed.push(p.id); console.error(`[실패] ${p.id} ${e.message}`); }
});
console.log(`완료 ${done}편, 실패 ${failed.length}편${failed.length ? `: --only ${failed.join(",")} 로 다시 실행` : ""}`);
