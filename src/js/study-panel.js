/* study-panel: 사전 생성된 학습 세트를 읽어 양피지 패널에 top-down 스텝으로 렌더.
 * 논문 팩: 1차 개요(5C) → 키워드 → 2차 이해 → 먼저 볼 공통 모듈 → 유사 논문(웹) → 3차 재구성
 * 공통 모듈: 개요 → 논문 키워드 → 사용 툴 → CS → 공학수학 → 역학 → 물리 → 부록: 피지컬 AI 동향
 * 데이터(모두 tools/ 스크립트가 미리 만듦):
 *   data/study/papers/<id>.json   논문 팩        data/study/common.json   모듈 목록
 *   data/study/modules/<id>.json  모듈 세트      data/study/trends.json   피지컬 AI 동향
 *   data/related-papers.json      웹 유사 논문
 * 근거: docs/01-topic-references.md §5, docs/09-how-it-works.md §9
 * 조작: 버튼은 마우스 클릭 또는 손 핀치(index.html 이 핀치 위치의 DOM 요소를 클릭해 줌). 버튼은 크게.
 */
(function () {
  const getJson = (u) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  // 논문 팩. 없으면 null (아직 생성 전)
  const packCache = {};
  function fetchPaperPack(id) {
    packCache[id] ??= getJson(`data/study/papers/${id}.json`);
    return packCache[id];
  }

  // 공통 세트·동향·유사 논문은 한 번만 읽어 둠. 없으면 빈 값
  let commonP = null;
  function loadCommon() {
    commonP ??= (async () => {
      const [index, trends, related] = await Promise.all([getJson("data/study/common.json"), getJson("data/study/trends.json"), getJson("data/related-papers.json")]);
      const modules = {};
      if (index) await Promise.all(index.modules.map(async (m) => { modules[m.id] = (await getJson(`data/study/modules/${m.id}.json`)) || { ...m, pack: null }; }));
      return { index, modules, trends, related: related || {} };
    })();
    return commonP;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const BLOOM = { remember: "기억", understand: "이해", apply: "적용", analyze: "분석" };
  const DISC = { physics: "물리", mechanics: "역학", engineering_math: "공학수학", math: "수학", physics_mechanics: "물리·역학", cs: "CS", statistics: "통계", signal_processing: "신호처리", domain: "분야 지식" };
  const LAYER = { cs: "CS", engineering_math: "공학수학", mechanics: "역학", physics: "물리" };
  const TOOL_CAT = { library: "라이브러리", framework: "프레임워크", engine: "엔진", hardware: "하드웨어", sensor: "센서", dataset: "데이터셋", platform: "플랫폼", method: "기법" };
  const list = (xs) => `<ul>${(xs || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;

  const cards = (l) => (l?.cards || []).map((c) => `
      <article class="scard" data-card="${esc(c.title)}">
        <div class="scard-head"><span class="disc">${esc(DISC[c.discipline] || c.discipline)}</span><h4>${esc(c.title)}</h4></div>
        <p>${esc(c.body)}</p>
        <div class="link">논문과의 연결: ${esc(c.links_to_paper)}</div>
        ${c.linked_keywords?.length ? `<div class="kw">${c.linked_keywords.map((k) => `<span>${esc(k)}</span>`).join("")}</div>` : ""}
        <div class="check">
          <div class="q"><b>확인 (${esc(BLOOM[c.check?.bloom] || c.check?.bloom)})</b> ${esc(c.check?.question)}</div>
          <button class="btn reveal" data-reveal>정답 보기</button>
          <div class="a" hidden>${esc(c.check?.answer)}${c.check?.if_wrong_go_to ? `<div class="back">틀렸다면 → "${esc(c.check.if_wrong_go_to)}" 카드로</div>` : ""}</div>
        </div>
        ${c.next_resource ? `<div class="next">다음 자료: ${esc(c.next_resource)}</div>` : ""}
      </article>`).join("");

  // 논문 팩 공통 앞부분(개요·키워드·2차 이해)과 뒷부분(재구성)
  function paperHead(p) {
    const o = p.pass1_overview || {}, f = o.five_c || {}, u = p.pass2_understanding || {};
    return [
      { key: "overview", label: "1차 개요", html: `
        <p class="lead">${esc(o.one_paragraph)}</p>
        <div class="goal">이 논문에서 얻어 갈 것: ${esc(o.reading_goal)}</div>
        <dl class="fivec">
          <dt>분류</dt><dd>${esc(f.category)}</dd>
          <dt>맥락</dt><dd>${esc(f.context)}</dd>
          <dt>기여</dt><dd>${list(f.contributions)}</dd>
          <dt>정확성</dt><dd>${esc(f.correctness)}</dd>
          <dt>명확성</dt><dd>${esc(f.clarity)}</dd>
        </dl>` },
      { key: "keywords", label: "키워드", html: `
        <ul class="kwlist">${(p.keywords || []).map((k) => `<li><b>${esc(k.term)}</b> <span class="where">${esc(k.where_in_paper)}</span><br>${esc(k.definition_one_line)}</li>`).join("")}</ul>` },
      { key: "understand", label: "2차 이해", html: `
        <h4>방법 흐름</h4><ol>${(u.method_flow || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
        <h4>주장과 근거</h4>${(u.key_evidence || []).map((e) => `<div class="ev"><b>${esc(e.claim)}</b><br>근거: ${esc(e.evidence)}${e.caveat ? `<br><span class="caveat">주의: ${esc(e.caveat)}</span>` : ""}</div>`).join("")}
        <h4>비판적으로 물어볼 것</h4>${list(u.critical_questions)}` },
    ];
  }
  function paperTail(p) {
    const r3 = p.pass3_reconstruct || {};
    return { key: "reconstruct", label: "3차 재구성", html: `
        <div class="goal">내 말로 다시 쓰기: ${esc(r3.restate_in_own_words_prompt)}</div>
        <h4>도전해 볼 가정</h4>${list(r3.assumptions_to_challenge)}
        <h4>재현하려면 필요한 것</h4>${list(r3.to_reproduce_you_need)}` };
  }

  function relatedStep(rel) {
    const items = rel?.items || [];
    if (!items.length) return { key: "related", label: "유사 논문", html: "<p>(수집된 유사 논문 없음)</p>" };
    return { key: "related", label: "유사 논문", html: `
      <p class="hintline">교수님 논문 밖에서 찾은 비슷한 연구입니다. 논문 추천 DB(Semantic Scholar 등)에서 가져온 실제 논문이며, AI가 만든 목록이 아닙니다.</p>
      ${items.map((q) => `
        <div class="rel">
          <a href="${esc(q.url)}" target="_blank" rel="noopener"><b>${esc(q.title)}</b></a>
          <div class="where">${esc(q.year ?? "-")} · ${esc(q.venue || "-")} · 인용 ${esc(q.cited)}${q.pdf ? ` · <a href="${esc(q.pdf)}" target="_blank" rel="noopener">PDF</a>` : ""}</div>
          ${q.abstract ? `<details><summary>초록</summary><div class="abs">${esc(q.abstract)}</div></details>` : ""}
        </div>`).join("")}
      <div class="smeta">출처: ${[...new Set(items.map((q) => q.via))].map(esc).join(", ")} · ${esc(rel.fetched_at?.slice(0, 10) || "")}</div>` };
  }

  function buildPaperSteps(record, common) {
    const p = record.pack; // 레코드는 {paperId, title, model, via, generated_at, pack}
    const head = paperHead(p);
    const refs = (p.module_refs || []).map((r) => {
      const m = common.modules[r.module_id];
      return `
        <div class="mref">
          <div class="mref-title">${esc(m?.title || r.module_id)}</div>
          <p>${esc(r.why)}</p>
          ${r.focus_cards?.length ? `<div class="kw">먼저 볼 카드: ${r.focus_cards.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
          <button class="btn primary" data-module="${esc(r.module_id)}" data-focus="${esc(r.focus_cards?.[0] || "")}" ${m?.pack ? "" : "disabled"}>공통 모듈 열기 →</button>
        </div>`;
    }).join("");
    return [...head,
      { key: "modules", label: "공통 기초", html: `
        <p class="hintline">CS·공학수학·역학·물리와 사용 툴은 교수님 최근 논문들이 함께 쓰는 공통 모듈에 모아 두었습니다.</p>${refs || "<p>(연결된 모듈 없음)</p>"}` },
      relatedStep(common.related[record.paperId]),
      paperTail(p)];
  }

  function buildModuleSteps(mod, common) {
    const k = mod.pack || {};
    const papers = (mod.paper_ids || []).map((id) => common.paperTitle?.(id) || id);
    const byLevel = Object.fromEntries((k.layers || []).map((l) => [l.level, l]));
    const trends = (common.trends?.items || []);
    const mine = trends.filter((t) => t.related_modules?.includes(mod.id));
    const others = trends.filter((t) => !t.related_modules?.includes(mod.id));
    const trend = (t) => `
      <div class="ev">
        <b>${esc(t.title)}</b><br>${esc(t.summary)}
        <div class="goal">연구실과의 연결: ${esc(t.why_it_matters)}</div>
        <div class="where">${(t.sources || []).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.publisher || s.title)}</a> ${esc(s.date || "")}${s.ok === false ? " (링크 확인 안 됨)" : ""}`).join(" · ")}</div>
      </div>`;
    return [
      { key: "m-overview", label: "모듈 개요", html: `
        <p class="lead">${esc(k.intro)}</p>
        <h4>공부 순서</h4><ol>${(k.roadmap || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
        <h4>이 모듈로 읽히는 교수님 논문</h4>${list(papers)}` },
      { key: "m-keywords", label: "논문 키워드", html: `
        <ul class="kwlist">${(k.keywords || []).map((w) => `<li><b>${esc(w.term)}</b> <span class="where">${w.appears_in?.length || 0}편</span><br>${esc(w.definition_one_line)}</li>`).join("")}</ul>` },
      { key: "m-tools", label: "사용 툴", html: `
        <ul class="kwlist">${(k.tools || []).map((t) => `<li><b>${esc(t.name)}</b> <span class="where">${esc(TOOL_CAT[t.category] || t.category)} · ${t.evidence === "abstract" ? "초록에 명시" : "추정"}</span><br>${esc(t.what_for)}<br><span class="where">처음 해 볼 것: ${esc(t.first_step)}</span></li>`).join("")}</ul>` },
      ...["cs", "engineering_math", "mechanics", "physics"].map((lv) => ({ key: `m-${lv}`, label: LAYER[lv], html: cards(byLevel[lv]) || "<p>(없음)</p>" })),
      { key: "m-trends", label: "부록: 피지컬 AI 동향", html: `
        <p class="hintline">기초 학습 밖의 부록입니다. 웹 검색으로 모은 최근 동향이며, 출처 링크로 원문을 확인하세요.</p>
        ${mine.length ? `<h4>이 모듈과 이어지는 동향</h4>${mine.map(trend).join("")}` : ""}
        ${others.length ? `<h4>그 밖의 동향</h4>${others.map(trend).join("")}` : ""}
        ${trends.length ? "" : "<p>(아직 수집되지 않음)</p>"}` },
    ];
  }

  // 컨테이너 하나에 논문 팩 ↔ 공통 모듈 화면을 오감. 클릭 처리기는 하나만 (다시 그려도 중복되지 않게 onclick 사용)
  async function renderStudy(container, record, meta = {}) {
    const common = await loadCommon();
    common.paperTitle = meta.paperTitle;
    let view = { kind: "paper", steps: buildPaperSteps(record, common), i: 0 };
    let paperView = view;
    const genLine = (r) => `${r.via === "codex-cli" ? "Codex CLI · " : ""}${r.model || ""} · ${r.generated_at?.slice(0, 10) || ""}`;
    const metaLine = (v) => esc(v.kind === "paper" ? `논문 팩 · ${genLine(record)}` : `공통 세트 · ${genLine(v.mod)}`);

    const draw = (focus) => {
      const s = view.steps[view.i];
      container.innerHTML = `
        ${view.kind === "module" ? `<div class="mbar"><button class="btn" data-back>← 논문 학습 팩으로</button><span class="mname">공통 모듈 · ${esc(view.mod.title)}</span></div>` : ""}
        <div class="snav">
          <button class="btn" data-nav="-1" ${view.i === 0 ? "disabled" : ""}>← 이전</button>
          <div class="sdots">${view.steps.map((t, k) => `<button class="dot ${k === view.i ? "on" : ""}" data-go="${k}" title="${esc(t.label)}">${k + 1}</button>`).join("")}</div>
          <button class="btn" data-nav="1" ${view.i === view.steps.length - 1 ? "disabled" : ""}>다음 →</button>
        </div>
        <div class="stitle">${view.i + 1}/${view.steps.length} · ${esc(s.label)}</div>
        <div class="sbody">${s.html}</div>
        <div class="smeta">${metaLine(view)}</div>`;
      const target = focus && [...container.querySelectorAll("[data-card]")].find((el) => el.dataset.card === focus);
      if (target) { target.classList.add("focus"); target.scrollIntoView({ block: "start" }); }
      else container.closest("#preview")?.scrollTo?.({ top: container.offsetTop - 20 });
    };

    function openModule(id, focus) {
      const mod = common.modules[id];
      if (!mod?.pack) return;
      const steps = buildModuleSteps(mod, common);
      // 먼저 볼 카드가 있는 층으로 바로 이동
      const lv = focus && (mod.pack.layers || []).find((l) => l.cards.some((c) => c.title === focus))?.level;
      const i = lv ? Math.max(0, steps.findIndex((s) => s.key === `m-${lv}`)) : 0;
      view = { kind: "module", mod, steps, i };
      draw(focus);
    }

    container.onclick = (e) => {
      const nav = e.target.closest("[data-nav]"); if (nav && !nav.disabled) { view.i = Math.max(0, Math.min(view.steps.length - 1, view.i + Number(nav.dataset.nav))); draw(); return; }
      const go = e.target.closest("[data-go]"); if (go) { view.i = Number(go.dataset.go); draw(); return; }
      const mod = e.target.closest("[data-module]"); if (mod && !mod.disabled) { paperView = view.kind === "paper" ? view : paperView; openModule(mod.dataset.module, mod.dataset.focus); return; }
      if (e.target.closest("[data-back]")) { view = paperView; draw(); return; }
      const rev = e.target.closest("[data-reveal]"); if (rev) { const a = rev.nextElementSibling; a.hidden = !a.hidden; rev.textContent = a.hidden ? "정답 보기" : "정답 가리기"; }
    };
    draw();
    return { goto: (k) => { view.i = k; draw(); }, openModule };
  }

  window.StudyPanel = { fetchPaperPack, renderStudy, loadCommon };
})();
