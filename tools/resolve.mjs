// URL → 논문 목록 JSON 변환기 (D2 로컬 버전)
// 사용: node tools/resolve.mjs <URL> [out.json]
// 1) URL을 받아 같은 호스트의 publication/paper/research 링크를 1단계 따라감
// 2) 모든 페이지에서 DOI를 정규식으로 추출
// 3) OpenAlex works?filter=doi:… 로 메타데이터(연도·피인용·초록·OA) 일괄 조회
// 4) src/data/papers.json 형식으로 저장
//
// Node 18+ (fetch 내장). 외부 의존성 없음.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const UA = "Mozilla/5.0 (compatible; ImmersiveInteractionResolver/0.1)";
const MAX_PAGES = 14;
const SUBPAGE_HINT = /(publication|paper|research|journal|conference)/i;
// 링크 우선순위: 논문 목록일 가능성이 큰 경로를 먼저
function linkScore(pathname) {
  const p = pathname.toLowerCase();
  if (/paper|journal|conference/.test(p)) return 3;
  if (/publication/.test(p)) return 2;
  if (/research/.test(p)) return 1;
  if (/press|award|news|people|contact|teaching|facilit|position/.test(p)) return -1;
  return 0;
}
const DOI_RE = /10\.\d{4,9}\/[^\s"'<>\\)\]]+/g;
const OPENALEX = "https://api.openalex.org";
const OPENALEX_KEY = process.env.OPENALEX_API_KEY; // 선택. 없으면 무료 기본 한도

async function getText(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function cleanDoi(raw) {
  // 끝의 구두점·괄호 제거, 소문자 통일
  let d = raw.replace(/[.,;:)\]]+$/, "");
  return d.toLowerCase();
}

function dedupeDois(list) {
  // "10.1093/jcde/qwab010/6154364" 처럼 진짜 DOI 뒤에 경로가 붙은 것은 짧은 쪽만 남김
  const set = new Set(list);
  const out = [];
  for (const d of [...set].sort((a, b) => a.length - b.length)) {
    if (!out.some((o) => d.startsWith(o + "/"))) out.push(d);
  }
  return out;
}

function sameHostLinks(html, base, requireHint) {
  const links = new Set();
  const re = /href="([^"#?]+)/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      if (u.host !== new URL(base).host) continue;
      if (requireHint && !SUBPAGE_HINT.test(u.pathname)) continue;
      if (linkScore(u.pathname) < 0) continue;
      links.add(u.origin + u.pathname);
    } catch {}
  }
  return [...links].sort((a, b) => linkScore(new URL(b).pathname) - linkScore(new URL(a).pathname));
}

function pageTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : "";
}

function abstractFromInverted(idx) {
  if (!idx) return "";
  const words = [];
  for (const [w, positions] of Object.entries(idx)) for (const p of positions) words[p] = w;
  return words.join(" ").replace(/\s+/g, " ").trim();
}

