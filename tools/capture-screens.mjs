// 발표자료(PPT)용 화면 캡처. Edge(또는 Chrome)를 헤드리스로 띄워 DevTools 프로토콜로 조종 → 1600×900 PNG.
// 설치할 것 없음: Node 18+의 fetch와 Node 22+의 WebSocket만 씀.
// 사용:
//   node tools/capture-screens.mjs                   지금 앱(http://localhost:5173)의 단계별 화면 → evidence/screens/<오늘>/
//   node tools/capture-screens.mjs --history         git 기록 속 이전 버전들의 첫 화면 → evidence/screens/history/
//   공통: [--url http://localhost:5173/] [--out 폴더] [--w 1600] [--h 900]
// 이전 버전은 git archive로 임시 폴더에 풀고 npx serve로 따로 띄워 찍는다 (작업 폴더는 건드리지 않음).

import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/codex.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const opt = parseArgs(process.argv.slice(2), { url: "http://localhost:5173/", w: 1600, h: 900, out: null, history: false });
const W = Number(opt.w), H = Number(opt.h);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

function findBrowser() {
  const c = [
    process.env.BROWSER_BIN,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].filter(Boolean);
  const hit = c.find((p) => existsSync(p));
  if (!hit) throw new Error("Edge/Chrome을 찾지 못함 (BROWSER_BIN 환경변수로 지정)");
  return hit;
}

// DevTools 프로토콜: 요청 id로 응답을 짝지음
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data);
    // 페이지 안의 예외·console.error를 터미널에 그대로 보여 줌 (캡처가 이상할 때 원인 확인용)
    if (d.method === "Runtime.exceptionThrown") console.log("  [페이지 예외]", d.params.exceptionDetails?.exception?.description?.split("\n").slice(0, 3).join(" | "));
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") console.log("  [console.error]", d.params.args?.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(`${p.method}: ${d.error.message} ${JSON.stringify(p.params).slice(0, 120)}`)) : p.res(d.result); } };
  const ready = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej, method, params }); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ready, send, close: () => ws.close() };
}

async function openBrowser() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = await mkdtemp(path.join(os.tmpdir(), "capture-"));
  const proc = spawn(findBrowser(), [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank",
  ], { stdio: "ignore" });
  let page;
  for (let i = 0; i < 50 && !page; i++) { await sleep(200); try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} }
  if (!page) throw new Error("브라우저 연결 실패");
  const c = cdp(page.webSocketDebuggerUrl); await c.ready;
  await c.send("Page.enable"); await c.send("Runtime.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const api = {
    async go(url, waitMs = 6000) { await c.send("Page.navigate", { url }); await sleep(waitMs); },
    async js(expr) { const r = await c.send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "스크립트 오류"); return r.result.value; },
    async move(x, y) { await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await sleep(250); },
    async click(x, y) { await api.move(x, y); await sleep(350); for (const type of ["mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); await sleep(900); },
    // 잡고 끌기: 누른 채 steps번에 나눠 이동 (놓지 않음). 놓기는 release()
    async press(x, y, wait = 300) { await api.move(x, y); await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 }); await sleep(wait); },
    async dragTo(x0, y0, x1, y1, steps = 12) { for (let i = 1; i <= steps; i++) { const t = i / steps; await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, button: "left", buttons: 1 }); await sleep(60); } await sleep(700); },
    async release(x, y) { await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 }); await sleep(1200); },
    async shot(file) { const r = await c.send("Page.captureScreenshot", { format: "png" }); await writeFile(file, Buffer.from(r.data, "base64")); console.log("  ✓", path.relative(ROOT, file)); },
    async close() { c.close(); proc.kill(); await sleep(500); await rm(profile, { recursive: true, force: true }).catch(() => {}); },
  };
  return api;
}

// 3D 물체의 화면 좌표 (페이지 안에서 계산)
const screenOf = (expr) => `const el = ${expr}; const v = el.object3D.getWorldPosition(new THREE.Vector3()).project(document.querySelector("a-scene").camera); return [Math.round((v.x + 1) / 2 * innerWidth), Math.round((1 - v.y) / 2 * innerHeight)];`;

