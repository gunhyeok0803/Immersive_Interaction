// [4단계] 논문별 학습 팩 사전 생성 (Codex CLI, API 키·결제 불필요 — ChatGPT 로그인 사용)
// 사용: node tools/build-paper-packs.mjs [--limit N] [--only W123,W456] [--force] [--concurrency 3] [--model 이름] [--effort 단계]
// 먼저 공통 세트가 있어야 함: node tools/build-common-set.mjs
// 결과: src/data/study/papers/<paperId>.json
//   기초 지식(CS·공학수학·역학·물리)·툴은 공통 모듈이 맡고, 논문 팩은 개요·키워드·2차 이해·재구성 + "먼저 볼 모듈" 링크.
//   유사 논문(웹)은 fetch-related.mjs가 따로 모음. 스키마·프롬프트는 lib/paper-prompts.mjs.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codexJson, pool, parseArgs, DEFAULT_MODEL, DEFAULT_EFFORT } from "./lib/codex.mjs";
import { paperPackSchema, PAPER_PACK_PROMPT, modulesDigest, paperInput } from "./lib/paper-prompts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "src", "data");
const STUDY = path.join(DATA, "study");
const CACHE_DIR = path.join(STUDY, "papers");
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

const opt = parseArgs(process.argv.slice(2), { limit: Infinity, only: null, force: false, concurrency: 3, model: DEFAULT_MODEL, effort: DEFAULT_EFFORT });
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
const schema = paperPackSchema(modules.map((m) => m.id));
const digest = modulesDigest(modules);

const isDone = (id) => existsSync(path.join(CACHE_DIR, `${id}.json`));

const { papers } = await readJson(path.join(DATA, "papers.json"));
await mkdir(CACHE_DIR, { recursive: true });
const todo = [];
for (const p of papers) {
  if (only && !only.has(p.id)) continue;
  if (!opt.force && isDone(p.id)) continue;
  todo.push(p);
}
todo.splice(Number(opt.limit));
console.log(`생성 대상 ${todo.length}편 (전체 ${papers.length}, 동시 ${opt.concurrency}, 모델 ${modelName})`);

let done = 0; const failed = [];
await pool(todo, Number(opt.concurrency), async (p) => {
  const t0 = Date.now();
  const prompt = [
    PAPER_PACK_PROMPT,
    "도구·명령은 쓰지 말고, 아래 정보만 보고 스키마에 맞는 JSON 하나로만 답한다.",
    "", "공통 모듈 목록 (id · 제목 · 층별 카드 제목):", digest,
    "", "논문:", paperInput(p),
  ].join("\n");
  try {
    const pack = await codexJson({ prompt, schema, model: opt.model, effort: opt.effort });
    // 모듈에 없는 카드 제목은 버림 (UI에서 이동할 수 없으므로)
    for (const r of pack.module_refs) r.focus_cards = r.focus_cards.filter((t) => cardTitles[r.module_id]?.has(t));
    const record = { paperId: p.id, title: p.title, model: modelName, via: "codex-cli", generated_at: new Date().toISOString(), pack };
    await writeFile(path.join(CACHE_DIR, `${p.id}.json`), JSON.stringify(record, null, 2), "utf8");
    console.log(`[${++done}/${todo.length}] ${p.id} ${((Date.now() - t0) / 1000).toFixed(0)}s  → ${pack.module_refs.map((r) => r.module_id).join(", ")}  ${p.title.slice(0, 40)}`);
  } catch (e) { if (e.usageLimit) throw e; failed.push(p.id); console.error(`[실패] ${p.id} ${e.message}`); }
});
console.log(`완료 ${done}편, 실패 ${failed.length}편${failed.length ? `: --only ${failed.join(",")} 로 다시 실행` : ""}`);
