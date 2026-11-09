// The API keys the app uses: what each one is for, where to get it, how to check it, and how it is
// saved in .env.local. Plain JavaScript so `npm run setup` can use it before `npm install`; the types
// are in api-keys.d.mts. Used by scripts/setup.mjs and the Settings page (src/app/api/settings).

import { promises as fs } from "node:fs";
import path from "node:path";

export const API_KEYS = [
  {
    env: "ANTHROPIC_API_KEY",
    vendor: "Anthropic",
    assistant: "Claude",
    provider: "claude",
    url: "https://platform.claude.com/settings/keys",
    required: true,
    purpose: "Asks Claude, and reads every assistant's answers to pull out the products, so the app needs it.",
  },
  {
    env: "OPENAI_API_KEY",
    vendor: "OpenAI",
    assistant: "ChatGPT",
    provider: "chatgpt",
    url: "https://platform.openai.com/api-keys",
    required: false,
    purpose: "Asks ChatGPT through the OpenAI API.",
  },
  {
    env: "GEMINI_API_KEY",
    vendor: "Google",
    assistant: "Gemini",
    provider: "gemini",
    url: "https://aistudio.google.com/apikey",
    required: false,
    purpose: "Asks Gemini through the Gemini API.",
  },
];

export const ENV_FILE = ".env.local";

/** Trims a pasted key and drops quotes around it. */
export function cleanKey(raw) {
  return raw.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
}

/** null when the value looks like an API key, otherwise what is wrong with it. */
export function keyFormatProblem(value) {
  if (!value) return "Paste a key.";
  if (/\s/.test(value)) return "A key has no spaces or line breaks. Paste just the key.";
  // Every vendor's keys use these characters. Anything else could break .env.local ($, #, quotes).
  if (!/^[A-Za-z0-9_.-]{20,}$/.test(value)) return "That doesn't look like an API key.";
  return null;
}

// A free, read-only request per vendor, and the HTTP statuses that mean "this key is wrong".
const CHECKS = {
  ANTHROPIC_API_KEY: (key) => ({
    url: "https://api.anthropic.com/v1/models?limit=1",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    invalid: [401],
  }),
  OPENAI_API_KEY: (key) => ({
    url: "https://api.openai.com/v1/models",
    headers: { authorization: `Bearer ${key}` },
    invalid: [401],
  }),
  GEMINI_API_KEY: (key) => ({
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    headers: { "x-goog-api-key": key },
    invalid: [400, 401],
  }),
};

/**
 * Asks the vendor whether the key works. "invalid": the vendor refused it. "unknown": we couldn't
 * tell (offline, vendor down, or a restricted key that may not list models but can still answer).
 */
export async function checkKey(env, key) {
  const info = API_KEYS.find((k) => k.env === env);
  const check = CHECKS[env];
  if (!info || !check) return { status: "unknown", message: `${env} isn't a key this app uses.` };
  const { url, headers, invalid } = check(key);
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (res.ok) return { status: "valid" };
    if (invalid.includes(res.status)) {
      return { status: "invalid", message: `${info.vendor} didn't accept this key. Copy it again from ${info.url}` };
    }
    return { status: "unknown", message: `${info.vendor} answered HTTP ${res.status}, so the key couldn't be fully checked.` };
  } catch {
    return { status: "unknown", message: `Couldn't reach ${info.vendor} to check the key.` };
  }
}

/**
 * Sets NAME=value in .env-style text. Replaces the active line for NAME, else a commented-out one
 * ("# NAME=…"), else appends a line. An empty value leaves "NAME=", which turns the key off.
 */
export function setEnvValue(text, name, value) {
  const line = `${name}=${value}`;
  const active = new RegExp(`^[ \\t]*${name}[ \\t]*=.*$`, "m");
  const commented = new RegExp(`^[ \\t]*#[ \\t]*${name}[ \\t]*=.*$`, "m");
  if (active.test(text)) return text.replace(active, () => line);
  if (commented.test(text)) return text.replace(commented, () => line);
  const sep = text === "" || text.endsWith("\n") ? "" : "\n";
  return `${text}${sep}${line}\n`;
}

/** .env.local in `dir`, or .env.example (the commented template) when there's no .env.local yet. */
export async function readEnvFile(dir) {
  for (const name of [ENV_FILE, ".env.example"]) {
    try {
      return await fs.readFile(path.join(dir, name), "utf8");
    } catch {
      // try the next one
    }
  }
  return "";
}

/** Writes the given NAME=value pairs into dir/.env.local, keeping everything else in the file. */
export async function saveEnvValues(dir, values) {
  let text = await readEnvFile(dir);
  for (const [name, value] of Object.entries(values)) text = setEnvValue(text, name, value);
  const file = path.join(dir, ENV_FILE);
  await fs.writeFile(file, text, { mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {}); // only you can read it (no-op on Windows)
}