// ---------- 지금 앱: 사용 흐름 순서대로 ----------
async function captureCurrent(b, out) {
  const H_ = `document.getElementById("hud").components.hud`;
  const SAMPLE = "W7211953241"; // 학습 경로가 있는 논문 (없으면 첫 논문)
  await b.go(opt.url, 3000);
  await b.js(`for (let k = 0; k < 80 && !document.getElementById("hud")?.components?.hud?.ready; k++) await new Promise(r => setTimeout(r, 250));`); // HUD 준비될 때까지 (페이지가 늦게 떠도)
  await sleep(2500);
  await b.shot(path.join(out, "01-첫화면-논문-은하.png"));
  // 은하 돌리기 (손 = 초기 화면에서 편 손 좌우, 마우스·키보드 대체 = 휠·← 키) → 조준 카드에 다른 논문
  const G_ = `document.getElementById("galaxy").components["paper-galaxy"]`;
  await b.js(`${G_}.focusPaper("${SAMPLE}");`); await sleep(1500);
  await b.shot(path.join(out, "02-은하-돌려-조준-카드.png"));
  // 조준 카드 핀치 = 논문 선택만. 핀치 순간: 카드가 번쩍이고 커서 자리에 파문 (press-feedback)
  const card = await b.js(`${screenOf('document.getElementById("focus-card")')}`);
  await b.press(card[0], card[1], 90);
  await b.shot(path.join(out, "02b-핀치-순간-피드백.png"));
  await b.release(card[0], card[1]); await sleep(1200);
  await b.move(W - 5, 5); await sleep(800);
  await b.shot(path.join(out, "03-논문-선택-빛줄기.png"));
  // 층 펼치기: 손 = 손바닥 펴기, 마우스 = 선택된 카드를 한 번 더 클릭 → 가운데 층이 먼저, 0.9초 뒤 좌우 패널
  await b.move(W - 5, 5); await b.js(`${H_}.openStack();`); await sleep(350); // 선택된 카드 한 번 더 핀치·손바닥과 같은 함수 (release의 대기 1.2초 없이 중간을 찍으려고)
  await b.shot(path.join(out, "03a-층-먼저-펼쳐짐.png"));
  await sleep(1600);
  await b.shot(path.join(out, "03b-층-구조-펼침.png"));
  // 층 돌리기 (손 = 펼쳐진 동안 편 손 좌우. 마우스에는 없어 같은 상태를 직접 지정)
  await b.js(`${H_}.stack().yawTarget = 0.45;`); await sleep(900);
  await b.shot(path.join(out, "03c-층-구조-회전.png"));
  await b.js(`${H_}.stack().yawTarget = 0;`); await sleep(700);
  const node = await b.js(`const n = [...document.querySelectorAll('#stack [concept-node]')].find(e => e.getAttribute('concept-node').level === 1); ${screenOf("n")}`);
  await b.move(node[0], node[1]); await sleep(700);
  await b.shot(path.join(out, "03d-기초-개념-가리키기.png"));
  const panel = async (key) => b.js(`const it = ${H_}.paperFan.items.find(i => i.key === "${key}"); ${screenOf("it.el")}`);
  let p = await panel("path"); await b.click(p[0], p[1]); await sleep(1200);
  await b.shot(path.join(out, "04-상세-학습-경로.png"));
  // 개념 카드: 학습 단계 ① 왜 → ② 직관 → ③ 정의·식(또는 정의·구조) → ④ 핵심 → ⑤ 풀어 보기 → ⑥ 연결을 한 장씩
  await b.js(`[...document.querySelectorAll('#dBody .page:not([hidden]) [data-concept]')][3]?.click();`); await sleep(1800);
  const stages = ["1-왜", "2-직관", "3-정의", "4-핵심", "5-풀어보기", "6-연결"];
  for (let i = 0; i < stages.length; i++) {
    await b.shot(path.join(out, `05-개념카드-단계${stages[i]}.png`));
    // ⑤: 보기 고르기 문제면 첫 보기를 눌러 정답·해설, 계산 문제면 풀이 보기
    if (i === 4) { await b.js(`const pg = document.querySelector('#dBody .page:not([hidden])'); (pg?.querySelector('[data-choice]') || pg?.querySelector('[data-reveal]'))?.click();`); await sleep(600); await b.shot(path.join(out, `05-개념카드-단계5-답-확인.png`)); }
    // 같은 단계 안의 다음 화면(문제 2 등)은 건너뛰고 다음 단계로
    await b.js(`const now = document.querySelector('#dSteps .now')?.textContent; for (let k = 0; k < 8; k++) { document.querySelector('[data-dnav="1"]').click(); await new Promise(r => setTimeout(r, 150)); if (document.querySelector('#dSteps .now')?.textContent !== now) break; }`);
    await sleep(600);
  }
  await b.js(`document.querySelector('[data-dback]').click();`); await sleep(1000);
  p = await panel("concepts"); await b.click(p[0], p[1]); await sleep(1500);
  await b.shot(path.join(out, "07-상세-필요한-개념.png"));
  // 식이 없는 개념(구조 + 보기 고르기) 예: 네트워크 통신 기초
  await b.js(`const h = ${H_}; h.openConcept("network-communication-basics");`); await sleep(1500);
  const toStage = (name) => b.js(`for (let k = 0; k < 12 && !(document.querySelector('#dSteps .now')?.textContent || '').includes('${name}'); k++) { document.querySelector('[data-dnav="1"]').click(); await new Promise(r => setTimeout(r, 200)); }`);
  await toStage("정의"); await sleep(800);
  await b.shot(path.join(out, "06-구조형-개념-정의·구조.png"));
  await toStage("풀어"); await sleep(600);
  await b.js(`document.querySelector('#dBody .page:not([hidden]) [data-choice="0"]')?.click();`); await sleep(700);
  await b.shot(path.join(out, "06-구조형-개념-보기-고르기.png"));
}

