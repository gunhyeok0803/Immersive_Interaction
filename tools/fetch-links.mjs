// [1-2단계] papers.json 보강: 무료 원문 주소 + 비어 있는 초록 채우기 (AI 사용 없음)
// 사용: node tools/fetch-links.mjs [papers.json]
// 1) OpenAlex locations에서 무료 PDF(pdf_url)와 대학·기관 저장소 사본(repo_url)을 찾음
//    (DOI는 출판사 페이지로 가서 학교 밖에서는 본문이 막히거나 로봇 확인이 뜸, 10/1 사용자 지적)
// 2) OpenAlex에 초록이 없는 논문은 Semantic Scholar → Crossref 순으로 초록을 찾아 채우고 출처를 abstract_src에 남김
// 다른 값(인용 수 등)은 그대로 둠.

import { readFile, writeFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (compatible; ImmersiveInteractionResolver/0.1)";
const file = process.argv[2] || "source/data/papers.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url) => { const r = await fetch(url, { headers: { "user-agent": UA } }); return r.ok ? r.json() : null; };

const data = JSON.parse(await readFile(file, "utf8"));
const papers = data.papers;

// 1) 무료 원문 위치
const works = [];
for (let i = 0; i < papers.length; i += 50) {
  const filter = "doi:" + papers.slice(i, i + 50).map((p) => "https://doi.org/" + p.doi).join("|");
  const j = await getJson(`https://api.openalex.org/works?filter=${encodeURIComponent(filter)}&per_page=50&select=doi,open_access,locations`);
  works.push(...(j?.results || []));
}
const byDoi = Object.fromEntries(works.map((w) => [(w.doi || "").replace("https://doi.org/", "").toLowerCase(), w]));
for (const p of papers) {
  const locs = byDoi[p.doi.toLowerCase()]?.locations || [];
  p.pdf_url = locs.find((l) => l.pdf_url)?.pdf_url || "";
  p.repo_url = locs.find((l) => l.source?.type === "repository" && l.landing_page_url)?.landing_page_url || "";
}

// 2) 비어 있는 초록
for (const p of papers.filter((x) => !x.abstract?.trim())) {
  const s2 = await getJson(`https://api.semanticscholar.org/graph/v1/paper/DOI:${p.doi}?fields=abstract`);
  if (s2?.abstract) { p.abstract = s2.abstract.trim(); p.abstract_src = "Semantic Scholar"; }
  else {
    const cr = await getJson(`https://api.crossref.org/works/${encodeURIComponent(p.doi)}`);
    const a = (cr?.message?.abstract || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (a) { p.abstract = a; p.abstract_src = "Crossref"; }
  }
  await sleep(1200); // Semantic Scholar 무료 한도
}

data.stats.with_abstract = papers.filter((p) => p.abstract).length;
data.stats.with_pdf = papers.filter((p) => p.pdf_url).length;
data.stats.with_repo = papers.filter((p) => p.repo_url).length;
data.links_at = new Date().toISOString();
await writeFile(file, JSON.stringify(data, null, 2), "utf8");
console.log(`무료 PDF ${data.stats.with_pdf} · 저장소 사본 ${data.stats.with_repo} · 무료 공개 ${papers.filter((p) => p.is_oa).length} / ${papers.length}편`);
console.log(`초록 ${data.stats.with_abstract}편 (보충 ${papers.filter((p) => p.abstract_src).length}편), 없음: ${papers.filter((p) => !p.abstract).map((p) => p.id).join(", ") || "-"}`);
