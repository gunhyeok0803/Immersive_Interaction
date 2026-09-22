/* study-ui: 학습 팩(D6) 가져오기 + 양피지 패널에 top-down 스텝으로 렌더.
 * 흐름: 1차 개요(5C) → 키워드 → 2차 이해 → 배경지식 → 응용지식 → 기초과학 → 3차 재구성
 * 근거: docs/01-topic-references.md §5, docs/07-api-and-dev-plan.md §2.5
 * 조작: 버튼은 마우스 클릭 또는 손 핀치(index.html 이 핀치 위치의 DOM 요소를 클릭해 줌). 버튼은 크게.
 */
(function () {
  const LS_KEY = (id) => `study:${id}`;

  async function fetchStudyPack(paper, { endpoint, onStatus } = {}) {
    // 1) localStorage  2) 정적 캐시 data/study/<id>.json  3) 서버 POST /study
    try { const c = localStorage.getItem(LS_KEY(paper.id)); if (c) return { pack: JSON.parse(c), source: "local" }; } catch {}
    try {
      const r = await fetch(`data/study/${paper.id}.json`, { cache: "no-store" });
      if (r.ok) { const j = await r.json(); saveLocal(paper.id, j); return { pack: j, source: "static" }; }
    } catch {}
    if (!endpoint) throw new Error("학습 팩 서버 주소가 설정되지 않음");
    onStatus?.("AI가 학습 팩을 만드는 중… (20~40초)");
    const r = await fetch(endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ paperId: paper.id, title: paper.title, venue: paper.venue, year: paper.year, abstract: paper.abstract, level: "undergraduate" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `서버 오류 ${r.status}`);
    saveLocal(paper.id, j);
    return { pack: j, source: "server" };
  }
  function saveLocal(id, j) { try { localStorage.setItem(LS_KEY(id), JSON.stringify(j)); } catch {} }

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const BLOOM = { remember: "기억", understand: "이해", apply: "적용", analyze: "분석" };
  const DISC = { math: "수학", physics_mechanics: "물리·역학", cs: "CS", statistics: "통계", signal_processing: "신호처리", domain: "분야 지식" };

  function buildSteps(record) {
    const p = record.pack || record; // 서버 레코드는 {paperId, title, pack, usage, model, generated_at}
    const layers = Object.fromEntries((p.layers || []).map((l) => [l.level, l]));
    const cards = (l) => (l?.cards || []).map((c, i) => `
      <article class="scard">
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
    const o = p.pass1_overview || {}, f = o.five_c || {}, u = p.pass2_understanding || {}, r3 = p.pass3_reconstruct || {};
    return [
      { key: "overview", label: "1차 개요", html: `
        <p class="lead">${esc(o.one_paragraph)}</p>
        <div class="goal">이 논문에서 얻어 갈 것: ${esc(o.reading_goal)}</div>
        <dl class="fivec">
          <dt>분류</dt><dd>${esc(f.category)}</dd>
          <dt>맥락</dt><dd>${esc(f.context)}</dd>
          <dt>기여</dt><dd><ul>${(f.contributions || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></dd>
          <dt>정확성</dt><dd>${esc(f.correctness)}</dd>
          <dt>명확성</dt><dd>${esc(f.clarity)}</dd>
        </dl>` },
      { key: "keywords", label: "키워드", html: `
        <ul class="kwlist">${(p.keywords || []).map((k) => `<li><b>${esc(k.term)}</b> <span class="where">${esc(k.where_in_paper)}</span><br>${esc(k.definition_one_line)}</li>`).join("")}</ul>` },
      { key: "understand", label: "2차 이해", html: `
        <h4>방법 흐름</h4><ol>${(u.method_flow || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
        <h4>주장과 근거</h4>${(u.key_evidence || []).map((e) => `<div class="ev"><b>${esc(e.claim)}</b><br>근거: ${esc(e.evidence)}${e.caveat ? `<br><span class="caveat">주의: ${esc(e.caveat)}</span>` : ""}</div>`).join("")}
        <h4>비판적으로 물어볼 것</h4><ul>${(u.critical_questions || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` },
      { key: "background", label: "배경지식", html: cards(layers.background) || "<p>(없음)</p>" },
      { key: "applied", label: "응용지식", html: cards(layers.applied) || "<p>(없음)</p>" },
      { key: "foundation", label: "기초과학", html: cards(layers.foundation) || "<p>(없음)</p>" },
      { key: "reconstruct", label: "3차 재구성", html: `
        <div class="goal">내 말로 다시 쓰기: ${esc(r3.restate_in_own_words_prompt)}</div>
        <h4>도전해 볼 가정</h4><ul>${(r3.assumptions_to_challenge || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <h4>재현하려면 필요한 것</h4><ul>${(r3.to_reproduce_you_need || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` },
    ];
  }

  function renderStudy(container, pack, meta = {}) {
    const steps = buildSteps(pack);
    let i = 0;
    const draw = () => {
      const s = steps[i];
      container.innerHTML = `
        <div class="snav">
          <button class="btn" data-nav="-1" ${i === 0 ? "disabled" : ""}>← 이전</button>
          <div class="sdots">${steps.map((t, k) => `<button class="dot ${k === i ? "on" : ""}" data-go="${k}" title="${esc(t.label)}">${k + 1}</button>`).join("")}</div>
          <button class="btn" data-nav="1" ${i === steps.length - 1 ? "disabled" : ""}>다음 →</button>
        </div>
        <div class="stitle">${i + 1}/${steps.length} · ${esc(s.label)}</div>
        <div class="sbody">${s.html}</div>
        <div class="smeta">${meta.source === "server" ? "방금 생성" : meta.source === "static" ? "사전 생성본" : "저장본"} · ${esc(pack.model || "")} ${pack.generated_at ? "· " + pack.generated_at.slice(0, 10) : ""}</div>`;
      container.scrollTop = 0;
    };
    container.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-nav]"); if (nav && !nav.disabled) { i = Math.max(0, Math.min(steps.length - 1, i + Number(nav.dataset.nav))); draw(); return; }
      const go = e.target.closest("[data-go]"); if (go) { i = Number(go.dataset.go); draw(); return; }
      const rev = e.target.closest("[data-reveal]"); if (rev) { const a = rev.nextElementSibling; a.hidden = !a.hidden; rev.textContent = a.hidden ? "정답 보기" : "정답 가리기"; }
    });
    draw();
    return { goto: (k) => { i = k; draw(); } };
  }

  window.StudyUI = { fetchStudyPack, renderStudy };
})();
