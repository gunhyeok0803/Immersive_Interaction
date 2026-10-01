/* study-panel: 학습 세트 데이터를 읽고, HUD 상세 창에 띄울 HTML을 만든다. (2026-09-29 개념 그래프 기반으로 교체)
 *
 * 학습 단위 = 개념 (사용자 결정): 연구실 논문 전체에 필요한 개념 90개를 학부 1~2학년 기초(L1) → 전공(L2) → 연구 기법(L3)으로 쌓고,
 * 선수 개념 → 응용 개념으로 이어 둠. 개념 카드 = 직관 · 정의 · 핵심 식 · 꼭 기억할 점 · 연습 문제 · 코드 · 참고 자료.
 * 논문은 입구: 논문을 고르면 "이 논문을 읽으려면 이 순서로" 학습 경로가 나오고, 경로의 각 개념이 이 논문에서 하는 일이 붙는다.
 * 유기적 연결: 개념 카드마다 선수·응용 개념 버튼, 그 개념을 쓰는 다른 교수님 논문 버튼이 있어 개념 ↔ 논문을 오갈 수 있다.
 *
 * 데이터 (tools/build-concept-graph.mjs가 만듦):
 *   data/study/graph.json            개념 90개 (id, 이름, 수준, 분야, 한 줄, 선수, 응용)
 *   data/study/concepts/<id>.json    개념 카드
 *   data/study/paths/<paperId>.json  논문 요약 + 학습 경로 + 중심 개념
 *   data/related-papers.json         웹 유사 논문 (논문 DB에서 가져온 실제 논문)
 * 상세 HTML 안의 버튼: data-concept(그 개념으로), data-paper(그 논문으로), data-reveal(풀이 보기). 처리는 index.html → hud.js
 */
