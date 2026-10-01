// [5단계] 개념 지식 그래프 생성 (Codex CLI). 학습 단위를 논문 → 개념으로 바꾼 새 학습 세트. 스키마·프롬프트: lib/concept-prompts.mjs
// 사용:
//   node tools/build-concept-graph.mjs graph                 개념 그래프 (source/data/study/graph.json)
//   node tools/build-concept-graph.mjs cards [--only a,b,c]  개념 카드 (source/data/study/concepts/<id>.json), 한 번에 --batch개씩
//   node tools/build-concept-graph.mjs paths [--only W..]    논문 → 학습 경로 (source/data/study/paths/<paperId>.json)
//   node tools/build-concept-graph.mjs briefs [--only W..]   논문 요약(문제·방법·결과·의미)을 경로 파일에 brief로 추가 (paths 다음)
//   공통: [--force] [--concurrency 3] [--batch 4] [--model 이름] [--effort 단계]
// 이미 있는 결과는 건너뜀. 그래프는 코드가 검사함: 없는 id 버림, 순환 끊기, 수준 1까지 이어지는지.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codexJson, pool, parseArgs, DEFAULT_MODEL, DEFAULT_EFFORT } from "./lib/codex.mjs";
import { GRAPH_SCHEMA, GRAPH_PROMPT, CARDS_SCHEMA, CARDS_PROMPT, PATH_SCHEMA, PATH_PROMPT, BRIEF_SCHEMA, BRIEF_PROMPT } from "./lib/concept-prompts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "source", "data");
const STUDY = path.join(DATA, "study");
const GRAPH = path.join(STUDY, "graph.json");
const CARD_DIR = path.join(STUDY, "concepts");
const PATH_DIR = path.join(STUDY, "paths");
const opt = parseArgs(process.argv.slice(2), { force: false, concurrency: 3, batch: 4, model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, only: null });
const step = opt._?.[0] || "graph";
const only = opt.only ? new Set(String(opt.only).split(",")) : null;
const stamp = () => ({ model: `${opt.model} (${opt.effort})`, via: "codex-cli", generated_at: new Date().toISOString() });
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const save = (p, j) => writeFile(p, JSON.stringify(j, null, 2), "utf8");
const chunk = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

const { papers } = await readJson(path.join(DATA, "papers.json"));
// 논문 입력: 제목·연도·학회 + 초록 앞부분 + 기존 학습 팩의 키워드(방법 힌트)
async function paperBrief(p, n = 700) {
  const f = path.join(STUDY, "papers", `${p.id}.json`);
  const kws = existsSync(f) ? ((await readJson(f)).pack?.keywords || []).map((k) => k.term).join(", ") : "";
  return `[${p.id}] ${p.title} (${p.year}, ${p.venue || "-"})\n초록: ${(p.abstract || "(없음)").slice(0, n)}${kws ? `\n키워드: ${kws}` : ""}`;
}

// 그래프 검사: 없는 선수 id 버림, 순환을 만드는 간선 제거, 수준 1까지 닿지 않는 개념 경고
function validate(concepts) {
  const ids = new Set(concepts.map((c) => c.id));
  for (const c of concepts) c.prerequisites = [...new Set(c.prerequisites.filter((p) => ids.has(p) && p !== c.id))];
  const byId = Object.fromEntries(concepts.map((c) => [c.id, c]));
  // 깊이 우선으로 순환 간선 제거
  const state = {};
  const visit = (id) => {
    state[id] = 1;
    const c = byId[id];
    c.prerequisites = c.prerequisites.filter((p) => { if (state[p] === 1) return false; if (!state[p]) visit(p); return true; });
    state[id] = 2;
  };
  for (const c of concepts) if (!state[c.id]) visit(c.id);
  const reachesBase = (id, seen = new Set()) => { const c = byId[id]; if (c.level === 1) return true; if (seen.has(id)) return false; seen.add(id); return c.prerequisites.some((p) => reachesBase(p, seen)); };
  const orphans = concepts.filter((c) => !reachesBase(c.id)).map((c) => c.id);
  // 응용 = 선수의 역방향
  for (const c of concepts) c.applications = concepts.filter((x) => x.prerequisites.includes(c.id)).map((x) => x.id);
  return { orphans };
}

