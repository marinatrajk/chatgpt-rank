// Drives chatgpt.com in a real, visible browser (on the container's virtual screen) with a persistent
// profile. Nothing here disguises the automation or gets past verification checks or limits: `check`
// stops at them, and `login` waits for the person at the noVNC viewer.

import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { CHALLENGE_TITLE, SELECTORS, WALL_TEXT } from "./selectors";

export const CHATGPT_URL = "https://chatgpt.com/";
export const VIEWER_URL = process.env.VIEWER_URL ?? "http://localhost:6080/vnc.html?autoconnect=1&resize=scale";

const ANSWER_TIMEOUT_MS = 120_000;
const NO_START_MS = 60_000; // nothing streaming after this long: ChatGPT isn't going to answer
// Once the page marks the answer complete, the text must also hold still this long; with older markup
// that has no such mark, the answer counts as finished after STABLE_SECONDS without changes.
const SETTLE_SECONDS = 2;
const STABLE_SECONDS = 3;
const HUMAN_WAIT_MS = 10 * 60_000; // login only

/** ChatGPT put up a verification check or a limit. The run has to stop; retrying won't help. */
export class WallError extends Error {}

export interface ChatGPTAnswer {
  text: string; // the answer as shown, product cards included, in reading order
  ads: string; // ads shown with it, kept apart from the answer
  links: { url: string; text: string }[]; // product and shop links in the answer
  sources: string[]; // source pills under the answer, e.g. "Mayo Clinic +2"
  model: string | null; // when the page labels it
  durationMs: number;
}

export async function launch(profileDir: string): Promise<BrowserContext> {
  // Each container has a new hostname, so a container that was killed leaves a lock Chromium reads as
  // "profile in use on another computer". Runs use the profile one at a time, so clear stale locks.
  await fs.mkdir(profileDir, { recursive: true });
  await Promise.all(
    ["SingletonLock", "SingletonCookie", "SingletonSocket"].map((f) => fs.rm(path.join(profileDir, f), { force: true })),
  );
  return chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 860 },
    locale: "en-US",
  });
}

export async function firstPage(context: BrowserContext): Promise<Page> {
  return context.pages()[0] ?? (await context.newPage());
}

export async function isChallenge(page: Page): Promise<boolean> {
  if (CHALLENGE_TITLE.test(await page.title().catch(() => ""))) return true;
  return (await page.locator(SELECTORS.challengeFrame).count().catch(() => 0)) > 0;
}

/** Logged in = the page says so, or there's a composer and no "Log in" button. */
export async function isLoggedIn(page: Page): Promise<boolean> {
  const flag = await page.locator(SELECTORS.authFlag).first().getAttribute("data-authenticated").catch(() => null);
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  if (await page.locator(SELECTORS.profileButton).first().isVisible().catch(() => false)) return true;
  const composer = await page.locator(SELECTORS.prompt).first().isVisible().catch(() => false);
  const login = await page
    .locator(SELECTORS.loginButton)
    .or(page.getByRole("button", { name: /^log in$/i }))
    .first()
    .isVisible()
    .catch(() => false);
  return composer && !login;
}

/** For `login`: if a verification check is showing, wait for the person at the viewer to clear it. */
export async function waitForHuman(page: Page): Promise<void> {
  if (!(await isChallenge(page))) return;
  console.log(`ChatGPT is showing a verification check. Clear it yourself at ${VIEWER_URL}`);
  const deadline = Date.now() + HUMAN_WAIT_MS;
  while (await isChallenge(page)) {
    if (Date.now() > deadline) throw new Error(`Verification check not cleared within ${HUMAN_WAIT_MS / 60_000} minutes`);
    await page.waitForTimeout(3000);
  }
}

/**
 * Forgets everything chatgpt.com stored in this browser (cookies, local storage, IndexedDB, service
 * workers, cache), so the next visit arrives as a new visitor with nothing carried over. Logs out.
 */
