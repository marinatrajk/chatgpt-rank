import { rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import type { BrowserContext, Page } from "playwright";
import { ask, CHATGPT_URL, firstPage, isChallenge, isLoggedIn, launch, resetSession, VIEWER_URL, waitForHuman, WallError } from "./chatgpt";
import { log, logToFile } from "./log";
import { findBrand } from "./match";
import { appendHistory, summaryTable, writeRunReport, writeSummary, type Result, type RunReport } from "./report";
import { SELECTORS } from "./selectors";

// In the container these are the /app/user-data and /app/data volumes.
const PROFILE_DIR = path.resolve("user-data");
const DATA_DIR = path.resolve("data");
const REPORTS_DIR = path.join(DATA_DIR, "reports");
const HISTORY_FILE = path.join(REPORTS_DIR, "history.csv");
const SUMMARY_FILE = path.join(DATA_DIR, "summary.md");

const MAX_PER_RUN = 10;
const DEFAULT_DELAY_S = 15;
const LOGIN_TIMEOUT_MS = 20 * 60_000;
const LOCK_FILE = path.join(PROFILE_DIR, ".gpt-checker.lock");
const LOCK_STALE_MS = 45 * 60_000; // longer than any run, so an older lock was left by a killed one

const USAGE = `Commands (npm run <command>):
  login     open ChatGPT so you can log in once at ${VIEWER_URL}; the session stays in user-data/
  check     ask every query in data/pairs.json (max ${MAX_PER_RUN}) and report where each brand appears
              -- --pairs <file>      another pairs file
              -- --delay <seconds>   pause between queries (default ${DEFAULT_DELAY_S})
              -- --keep-session      when logged out, keep ChatGPT's cookies and cache between queries
                                     (by default each query starts as a new visitor)
              -- --no-temporary      when logged in, use normal chats instead of Temporary Chat
              -- --events            also print progress as "@event {json}" lines, for the web app
  summary   rebuild data/summary.md from data/reports/history.csv
  inspect   print what the page looks like, for fixing selectors.ts
              -- --ask <question>    send one question first to see how answers are laid out`;

interface Pair {
  brand: string;
  variants: string[];
  query: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
const rel = (p: string) => path.relative(DATA_DIR, p);

/** YYYYMMDD-HHmmss in the container's time zone (set TZ in compose.yaml to change it). */
function runId(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function readPairs(file: string): Promise<Pair[]> {
  const raw: unknown = JSON.parse(await fs.readFile(file, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${file} must be a JSON array of { brand, variants, query }`);
  return raw.map((p, i) => {
    const ok =
      p &&
      typeof p.brand === "string" &&
      p.brand.trim() &&
      typeof p.query === "string" &&
      p.query.trim() &&
      (p.variants === undefined || (Array.isArray(p.variants) && p.variants.every((v: unknown) => typeof v === "string")));
    if (!ok) throw new Error(`${file}, item ${i + 1}: needs "brand" and "query" strings and an optional "variants" array of strings`);
    return { brand: p.brand.trim(), variants: p.variants ?? [], query: p.query.trim() };
  });
}

/**
 * One run at a time: runs share the browser profile, and launch() clears Chromium's own profile locks
 * (which a killed container leaves behind), so this lock is what keeps two runs apart.
 */
async function acquireLock(): Promise<void> {
  await fs.mkdir(PROFILE_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fs.writeFile(LOCK_FILE, JSON.stringify({ host: os.hostname(), pid: process.pid, startedAt: new Date() }), { flag: "wx" });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const stat = await fs.stat(LOCK_FILE).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs < LOCK_STALE_MS) {
        throw new Error(
          `Another run has been using the browser profile since ${stat.mtime.toISOString()}. ` +
            "Wait for it to finish, or delete user-data/.gpt-checker.lock if that run was killed.",
        );
      }
      await fs.rm(LOCK_FILE, { force: true }); // stale
    }
  }
  throw new Error("Couldn't take the run lock");
}

const releaseLock = () => rmSync(LOCK_FILE, { force: true });

async function withBrowser(fn: (context: BrowserContext) => Promise<void>) {
  await acquireLock();
  // Ctrl+C or `docker stop` would otherwise skip the finally blocks and leave the lock behind.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      releaseLock();
      process.exit(130);
    });
  }
  try {
    const context = await launch(PROFILE_DIR);
    try {
      await fn(context);
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    releaseLock();
  }
}

async function screenshot(page: Page, name: string): Promise<string | null> {
  const file = path.join(DATA_DIR, "screenshots", `${name}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  return page.screenshot({ path: file }).then(
    () => rel(file),
    () => null,
  );
}

async function login(context: BrowserContext) {
  const page = await firstPage(context);
  await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded" });
  console.log(`The browser is open. Go to ${VIEWER_URL}, log in to ChatGPT there (2FA included), then close the window.`);
  console.log("This also finishes by itself once you're logged in.");
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  for (;;) {
    if (context.pages().length === 0) {
      console.log("Browser closed.");
      break;
    }
    if (Date.now() > deadline) {
      console.log(`Not logged in after ${LOGIN_TIMEOUT_MS / 60_000} minutes. Run login again.`);
      process.exitCode = 1;
      break;
    }
    const current = context.pages().at(-1)!;
    if (current.url().startsWith(CHATGPT_URL) && !(await isChallenge(current)) && (await isLoggedIn(current))) {
      console.log("Logged in. The session is saved in user-data/. `npm run check` verifies it on every run.");
      await current.waitForTimeout(3000);
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function check(context: BrowserContext, argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      pairs: { type: "string", default: path.join(DATA_DIR, "pairs.json") },
      delay: { type: "string", default: String(DEFAULT_DELAY_S) },
      "keep-session": { type: "boolean", default: false },
      "no-temporary": { type: "boolean", default: false },
      events: { type: "boolean", default: false },
    },
  });
  // Machine-readable progress for the web app, on stdout only (not in run.log).
  const emit = (event: object) => {
    if (values.events) process.stdout.write(`@event ${JSON.stringify(event)}\n`);
  };
  logToFile(path.join(DATA_DIR, "run.log"));
  const started = new Date();
  const id = runId(started);
  const delayMs = Math.max(0, Number(values.delay) || 0) * 1000;

  let pairs = await readPairs(values.pairs);
  if (pairs.length > MAX_PER_RUN) {
    log(`${pairs.length} pairs in ${values.pairs}; checking the first ${MAX_PER_RUN} (the limit per run).`);
    pairs = pairs.slice(0, MAX_PER_RUN);
  }
  log(`Run ${id}: ${pairs.length} pairs. Watch it at ${VIEWER_URL}`);

  const run: RunReport = {
    runId: id,
    startedAt: started.toISOString(),
    finishedAt: "",
    loggedIn: false,
    freshSessions: false,
    stoppedEarly: null,
    results: [],
  };
  const blank = (pair: Pair, status: Result["status"], extra: Partial<Result> = {}): Result => ({
    timestamp: new Date().toISOString(),
    brand: pair.brand,
    query: pair.query,
    status,
    mentioned: null,
    variant: null,
    matchedText: null,
    matchKind: null,
    position: null,
    line: null,
    lines: null,
    sentence: null,
    mentions: 0,
    inAd: false,
    citations: [],
    model: null,
    durationS: null,
    transcript: null,
    screenshot: null,
    error: null,
    ...extra,
  });

  const page = await firstPage(context);
  await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const startShot = await screenshot(page, `${id}-start`);
  if (await isChallenge(page)) {
    run.stoppedEarly = `Verification check on chatgpt.com before the first query (screenshot ${startShot})`;
  } else {
    run.loggedIn = await isLoggedIn(page);
    log(run.loggedIn ? "Session check: logged in." : "Session check: NOT logged in, so answers come from logged-out ChatGPT.");
  }
  const temporary = run.loggedIn && !values["no-temporary"]; // Temporary Chat needs an account
  // Clearing ChatGPT's data before each query makes every query a first visit. It would also log out,
  // so logged-in runs keep the session and rely on Temporary Chat instead.
  run.freshSessions = !run.loggedIn && !values["keep-session"];
  if (run.freshSessions) log("Each query starts as a new visitor: ChatGPT's cookies, storage and cache are cleared first.");
  emit({ type: "started", runId: id, total: pairs.length, loggedIn: run.loggedIn, freshSessions: run.freshSessions });

  for (const [i, pair] of pairs.entries()) {
    if (run.stoppedEarly) {
      run.results.push(blank(pair, "skipped"));
      emit({ type: "query", index: i, result: run.results.at(-1) });
      continue;
    }
    const n = pad(i + 1);
    log(`[${n}/${pad(pairs.length)}] ${pair.brand} · ${pair.query}`);
    emit({ type: "query", index: i, running: true });
    try {
      if (run.freshSessions) await resetSession(page);
      const answer = await ask(page, pair.query, { temporary });
      const matches = findBrand(answer.text, pair.brand, pair.variants);
      const inAd = answer.ads ? findBrand(answer.ads, pair.brand, pair.variants).length > 0 : false;
      const citations = [...answer.sources, ...answer.links.map((l) => l.url)];

      const transcript = path.join(DATA_DIR, "transcripts", `${id}-${n}-${slug(pair.query)}.md`);
      await fs.mkdir(path.dirname(transcript), { recursive: true });
      await fs.writeFile(
        transcript,
        [
          `# ${pair.query}`,
          "",
          `Run ${id} · brand ${pair.brand} · ${run.loggedIn ? "logged in" : "logged out"} · model ${answer.model ?? "not shown"} · ${Math.round(answer.durationMs / 1000)}s`,
          "",
          answer.text,
          "",
          ...(answer.sources.length ? ["## Sources", "", ...answer.sources.map((s) => `- ${s}`), ""] : []),
          ...(answer.links.length ? ["## Links", "", ...answer.links.map((l) => `- [${l.text || l.url}](${l.url})`), ""] : []),
          ...(answer.ads ? ["## Ads shown with it", "", answer.ads, ""] : []),
        ].join("\n"),
      );

      const m = matches[0];
      run.results.push(
        blank(pair, "ok", {
          mentioned: matches.length > 0,
          variant: m?.variant ?? null,
          matchedText: m?.text ?? null,
          matchKind: m?.kind ?? null,
          position: m?.offset ?? null,
          line: m?.line ?? null,
          lines: m?.lines ?? null,
          sentence: m?.sentence ?? null,
          mentions: matches.length,
          inAd,
          citations,
          model: answer.model,
          durationS: Math.round(answer.durationMs / 1000),
          transcript: rel(transcript),
          screenshot: await screenshot(page, `${id}-${n}`),
        }),
      );
      log(m ? `  YES: "${m.text}" at line ${m.line} of ${m.lines}: ${m.sentence}` : `  NO${inAd ? " (only in an ad)" : ""}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const shot = await screenshot(page, `${id}-${n}-${err instanceof WallError ? "wall" : "error"}`);
      if (err instanceof WallError) {
        // Checks and limits don't go away by trying again: stop and report.
        run.stoppedEarly = `${message} (screenshot ${shot})`;
        run.results.push(blank(pair, "stopped", { error: message, screenshot: shot }));
        log(`  STOPPED: ${message}`);
      } else {
        run.results.push(blank(pair, "error", { error: message, screenshot: shot }));
        log(`  FAILED: ${message}`);
      }
    }
    emit({ type: "query", index: i, result: run.results.at(-1) });
    if (!run.stoppedEarly && i < pairs.length - 1) await page.waitForTimeout(delayMs);
  }

  run.finishedAt = new Date().toISOString();
  await writeRunReport(REPORTS_DIR, run);
  await appendHistory(HISTORY_FILE, run);
  await writeSummary(HISTORY_FILE, SUMMARY_FILE);
  log(`\n${summaryTable(run)}\n`);
  log(`Report: data/reports/report-${id}.json (.csv) · trend: data/summary.md`);
  emit({ type: "finished", runId: id, stoppedEarly: run.stoppedEarly });
  if (run.stoppedEarly) process.exitCode = 2;
}

async function inspect(context: BrowserContext, argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { ask: { type: "string" } } });
  const page = await firstPage(context);
  await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  if (values.ask) {
    await page.locator(SELECTORS.prompt).first().fill(values.ask);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(45_000);
  }
  const challenge = await isChallenge(page);
  const counts = Object.fromEntries(
    await Promise.all(
      Object.entries(SELECTORS)
        .filter(([k]) => k !== "completeAttribute")
        .map(async ([k, sel]) => [k, await page.locator(sel).count()] as const),
    ),
  );
  // No named functions inside page.evaluate: tsx wraps them in a __name() helper the page doesn't have.
  const structure = await page.evaluate(() => {
    const picked = [
      ...document.querySelectorAll(
        'textarea, [contenteditable="true"], [role="textbox"], input[type="text"], button[aria-label], button[data-testid]',
      ),
    ].map((e) => ({
      button: e.tagName === "BUTTON",
      text: [
        e.tagName.toLowerCase(),
        e.id && `#${e.id}`,
        ...[...e.attributes]
          .filter((a) => /^(data-|aria-label|role|placeholder|contenteditable|name)/.test(a.name))
          .map((a) => `[${a.name}="${a.value.slice(0, 40)}"]`),
      ]
        .filter(Boolean)
        .join(""),
    }));
    const transcript = document.querySelector("[data-conversation-transcript]");
    const inTranscript = new Map<string, string>();
    for (const e of transcript?.querySelectorAll("*") ?? []) {
      for (const a of e.attributes) {
        const key = `${e.tagName.toLowerCase()}[${a.name}]`;
        if ((a.name.startsWith("data-") || a.name === "role") && !inTranscript.has(key)) inTranscript.set(key, a.value.slice(0, 40));
      }
    }
    // Small elements ending in "+2" and the like: source pills.
    const pills = [...(transcript?.querySelectorAll<HTMLElement>("*") ?? [])]
      .filter((e) => /\S\s*\+\d+$/.test(e.innerText?.trim() ?? "") && e.innerText.length < 80)
      .slice(0, 4)
      .map((e) => e.outerHTML.slice(0, 600));
    return {
      transcriptText: (transcript as HTMLElement | null)?.innerText.slice(0, 1500) ?? null,
      transcriptAttributes: Object.fromEntries(inTranscript),
      pills,
      textboxes: picked.filter((p) => !p.button).map((p) => p.text),
      buttons: picked.filter((p) => p.button).map((p) => p.text).slice(0, 40),
    };
  });
  const shot = await screenshot(page, "inspect");
  console.log(
    JSON.stringify({ url: page.url(), title: await page.title(), challenge, loggedIn: !challenge && (await isLoggedIn(page)), selectors: counts, ...structure }, null, 2),
  );
  console.log(`Screenshot: data/${shot}`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "login") await withBrowser(login);
  else if (command === "check") await withBrowser((context) => check(context, rest));
  else if (command === "inspect") await withBrowser((context) => inspect(context, rest));
  else if (command === "summary") await writeSummary(HISTORY_FILE, SUMMARY_FILE).then(() => console.log(`Wrote ${rel(SUMMARY_FILE)}`));
  else {
    console.log(USAGE);
    if (command && command !== "help") process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