async function graph() {
  if (!opt.force && existsSync(GRAPH)) return console.log("graph: 있음, 건너뜀 (--force로 다시)");
  const briefs = await Promise.all(papers.map((p) => paperBrief(p)));
  console.log(`graph: 논문 ${papers.length}편 → 개념 그래프 설계…`);
  const t0 = Date.now();
  const res = await codexJson({ prompt: `${GRAPH_PROMPT}\n\n논문 목록:\n${briefs.join("\n\n")}`, schema: GRAPH_SCHEMA, model: opt.model, effort: opt.effort });
  const { orphans } = validate(res.concepts);
  await save(GRAPH, { ...stamp(), concepts: res.concepts });
  const lv = [1, 2, 3].map((l) => res.concepts.filter((c) => c.level === l).length);
  console.log(`graph: 개념 ${res.concepts.length}개 (수준 1/2/3 = ${lv.join("/")}), 선수 간선 ${res.concepts.reduce((s, c) => s + c.prerequisites.length, 0)}개, ${((Date.now() - t0) / 1000).toFixed(0)}s${orphans.length ? `  ⚠ 기초까지 안 닿음: ${orphans.join(",")}` : ""}`);
}

// 카드 정리: 빈 식·구조는 null로, 문제 형식이 어긋나면 바로잡음(보기가 모자란 choice → calc). 결과 요약 문자열을 돌려줌
function tidyCard(card) {
  if (card.formula && !card.formula.latex?.trim()) card.formula = null;
  if (card.structure && !card.structure.parts?.length && !card.structure.flow?.trim()) card.structure = null;
  if (card.code && !card.code.snippet?.trim()) card.code = null;
  for (const p of card.practice || []) {
    const ok = p.kind === "choice" && p.choices?.length >= 2 && p.answer >= 0 && p.answer < p.choices.length;
    if (p.kind === "choice" && !ok) { p.kind = "calc"; }
    if (p.kind === "calc") { p.choices = []; p.answer = -1; }
    // 해설의 "○번"을 화면 표기(①②③④)로 (9/30: 0부터 센 해설과 1부터 센 해설이 섞여 "정답은 0번"처럼 보였음)
    if (p.kind === "choice" && /\d번/.test(p.solution)) {
      const zero = /(^|[^0-9])0번/.test(p.solution);
      p.solution = p.solution.replace(/(^|[^0-9])(\d)번/g, (m, pre, d) => { const j = zero ? +d : +d - 1; return j >= 0 && j < p.choices.length ? pre + String.fromCharCode(0x2460 + j) : m; });
    }
  }
  const kinds = (card.practice || []).map((p) => (p.kind === "choice" ? "선" : "계")).join("");
  const warn = !card.formula && !card.structure ? " ⚠식·구조 없음" : "";
  return `${card.formula ? "식" : "-"}/${card.structure ? "구조" : "-"}/${card.code ? "코드" : "-"} 문제 ${kinds}${warn}`;
}