(function () {
  const getJson = (u) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const tex = (s, display) => {
    if (!s) return "";
    try { if (window.katex) return window.katex.renderToString(s, { displayMode: display, throwOnError: false }); } catch {}
    return `<code>${esc(s)}</code>`;
  };
  // 본문 속 인라인 수식 \( … \)은 KaTeX로, 나머지는 이스케이프
  const rich = (s) => String(s ?? "").split(/\\\((.+?)\\\)/s).map((part, i) => (i % 2 ? tex(part, false) : esc(part))).join("");

  const LEVEL = { 1: "기초", 2: "전공", 3: "연구 기법" };
  const FIELD = { math: "수학", physics: "물리", mechanics: "역학", signal: "신호처리", cs: "컴퓨터과학", ml: "기계학습", vision: "컴퓨터비전", graphics: "그래픽스", hci: "HCI", systems: "시스템", stats: "통계" };

  // ---------- 데이터 ----------
  let commonP = null;
  function loadCommon() {
    commonP ??= (async () => {
      const related = await getJson("data/related-papers.json"); // 연구 주제(common.json)는 9/30 화면에서 삭제
      return { related: related || {} };
    })();
    return commonP;
  }
  let graphP = null;
  function loadGraph() {
    graphP ??= getJson("data/study/graph.json").then((g) => { if (g) g.byId = Object.fromEntries(g.concepts.map((c) => [c.id, c])); return g; });
    return graphP;
  }
  const cardCache = {}, pathCache = {};
  const fetchConcept = (id) => (cardCache[id] ??= getJson(`data/study/concepts/${id}.json`));
  const fetchPath = (pid) => (pathCache[pid] ??= getJson(`data/study/paths/${pid}.json`));
  // 개념 → 그 개념이 학습 경로에 들어 있는 논문들 (역색인). 모든 경로를 한 번만 읽음
  let usersP = null;
  function conceptUsers(paperIds) {
    usersP ??= Promise.all(paperIds.map(async (id) => [id, await fetchPath(id)])).then((list) => {
      const m = {};
      for (const [id, p] of list) for (const s of p?.path || []) (m[s.concept] ??= []).push({ paperId: id, role: s.role, core: (p.core || []).includes(s.concept) });
      return m;
    });
    return usersP;
  }

  // ---------- HTML 조각 ----------
  const lvBadge = (c) => `<span class="lv lv${c.level}">L${c.level} ${LEVEL[c.level]}</span>`;
  const conceptBtn = (g, id, extra = "") => { const c = g.byId[id]; return c ? `<button class="chip" data-concept="${esc(id)}">${lvBadge(c)} ${esc(c.name)}${extra}</button>` : ""; };
  // 참고 자료: 모델이 [제목](주소) 꼴로 쓰기도 해서 링크로 바꿈
  const refHtml = (r) => {
    const m = String(r.title).match(/^\[(.+?)\]\((https?:[^)\s]+)\)$/);
    const title = m ? `<a href="${esc(m[2])}" target="_blank" rel="noopener">${esc(m[1])}</a>` : esc(r.title);
    return `<li>${title} — ${esc(r.source)} <span class="where">${esc(r.where)}</span></li>`;
  };

  // 개념 카드 한 장. ctx: { role(이 논문에서 하는 일), paperId(지금 논문), users(역색인), paperTitle(id→제목) }
  async function conceptHtml(id, ctx = {}) {
    const g = await loadGraph(), c = g?.byId[id];
    if (!c) return "<p>(개념 정보 없음)</p>";
    const rec = await fetchConcept(id), k = rec?.card;
    const pre = c.prerequisites.map((p) => conceptBtn(g, p)).join("") || `<span class="where">없음 — 가장 아래 기초입니다</span>`;
    const apps = (c.applications || []).map((p) => conceptBtn(g, p)).join("") || `<span class="where">(가장 위 단계)</span>`;
    const users = (ctx.users?.[id] || []).filter((u) => u.paperId !== ctx.paperId);
    // 학습 단계 (사용자 결정 2026-09-29): ① 왜 → ② 직관 → ③ 정의·식 → ④ 핵심 → ⑤ 풀어 보기(문제마다 한 화면) → ⑥ 연결
    // 상세 창(index.html)이 section.stage 단위로 한 화면씩 보여 주고, 위에 단계 표시를 그린다
    const stage = (n, label, body) => `<section class="stage" data-stage="${n}" data-label="${label}">${body}</section>`;
    const s1 = stage(1, "왜", `
      <div class="cmeta">${lvBadge(c)} <span class="field">${esc(FIELD[c.field] || c.field)}</span> <span class="en">${esc(c.english)}</span></div>
      <p class="lead">${esc(c.one_line)}</p>
      ${ctx.role ? `<div class="goal"><b>이 논문에서</b> ${esc(ctx.role)}</div>` : ""}
      <h4>먼저 알아야 할 개념</h4><div class="chips">${pre}</div>`);
    const links = `
      <h4>이 개념 위에 쌓이는 개념</h4><div class="chips">${apps}</div>
      ${users.length ? `<h4>이 개념을 쓰는 교수님 논문</h4><ul class="plist">${users.slice(0, 8).map((u) => `<li><button class="plink" data-paper="${esc(u.paperId)}">${esc(ctx.paperTitle?.(u.paperId) || u.paperId)}</button><div class="where">${esc(u.role)}</div></li>`).join("")}</ul>` : ""}`;
    if (!k) return s1 + stage(6, "연결", `<p class="where">이 개념의 카드는 아직 생성 중입니다.</p>` + links);
    // 2026-09-30 (사용자 지적 "너무 획일화"): 식은 그 개념에 꼭 필요할 때만. 식이 없는 개념은 ③이 "정의·구조"(구성 요소·동작 흐름)
    const f = k.formula?.latex ? k.formula : null, st = k.structure;
    const formulaHtml = f ? `<h4>핵심 식</h4><div class="eq">${tex(f.latex, true)}</div>
          <ul class="vars">${(f.symbols || []).map((v) => `<li>${tex(v.symbol, false)} ${rich(v.meaning)}</li>`).join("")}</ul>
          ${f.reading ? `<p class="reading">${rich(f.reading)}</p>` : ""}` : "";
    const structureHtml = st ? `<h4>구성과 흐름</h4><ul class="parts">${(st.parts || []).map((p) => `<li><b>${rich(p.name)}</b> ${rich(p.role)}</li>`).join("")}</ul>
          ${st.flow ? `<p class="flow">${rich(st.flow)}</p>` : ""}` : "";
    // ⑤ 문제: calc = 먼저 풀고 풀이 보기, choice = 보기를 핀치로 고르면 정답·해설 (예전 카드는 kind가 없으므로 calc)
    const circled = (j) => String.fromCharCode(0x2460 + j);
    const practiceHtml = (p, i, all) => p.kind === "choice" && p.choices?.length ? `
        <div class="check"><h4>풀어 보기 ${i + 1} / ${all.length}</h4><div class="q">${rich(p.question)}</div>
          <div class="choices" data-answer="${p.answer}">${p.choices.map((c, j) => `<button class="btn choice" data-choice="${j}">${circled(j)} ${rich(c)}</button>`).join("")}</div>
          <div class="a" hidden>${rich(p.solution)}</div></div>` : `
        <div class="check"><h4>풀어 보기 ${i + 1} / ${all.length}</h4><div class="q">${rich(p.question)}</div>
          <p class="where">먼저 스스로 풀어 본 뒤 확인하세요.</p>
          <button class="btn reveal" data-reveal>풀이 보기</button><div class="a" hidden>${rich(p.solution)}</div></div>`;
    return s1
      + stage(2, "직관", `<h4>직관</h4><p class="lead">${rich(k.intuition)}</p>`)
      + stage(3, f ? "정의·식" : "정의·구조", `<h4>정의</h4><p>${rich(k.definition)}</p>${formulaHtml}${structureHtml}`)
      + stage(4, "핵심", `<h4>꼭 기억할 점</h4><ul>${(k.key_points || []).map((x) => `<li>${rich(x)}</li>`).join("")}</ul>`)
      + stage(5, "풀어 보기", (k.practice || []).map(practiceHtml).join(""))
      + stage(6, "연결", `
        ${k.code?.snippet ? `<h4>코드로 확인 (Python)</h4><pre class="code">${esc(k.code.snippet)}</pre><p class="where">${esc(k.code.what_it_shows)}</p>` : ""}
        ${k.used_in_lab ? `<div class="goal"><b>이 연구실에서</b> ${esc(k.used_in_lab)}</div>` : ""}
        ${k.references?.length ? `<h4>더 공부할 자료</h4><ul class="refs">${k.references.map(refHtml).join("")}</ul>` : ""}` + links);
  }

  // 논문 요약: 문제 · 방법 · 결과 · 의미 + 중심 개념 + 원문 링크 + 초록 원문 (10/1 사용자 "요약이 너무 간단, 원문 링크가 접근 제한")
  // 원문은 무료 PDF → 저장소 사본 → 출판사 페이지 순 (DOI는 출판사로 가서 학교 밖에서는 막히는 경우가 많음)
  const BRIEF = [["problem", "문제"], ["method", "방법"], ["result", "결과"], ["meaning", "의미"]];
  async function summaryHtml(paper, path) {
    const g = await loadGraph();
    const b = path?.brief;
    const brief = b
      ? `<dl class="brief">${BRIEF.filter(([k]) => b[k]?.trim()).map(([k, name]) => `<dt>${name}</dt><dd>${esc(b[k])}</dd>`).join("")}</dl>
         ${b.from_title ? `<p class="where">초록을 찾지 못해 제목만으로 만든 요약입니다.</p>` : ""}`
      : `<p class="lead">${esc(path?.summary || "(학습 경로 생성 중)")}</p>`;
    const links = [
      paper.pdf_url && ["무료 PDF", paper.pdf_url],
      paper.repo_url && ["저장소 사본 (무료)", paper.repo_url],
      paper.url && [paper.is_oa ? "출판사 페이지 (무료 공개)" : "출판사 페이지 (학교 로그인이 필요할 수 있음)", paper.url],
    ].filter(Boolean);
    // 초록은 두 문장씩 나눠 둠: 한 덩어리가 창보다 길면 쪽 나누기가 못 자르고 잘림
    const sents = (paper.abstract || "").replace(/^\s*abstract[\s:.]+/i, "").split(/(?<=[.!?])\s+(?=[A-Z0-9(])/).filter(Boolean);
    const abs = Array.from({ length: Math.ceil(sents.length / 2) }, (_, i) => `<p class="abs">${esc(sents.slice(i * 2, i * 2 + 2).join(" "))}</p>`).join("");
    return `
      <div class="cmeta"><span class="field">${esc(paper.year ?? "-")} · ${esc(paper.venue || "-")} · 인용 ${esc(paper.cited ?? 0)}</span></div>
      ${brief}
      ${path?.core?.length ? `<h4>이 논문의 중심 개념</h4><div class="chips">${path.core.map((id) => conceptBtn(g, id)).join("")}</div>` : ""}
      ${links.length ? `<h4>원문</h4><div class="chips">${links.map(([name, url]) => `<a class="chip olink" href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>`).join("")}</div>` : ""}
      <p class="where">다음 ▶ 으로 학습 경로 → 개념 카드 순서로 넘어갑니다.</p>
      <h4>초록 원문</h4>${abs || `<p class="where">초록 없음 (OpenAlex · Semantic Scholar · Crossref)</p>`}`;
  }
  // top-down 순서 (사용자 정의 "상위 계층부터 학습하고 기초 개념으로 내려가는 학습", 2026-09-30):
  // 저장된 경로는 선수 개념이 앞(기초 → 연구 기법)이라 뒤집고, 수준 L3 → L2 → L1으로 정렬. 선수 개념은 항상 같거나 낮은 수준이라
  // 이 순서면 어떤 개념도 그 선수 개념보다 먼저 나온다. 바닥 = L1(학부 1~2학년 기초)
  function topDown(path, g) {
    const list = (path?.path || []).filter((s) => g?.byId[s.concept]).reverse();
    return list.map((s, i) => [s, i]).sort((a, b) => g.byId[b[0].concept].level - g.byId[a[0].concept].level || a[1] - b[1]).map(([s]) => s);
  }
  // 학습 경로: 중심 개념(연구 기법)에서 기초까지. 전체 경로가 한 화면에 보이게 개념 이름만 두 줄로 (10/1 사용자 결정, 안 A).
  // 개념마다 "이 논문에서 하는 일"은 개념 카드 ① 왜(ctx.role)에 있으므로 여기서는 뺌
  async function pathHtml(path) {
    const g = await loadGraph();
    if (!path?.path?.length) return "<p>(학습 경로 생성 중)</p>";
    return `
      <p class="hintline">이 논문에서 시작해 필요한 개념으로 내려갑니다: 연구 기법(L3) → 전공(L2) → 기초(L1, 학부 1~2학년). 아는 개념은 건너뛰고, 막히는 개념에서 아래로 내려가세요. 개념을 누르면 카드로 갑니다.</p>
      <ol class="steps two">${topDown(path, g).map((s) => g.byId[s.concept] ? `<li>${conceptBtn(g, s.concept)}</li>` : "").join("")}</ol>`;
  }
  // 관련 논문: 같은 개념을 많이 공유하는 교수님 논문 + 웹 유사 논문
  async function relatedHtml(paper, path, ctx) {
    const common = await loadCommon();
    const mine = new Set((path?.path || []).map((s) => s.concept));
    const shared = {};
    for (const id of mine) for (const u of ctx.users?.[id] || []) if (u.paperId !== paper.id) shared[u.paperId] = (shared[u.paperId] || 0) + 1;
    const top = Object.entries(shared).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const web = common.related[paper.id]?.items || [];
    return `
      ${top.length ? `<h4>같은 개념을 많이 쓰는 교수님 논문</h4><ul class="plist">${top.map(([id, n]) => `<li><button class="plink" data-paper="${esc(id)}">${esc(ctx.paperTitle?.(id) || id)}</button><div class="where">공통 개념 ${n}개</div></li>`).join("")}</ul>` : ""}
      ${web.length ? `<h4>웹 유사 논문 (논문 DB)</h4><ul class="plist">${web.map((q) => `<li><a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.title)}</a><div class="where">${esc(q.year ?? "-")} · ${esc(q.venue || "-")} · 인용 ${esc(q.cited ?? 0)}</div></li>`).join("")}</ul>` : ""}`;
  }
  window.StudyPanel = { loadCommon, loadGraph, fetchConcept, fetchPath, conceptUsers, conceptHtml, summaryHtml, pathHtml, relatedHtml, topDown, esc, LEVEL, FIELD };
})();