// ---------- git 기록 속 이전 버전들 (각 단계의 첫 화면) ----------
const HISTORY = [
  ["56ff82a", "01-손추적-테스트-구12개", "handtest"],
  ["8ea610a", "02-연도축-구-노드", ""],
  ["58c5897", "03-글래스-카드", ""],
  ["4c5ffd6", "04-서가-디자인", ""],
  ["113fc45", "05-서가-당기기원호-주먹", ""],
  ["3d67570", "06-서가-학습팩-마지막커밋", ""],
];
async function captureHistory(b, out) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "history-"));
  try {
    for (const [commit, name, page] of HISTORY) {
      const dir = path.join(tmp, commit);
      await mkdir(dir, { recursive: true });
      execFileSync("git", ["-c", "safe.directory=*", "-C", ROOT, "archive", "--format=tar", "-o", path.join(tmp, `${commit}.tar`), commit]);
      execFileSync("tar", ["-xf", `../${commit}.tar`], { cwd: dir }); // 상대 경로: "C:"를 원격 호스트로 읽는 tar 오류 회피
      const web = existsSync(path.join(dir, "source")) ? path.join(dir, "source") : path.join(dir, "src");
      const port = 5200 + HISTORY.findIndex((x) => x[0] === commit);
      const srv = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["--yes", "serve", "-l", String(port), web], { stdio: "ignore", shell: process.platform === "win32" });
      await sleep(3500);
      await b.go(`http://localhost:${port}/${page}`, 7000);
      await b.move(W / 2 + 40, H / 2 - 30); await sleep(800); // 무엇이든 가리켜 호버 상태가 보이게
      await b.shot(path.join(out, `${name}-${commit}.png`));
      srv.kill();
      if (process.platform === "win32") try { execFileSync("taskkill", ["/pid", String(srv.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
    }
  } finally { await rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

const out = opt.out ? path.resolve(opt.out) : path.join(ROOT, "evidence", "screens", opt.history ? "history" : today);
await mkdir(out, { recursive: true });
const b = await openBrowser();
try {
  console.log(`캡처 → ${path.relative(ROOT, out)} (${W}×${H})`);
  if (opt.history) await captureHistory(b, out); else await captureCurrent(b, out);
} finally { await b.close(); }