export async function resetSession(page: Page): Promise<void> {
  const context = page.context();
  await context.clearCookies();
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send("Network.clearBrowserCache");
    for (const origin of ["https://chatgpt.com", "https://auth.openai.com"]) {
      await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    }
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Throws a WallError if a verification check or a limit message is showing. */
export async function assertNoWall(page: Page): Promise<void> {
  if (await isChallenge(page)) throw new WallError(`Verification check ("verify you're human") at ${page.url()}`);
}

/** A short line of whatever ChatGPT is telling us (limits, errors), for the report. */
async function pageNotice(page: Page): Promise<string | null> {
  return page
    .evaluate((wall) => {
      const alert = document.querySelector('[role="alert"]')?.textContent?.trim();
      if (alert) return alert.slice(0, 200);
      const line = document.body.innerText.split("\n").find((l) => new RegExp(wall, "i").test(l));
      return line?.trim().slice(0, 200) ?? null;
    }, WALL_TEXT.source)
    .catch(() => null);
}

// No named functions inside page.evaluate: tsx wraps them in a __name() helper the page doesn't have.
async function snapshot(page: Page, skip: number) {
  return page.evaluate(
    ({ sel, skip }) => {
      const nodes = [...document.querySelectorAll<HTMLElement>(sel.assistant)].slice(skip);
      const text = nodes
        .map((n) => n.innerText.replace(/^\s*ChatGPT said:\s*/i, "").trim())
        .filter(Boolean)
        .join("\n\n");
      const ads = [...document.querySelectorAll<HTMLElement>(sel.ads)]
        .map((n) => n.innerText.trim())
        .filter(Boolean)
        .join("\n\n");
      const links = nodes.flatMap((n) =>
        [...n.querySelectorAll<HTMLAnchorElement>("a[href^='http']")].map((a) => ({
          url: a.href,
          text: (a.textContent ?? "").trim(),
        })),
      );
      const sources = [
        ...new Set(
          nodes.flatMap((n) =>
            [...n.querySelectorAll<HTMLElement>(sel.sourcePill)].map((s) => s.innerText.replace(/\s+/g, " ").trim()),
          ),
        ),
      ].filter(Boolean);
      const complete = nodes.length > 0 && nodes.every((n) => n.hasAttribute(sel.completeAttribute));
      const marked = nodes.some((n) => n.matches(sel.assistantCurrent));
      const model = nodes.map((n) => n.getAttribute("data-message-model-slug")).filter(Boolean).pop() ?? null;
      return { count: nodes.length, text, ads, links, sources, complete, marked, model };
    },
    { sel: SELECTORS, skip },
  );
}

const SEND_ATTEMPTS = 3;
const SEND_CONFIRM_MS = 8000;

/**
 * Types the query and sends it, then checks it really went: until the page's scripts have taken over
 * the box (slow on a first visit, with nothing cached) the text sits there and Enter only adds a line.
 */
async function send(page: Page, query: string): Promise<void> {
  const prompt = page.locator(SELECTORS.prompt).first();
  const sent = await page.locator(SELECTORS.userMessage).count();
  for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt++) {
    await prompt.click();
    await prompt.fill(query);
    const button = page.locator(SELECTORS.send).first();
    if (await button.isVisible().catch(() => false)) await button.click().catch(() => {});
    else await page.keyboard.press("Enter");
    const deadline = Date.now() + SEND_CONFIRM_MS;
    while (Date.now() < deadline) {
      if ((await page.locator(SELECTORS.userMessage).count()) > sent) return;
      await page.waitForTimeout(500);
    }
  }
  throw new Error("The question couldn't be sent: ChatGPT's Send button didn't respond");
}

/**
 * Opens a fresh chat (never the previous thread), sends the query, waits for the answer to finish
 * streaming and reads it. Throws WallError for checks and limits, Error for anything else.
 */
export async function ask(page: Page, query: string, opts: { temporary: boolean }): Promise<ChatGPTAnswer> {
  await page.goto(opts.temporary ? `${CHATGPT_URL}?temporary-chat=true` : CHATGPT_URL, { waitUntil: "load" });
  await assertNoWall(page);

  const prompt = page.locator(SELECTORS.prompt).first();
  await prompt.waitFor({ state: "visible", timeout: 30_000 });
  const before = await page.locator(SELECTORS.assistant).count();

  await send(page, query);
  const started = Date.now();

  let last = "";
  let stable = 0;
  for (;;) {
    await page.waitForTimeout(1000);
    await assertNoWall(page);
    const elapsed = Date.now() - started;
    const snap = await snapshot(page, before);
    const streaming = await page.locator(SELECTORS.stop).first().isVisible().catch(() => false);

    if (snap.count === 0 && !streaming && elapsed > NO_START_MS) {
      const notice = await pageNotice(page);
      if (notice && WALL_TEXT.test(notice)) throw new WallError(notice);
      throw new Error(notice ?? "ChatGPT didn't start answering");
    }
    if (elapsed > ANSWER_TIMEOUT_MS) throw new Error(`No finished answer after ${ANSWER_TIMEOUT_MS / 1000}s`);

    stable = snap.text && !streaming && snap.text === last ? stable + 1 : 0;
    last = snap.text;
    const done = snap.marked ? snap.complete && stable >= SETTLE_SECONDS : stable >= STABLE_SECONDS;
    if (done) {
      const { text, ads, links, sources, model } = snap;
      return { text, ads, links, sources, model, durationMs: Date.now() - started };
    }
  }
}