async function cards() {
  const g = await readJson(GRAPH);
  const byId = Object.fromEntries(g.concepts.map((c) => [c.id, c]));
  await mkdir(CARD_DIR, { recursive: true });
  const todo = g.concepts.filter((c) => (!only || only.has(c.id)) && (opt.force || !existsSync(path.join(CARD_DIR, `${c.id}.json`))));
  console.log(`cards: ${todo.length}개 생성 (${opt.batch}개씩, 동시 ${opt.concurrency})`);
  const desc = (c) => `- id=${c.id} · ${c.name} (${c.english}) · 수준 ${c.level} · ${c.field}\n  한 줄: ${c.one_line}\n  선수: ${c.prerequisites.map((p) => byId[p]?.name).join(", ") || "(없음)"}\n  응용: ${(c.applications || []).map((p) => byId[p]?.name).join(", ") || "(없음)"}`;
  await pool(chunk(todo, Number(opt.batch)), Number(opt.concurrency), async (batch) => {
    const t0 = Date.now();
    try {
      const res = await codexJson({ prompt: `${CARDS_PROMPT}\n\n개념:\n${batch.map(desc).join("\n")}`, schema: CARDS_SCHEMA, model: opt.model, effort: opt.effort });
      const notes = [];
      for (const card of res.cards) {
        if (!byId[card.id]) continue;
        notes.push(`${card.id}: ${tidyCard(card)}`);
        await save(path.join(CARD_DIR, `${card.id}.json`), { ...stamp(), ...byId[card.id], card });
      }
      console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s  ${notes.join("  |  ")}`);
    } catch (e) { if (e.usageLimit) throw e; console.error(`  [실패] ${batch.map((c) => c.id).join(",")} ${e.message}`); }
  });
}

async function paths() {
  const g = await readJson(GRAPH);
  const byId = Object.fromEntries(g.concepts.map((c) => [c.id, c]));
  await mkdir(PATH_DIR, { recursive: true });
  const todo = papers.filter((p) => (!only || only.has(p.id)) && (opt.force || !existsSync(path.join(PATH_DIR, `${p.id}.json`))));
  console.log(`paths: 논문 ${todo.length}편 (${opt.batch}편씩)`);
  const graphText = g.concepts.map((c) => `${c.id} · ${c.name} · L${c.level} · 선수: ${c.prerequisites.join(",") || "-"}`).join("\n");
  // 경로를 선수 순서에 맞게 정렬 (모델이 순서를 틀려도 앞뒤가 맞게)
  const order = (ids) => { const out = [], seen = new Set(); const put = (id) => { if (seen.has(id) || !ids.includes(id)) return; seen.add(id); for (const p of byId[id].prerequisites) put(p); out.push(id); }; ids.forEach(put); return out; };
  await pool(chunk(todo, Number(opt.batch)), Number(opt.concurrency), async (batch) => {
    const t0 = Date.now();
    try {
      const briefs = await Promise.all(batch.map((p) => paperBrief(p, 1500)));
      const res = await codexJson({ prompt: `${PATH_PROMPT}\n\n개념 그래프:\n${graphText}\n\n논문:\n${briefs.join("\n\n")}`, schema: PATH_SCHEMA, model: opt.model, effort: opt.effort });
      for (const r of res.papers) {
        if (!batch.some((p) => p.id === r.paper_id)) continue;
        const steps = r.path.filter((s) => byId[s.concept]);
        const roles = Object.fromEntries(steps.map((s) => [s.concept, s.role]));
        const ids = order(steps.map((s) => s.concept));
        await save(path.join(PATH_DIR, `${r.paper_id}.json`), { ...stamp(), paper_id: r.paper_id, summary: r.summary, core: r.core.filter((c) => byId[c]), path: ids.map((id) => ({ concept: id, role: roles[id] })) });
      }
      console.log(`  ${batch.map((p) => p.id).join(", ")}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) { if (e.usageLimit) throw e; console.error(`  [실패] ${batch.map((p) => p.id).join(",")} ${e.message}`); }
  });
}

// 논문 요약(구조): 초록 전체를 읽혀 문제·방법·결과·의미. 초록이 없는 논문은 제목만으로 쓰고 from_title로 표시
async function briefs() {
  const todo = papers.filter((p) => existsSync(path.join(PATH_DIR, `${p.id}.json`)) && (!only || only.has(p.id)));
  const pending = [];
  for (const p of todo) if (opt.force || !(await readJson(path.join(PATH_DIR, `${p.id}.json`))).brief) pending.push(p);
  console.log(`briefs: 논문 ${pending.length}편 (${opt.batch}편씩)`);
  await pool(chunk(pending, Number(opt.batch)), Number(opt.concurrency), async (batch) => {
    const t0 = Date.now();
    try {
      const text = batch.map((p) => `[${p.id}] ${p.title} (${p.year}, ${p.venue || "-"})\n초록: ${p.abstract?.trim() || "(없음)"}`).join("\n\n");
      const res = await codexJson({ prompt: `${BRIEF_PROMPT}\n\n논문:\n${text}`, schema: BRIEF_SCHEMA, model: opt.model, effort: opt.effort });
      for (const r of res.papers) {
        const p = batch.find((x) => x.id === r.paper_id);
        if (!p) continue;
        const f = path.join(PATH_DIR, `${p.id}.json`), rec = await readJson(f);
        rec.brief = { problem: r.problem, method: r.method, result: r.result, meaning: r.meaning, from_title: !p.abstract?.trim(), ...stamp() };
        await save(f, rec);
      }
      console.log(`  ${batch.map((p) => p.id).join(", ")}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) { if (e.usageLimit) throw e; console.error(`  [실패] ${batch.map((p) => p.id).join(",")} ${e.message}`); }
  });
}

if (step === "graph") await graph();
else if (step === "cards") await cards();
else if (step === "paths") await paths();
else if (step === "briefs") await briefs();
else console.error(`알 수 없는 단계: ${step}`);