async function openalexByDois(dois) {
  const out = [];
  const select = [
    "id", "doi", "title", "publication_year", "cited_by_count", "abstract_inverted_index",
    "open_access", "primary_location", "authorships", "primary_topic",
  ].join(",");
  for (let i = 0; i < dois.length; i += 50) {
    const chunk = dois.slice(i, i + 50);
    const filter = "doi:" + chunk.map((d) => "https://doi.org/" + d).join("|");
    const url = `${OPENALEX}/works?filter=${encodeURIComponent(filter)}&per_page=50&select=${select}`;
    const headers = { "user-agent": UA };
    if (OPENALEX_KEY) headers.authorization = `Bearer ${OPENALEX_KEY}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`OpenAlex ${res.status}: ${await res.text()}`);
    const json = await res.json();
    out.push(...json.results);
  }
  return out;
}

function guessAuthor(works, title) {
  // 가장 많은 논문에 등장한 저자 = 교수. 페이지 제목은 참고용으로만 저장
  const count = new Map();
  // 최신 논문부터 보아 소속은 가장 최근 것을 취함
  const byYear = [...works].sort((a, b) => (b.publication_year ?? 0) - (a.publication_year ?? 0));
  for (const w of byYear) {
    for (const a of w.authorships ?? []) {
      const key = a.author?.id;
      if (!key) continue;
      const e = count.get(key) ?? { id: key, name: a.author.display_name, n: 0, inst: "" };
      e.n += 1;
      if (!e.inst && a.institutions?.[0]?.display_name) e.inst = a.institutions[0].display_name;
      count.set(key, e);
    }
  }
  const top = [...count.values()].sort((a, b) => b.n - a.n)[0];
  return top
    ? { id: top.id.replace("https://openalex.org/", ""), name: top.name, institution: top.inst, page_title: title, works_matched: top.n }
    : { id: "", name: "", institution: "", page_title: title, works_matched: 0 };
}

async function main() {
  const src = process.argv[2];
  const outPath = process.argv[3] ?? "src/data/papers.json";
  if (!src) {
    console.error("usage: node tools/resolve.mjs <URL> [out.json]");
    process.exit(1);
  }

  console.log("fetch", src);
  const rootHtml = await getText(src);
  const pages = [{ url: src, html: rootHtml }];
  const seen = new Set([new URL(src).origin + new URL(src).pathname]);
  // 1단계: 루트에서 publication/paper 계열 링크. 2단계: 그 페이지들 안의 같은 호스트 링크 (Notion처럼 UUID 경로인 하위 목록 대응)
  let queue = sameHostLinks(rootHtml, src, true).filter((u) => !seen.has(u));
  let depth = 1;
  while (queue.length && pages.length < MAX_PAGES && depth <= 2) {
    const next = [];
    for (const u of queue) {
      if (pages.length >= MAX_PAGES) break;
      if (seen.has(u)) continue;
      seen.add(u);
      try {
        console.log(`fetch d${depth}`, u);
        const html = await getText(u);
        pages.push({ url: u, html });
        if (depth === 1 && linkScore(new URL(u).pathname) >= 2) {
          next.push(...sameHostLinks(html, u, false).filter((x) => !seen.has(x)));
        }
      } catch (e) {
        console.warn("skip", u, e.message);
      }
    }
    queue = [...new Set(next)].sort((a, b) => linkScore(new URL(b).pathname) - linkScore(new URL(a).pathname));
    depth += 1;
  }

  const rawDois = pages.flatMap((p) => (p.html.match(DOI_RE) ?? []).map(cleanDoi));
  const dois = dedupeDois(rawDois);
  console.log(`DOIs found: ${dois.length} (raw ${rawDois.length}) across ${pages.length} pages`);

  const works = await openalexByDois(dois);
  const found = new Set(works.map((w) => (w.doi ?? "").replace("https://doi.org/", "").toLowerCase()));
  const missing = dois.filter((d) => !found.has(d));

  const papers = works
    .map((w) => ({
      id: w.id.replace("https://openalex.org/", ""),
      doi: (w.doi ?? "").replace("https://doi.org/", ""),
      title: w.title ?? "",
      year: w.publication_year ?? null,
      cited: w.cited_by_count ?? 0,
      venue: w.primary_location?.source?.display_name ?? "",
      topic: w.primary_topic?.display_name ?? "",
      abstract: abstractFromInverted(w.abstract_inverted_index),
      is_oa: !!w.open_access?.is_oa,
      oa_url: w.open_access?.oa_url ?? "",
      url: w.doi ?? "",
      authors: (w.authorships ?? []).slice(0, 8).map((a) => a.author?.display_name).filter(Boolean),
    }))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || b.cited - a.cited);

  const result = {
    source: src,
    resolved_at: new Date().toISOString(),
    author: guessAuthor(works, pageTitle(rootHtml)),
    stats: {
      pages_fetched: pages.length,
      dois_found: dois.length,
      works_resolved: papers.length,
      with_abstract: papers.filter((p) => p.abstract).length,
      open_access: papers.filter((p) => p.is_oa).length,
      missing_dois: missing,
    },
    papers,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result.stats, null, 2));
  console.log("author guess:", result.author);
  console.log("wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
