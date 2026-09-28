// [2단계] 웹의 유사 논문 수집 (LLM 없음). 사용: node tools/fetch-related.mjs [--top 5] [--force]
// 출처: Semantic Scholar Recommendations API (키 불필요). 논문 임베딩(SPECTER) 기반으로 "이 논문과 비슷한 논문"을 돌려줌.
//   최근 풀(recent)이 비면 전체 CS 풀(all-cs) → S2 키워드 검색 → Crossref → OpenAlex 검색 순으로 채움. 항목마다 via에 출처를 남김.
// 모델이 논문을 지어낼 위험이 없고, 결과마다 실제 링크가 있음. 서가에 이미 있는 교수님 논문은 뺌.
// 출력: source/data/related-papers.json  { <paperId>: { fetched_at, items: [{ title, year, venue, cited, url, doi, pdf, abstract, via }] } }

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/codex.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "source", "data", "related-papers.json");
const opt = parseArgs(process.argv.slice(2), { top: 5, force: false });
const TOP = Number(opt.top);
const FIELDS = "title,year,venue,citationCount,externalIds,url,openAccessPdf,abstract";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { papers } = JSON.parse(await readFile(path.join(ROOT, "source", "data", "papers.json"), "utf8"));
const own = new Set(papers.map((p) => p.doi?.toLowerCase()).filter(Boolean));
const out = existsSync(OUT) && !opt.force ? JSON.parse(await readFile(OUT, "utf8")) : {};

// 키 없는 공용 한도라 429가 나면 기다렸다 다시. pool: recent(최근 논문 풀, 기본) | all-cs(전체 CS 풀)
async function recommend(doi, pool) {
  const url = `https://api.semanticscholar.org/recommendations/v1/papers/forpaper/DOI:${encodeURIComponent(doi)}?from=${pool}&limit=${TOP * 3}&fields=${FIELDS}`;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url);
    if (r.status === 429) { await sleep(3000 * (i + 1)); continue; }
    if (r.status === 404) return []; // S2에 없는 논문
    if (!r.ok) throw new Error(`S2 ${r.status}`);
    return ((await r.json()).recommendedPapers ?? []).map((q) => ({
      title: q.title, year: q.year, venue: q.venue || "", cited: q.citationCount ?? 0,
      doi: q.externalIds?.DOI || null,
      url: q.externalIds?.DOI ? `https://doi.org/${q.externalIds.DOI}` : q.url,
      pdf: q.openAccessPdf?.url || null, abstract: q.abstract || null,
      via: `s2-${pool}`,
    }));
  }
  throw new Error("S2 429 반복");
}

// 추천이 비면: S2 키워드 검색(제목 핵심 단어). 관련도 순
async function s2Search(p) {
  const q = p.title.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3).slice(0, 8).join(" ");
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=${TOP * 3}&fields=${FIELDS}`;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url);
    if (r.status === 429) { await sleep(3000 * (i + 1)); continue; }
    if (!r.ok) return [];
    return ((await r.json()).data ?? []).map((q) => ({
      title: q.title, year: q.year, venue: q.venue || "", cited: q.citationCount ?? 0,
      doi: q.externalIds?.DOI || null,
      url: q.externalIds?.DOI ? `https://doi.org/${q.externalIds.DOI}` : q.url,
      pdf: q.openAccessPdf?.url || null, abstract: q.abstract || null,
      via: "s2-search",
    }));
  }
  return [];
}

// S2 한도에 걸릴 때: Crossref 서지 검색(키 불필요, 한도 여유). 관련도 순이지만 추천보다 거침
async function crossrefSearch(p) {
  const q = p.title.replace(/[^A-Za-z0-9 ]/g, " ");
  const r = await fetch(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q)}&rows=${TOP * 4}&filter=type:journal-article,type:proceedings-article&select=DOI,title,issued,container-title,is-referenced-by-count,abstract`,
    { headers: { "user-agent": "Immersive_Interaction study tool (https://github.com/gunhyeok0803/Immersive_Interaction)" } });
  if (!r.ok) return [];
  return ((await r.json()).message?.items ?? []).map((w) => ({
    title: w.title?.[0], year: w.issued?.["date-parts"]?.[0]?.[0] ?? null, venue: w["container-title"]?.[0] || "",
    cited: w["is-referenced-by-count"] ?? 0, doi: w.DOI, url: `https://doi.org/${w.DOI}`, pdf: null,
    abstract: w.abstract ? w.abstract.replace(/<[^>]+>/g, "").trim() : null,
    via: "crossref-search",
  }));
}

// 최후 수단: OpenAlex 전문 검색(제목 단어). 추천보다 거칠지만 실제 논문만 나옴
async function openalexSearch(p) {
  const q = p.title.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3).slice(0, 8).join(" ");
  const r = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${TOP * 3}&select=title,publication_year,primary_location,cited_by_count,doi,open_access,abstract_inverted_index`);
  if (!r.ok) return [];
  const unInvert = (ix) => {
    if (!ix) return null;
    const words = [];
    for (const [w, pos] of Object.entries(ix)) for (const i of pos) words[i] = w;
    return words.join(" ");
  };
  return ((await r.json()).results ?? []).map((w) => ({
    title: w.title, year: w.publication_year, venue: w.primary_location?.source?.display_name || "", cited: w.cited_by_count ?? 0,
    doi: w.doi?.replace("https://doi.org/", "") || null, url: w.doi || null,
    pdf: w.open_access?.oa_url || null, abstract: unInvert(w.abstract_inverted_index),
    via: "openalex-search",
  }));
}

let ok = 0, miss = [];
for (const p of papers) {
  if (out[p.id]?.items?.length) continue;
  if (!p.doi) { miss.push(`${p.id}(DOI 없음)`); continue; }
  try {
    // 최근 풀 → 전체 CS 풀 → OpenAlex 검색 순으로 채움. 교수님 논문·중복·자기 자신은 뺌
    const seen = new Set([p.doi.toLowerCase(), p.title.toLowerCase()]);
    const items = [];
    const add = (list) => {
      for (const q of list) {
        if (items.length >= TOP) break;
        const k1 = q.doi?.toLowerCase(), k2 = q.title?.toLowerCase();
        if (!q.title || (k1 && (own.has(k1) || seen.has(k1))) || seen.has(k2)) continue;
        seen.add(k1); seen.add(k2); items.push(q);
      }
    };
    add(await recommend(p.doi, "recent"));
    if (items.length < TOP) { await sleep(1200); add(await recommend(p.doi, "all-cs")); }
    if (items.length < TOP) { await sleep(1200); add(await s2Search(p)); }
    if (items.length < TOP) add(await crossrefSearch(p));
    if (items.length < TOP) add(await openalexSearch(p));
    if (!items.length) { miss.push(`${p.id}(결과 없음)`); continue; }
    out[p.id] = { fetched_at: new Date().toISOString(), items };
    ok++;
    console.log(`[${ok}] ${p.id} ${items.map((q) => q.via.replace(/^s2-|openalex-/, "")).join(",")}  ${p.title.slice(0, 45)}`);
    await writeFile(OUT, JSON.stringify(out, null, 1), "utf8");
  } catch (e) { miss.push(`${p.id}(${e.message})`); }
  await sleep(1200);
}
await writeFile(OUT, JSON.stringify(out, null, 1), "utf8");
console.log(`완료 ${ok}편 추가, 누락 ${miss.length}: ${miss.join(" ")}`);
