// Codex CLI(`codex exec`)로 JSON 하나를 받아오는 공통 헬퍼. API 키 대신 ChatGPT 로그인을 씀.
// build-common-set.mjs(공통 세트)와 build-paper-packs.mjs(논문별 팩)가 같이 씀.

import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// 사용 모델 고정 (사용자 결정 2026-09-27): GPT-6-Luna. Luna는 추론 단계가 max까지라 ultra 대신 max.
// 바꾸려면 --model / --effort 또는 환경변수 CODEX_MODEL / CODEX_EFFORT
export const DEFAULT_MODEL = process.env.CODEX_MODEL || "gpt-6-luna";
export const DEFAULT_EFFORT = process.env.CODEX_EFFORT || "max";

// codex가 PATH에 없으면 Codex 데스크톱 앱에 들어 있는 CLI를 찾음
export function findCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const base = path.join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin");
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      const p = path.join(base, d, "codex.exe");
      if (existsSync(p)) return p;
    }
  }
  return "codex";
}

function spawnCodex(bin, args, stdin) {
  return new Promise((resolve, reject) => {
    const ch = spawn(bin, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let err = "";
    ch.stderr.on("data", (c) => { err += c; });
    ch.on("error", reject);
    ch.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`codex 종료 코드 ${code}: ${err.slice(-600)}`))));
    ch.stdin.end(stdin);
  });
}

// prompt → schema에 맞는 JSON. codex는 빈 임시 폴더에서 읽기 전용으로 실행 → 저장소를 읽거나 고치지 않음.
// search: true면 웹 검색 도구를 켬 (동향처럼 출처가 필요한 내용에만)
export async function codexJson({ prompt, schema, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, search = false, retries = 1, bin = findCodex() }) {
  const work = await mkdtemp(path.join(os.tmpdir(), "codex-json-"));
  try {
    const schemaPath = path.join(work, "schema.json"), out = path.join(work, "out.json");
    await writeFile(schemaPath, JSON.stringify(schema), "utf8");
    const args = [
      ...(search ? ["--search"] : []),
      "exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-C", work,
      "--output-schema", schemaPath, "-o", out, "--color", "never",
      "-c", "notify=[]", "-c", `model_reasoning_effort="${effort}"`,
      ...(model ? ["-m", model] : []),
      "-",
    ];
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await spawnCodex(bin, args, prompt);
        return JSON.parse(await readFile(out, "utf8"));
      } catch (e) {
        lastErr = e;
        // ChatGPT 요금제 사용 한도: 다시 해도 소용없으므로 바로 알림 (배치는 멈춤)
        const m = e.message.match(/usage limit[^\n]*?try again at ([^\n.]+)/i);
        if (m) { const err = new Error(`Codex 사용 한도 도달 — ${m[1]} 이후 다시 실행`); err.usageLimit = true; throw err; }
      }
    }
    throw lastErr;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// 작업 목록을 동시 n개로 처리. 사용 한도 오류가 나면 남은 작업을 멈춤
export async function pool(items, n, fn) {
  const queue = [...items];
  let stop = null;
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length && !stop) {
      try { await fn(queue.shift()); } catch (e) { if (e.usageLimit) stop = e; else throw e; }
    }
  }));
  if (stop) { console.error(`\n중단: ${stop.message}. 이미 만든 파일은 남아 있고, 같은 명령을 다시 실행하면 이어서 만듭니다.`); process.exitCode = 2; }
}

export function parseArgs(argv, defaults) {
  const o = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { (o._ ??= []).push(a); continue; }
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) o[k] = true;
    else { o[k] = next; i++; }
  }
  return o;
}
