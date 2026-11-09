#!/usr/bin/env node
// `npm run setup`: checks Node, installs dependencies, checks Docker and builds the browser image the
// checks run in, asks for the optional OpenAI key (and checks it), then starts the app and opens it.
// Safe to run again: it keeps the key you already have unless you paste a new one.
// Uses only Node's standard library, so it works before `npm install`.
//
//   npm run setup               the whole thing
//   npm run setup -- --no-start set up, but don't start the app

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const MIN_NODE = [20, 9];
const DOCKER_URL = "https://www.docker.com/products/docker-desktop/";
const isWindows = process.platform === "win32";
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint(1);
const dim = paint(2);
const green = paint(32);
const red = paint(31);
const yellow = paint(33);
const ok = (msg) => console.log(`  ${green("✓")} ${msg}`);
const warn = (msg) => console.log(`  ${yellow("!")} ${msg}`);
const fail = (msg) => console.log(`  ${red("✗")} ${msg}`);
const step = (n, title) => console.log(`\n${bold(`${n}/4  ${title}`)}`);

console.log(`\n${bold("chatgpt-rank setup")}`);
console.log(dim("See whether ChatGPT recommends your brand. Press Ctrl+C to stop at any time."));

// ---------- 1. Node ----------

step(1, "Node.js");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
  fail(`You have Node ${process.versions.node}. chatgpt-rank needs ${MIN_NODE.join(".")} or newer.`);
  console.log(`    Install the LTS version from https://nodejs.org, open a new terminal, and run ${bold("npm run setup")} again.`);
  process.exit(1);
}
ok(`Node ${process.versions.node}`);

// ---------- 2. Dependencies ----------

step(2, "Dependencies");
const installed = "node_modules/.package-lock.json";
const upToDate = existsSync(installed) && statSync(installed).mtimeMs >= statSync("package-lock.json").mtimeMs;
if (upToDate) {
  ok("Already installed");
} else {
  console.log(dim("  Installing (a minute or two the first time)…"));
  const npm = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], {
    stdio: "inherit",
    shell: isWindows,
  });
  if (npm.status !== 0) {
    fail("npm install failed. The error is above.");
    process.exit(1);
  }
  ok("Installed");
}

// ---------- 3. Docker ----------

step(3, "Docker");
console.log(dim("  Each check runs a real browser on chatgpt.com inside Docker."));
let dockerReady = false;
const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8", timeout: 15_000 });
if (docker.error?.code === "ENOENT") {
  fail(`Docker isn't installed. Install Docker Desktop from ${DOCKER_URL}, start it, and run ${bold("npm run setup")} again.`);
} else if (docker.status !== 0) {
  fail(`Docker is installed but not running. Start Docker Desktop, then run ${bold("npm run setup")} again.`);
} else {
  ok(`Docker ${docker.stdout.trim()} is running`);
  console.log(dim("  Building the browser image (a few minutes and a large download the first time)…"));
  const build = spawnSync("docker", ["compose", "build", "--quiet"], {
    cwd: path.join(ROOT, "gpt-checker"),
    stdio: "inherit",
  });
  if (build.status === 0) {
    ok("Browser image ready");
    dockerReady = true;
  } else {
    fail("Building the browser image failed. The error is above.");
  }
}

// ---------- 4. OpenAI key (optional) ----------

const { API_KEYS, ENV_FILE, checkKey, cleanKey, keyFormatProblem, saveEnvValues } = await import(
  "../src/lib/api-keys.mjs"
);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
rl.on("SIGINT", () => {
  console.log("\n\nSetup stopped. Nothing else was changed.");
  process.exit(130);
});
// Lines are queued, so answers piped in all at once (e.g. in CI) aren't lost between questions.
const lines = [];
let waiting = null;
let closed = false;
rl.on("line", (line) => (waiting ? (waiting(line), (waiting = null)) : lines.push(line)));
rl.on("close", () => {
  closed = true;
  waiting?.(null);
  waiting = null;
});
// Keys are typed or pasted without echo, so they don't end up on a shared screen.
let muted = false;
const echo = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => {
  if (!muted) echo(s);
};

/** The next line typed, or null once input has ended. */
async function ask(question, { hidden = false } = {}) {
  process.stdout.write(question);
  muted = hidden && rl.terminal;
  const answer = lines.length ? lines.shift() : closed ? null : await new Promise((r) => (waiting = r));
  if (muted) process.stdout.write("\n");
  else if (!rl.terminal) process.stdout.write("\n");
  muted = false;
  return answer;
}

function currentValue(text, name) {
  const m = text.match(new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*(.*)$`, "m"));
  return m ? cleanKey(m[1].replace(/\s+#.*$/, "")) : "";
}

step(4, "OpenAI API key (optional)");
const envText = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const updates = {};

for (const key of API_KEYS) {
  const existing = currentValue(envText, key.env);
  console.log(`  ${key.purpose}`);
  console.log(`  Get a key: ${key.url}`);
  console.log(dim(`  Saved in ${ENV_FILE} on this computer only, and sent only to ${key.vendor}.`));
  if (process.env[key.env] && process.env[key.env] !== existing) {
    warn(`Your shell also sets ${key.env}; the app uses that one instead of ${ENV_FILE}.`);
  }

  for (;;) {
    const hint = existing ? `Enter keeps the saved key …${existing.slice(-4)}` : "Enter skips";
    const value = cleanKey((await ask(`  Paste key ${dim(`(hidden; ${hint})`)}: `, { hidden: true })) ?? "");
    if (!value) {
      if (existing) ok(`Keeping the saved key …${existing.slice(-4)}`);
      else console.log(dim("  Skipped. You'll write your own queries; add a key later on the Settings page."));
      break;
    }
    const problem = keyFormatProblem(value);
    if (problem) {
      fail(problem);
      continue;
    }
    process.stdout.write(dim(`  Checking with ${key.vendor}…`));
    const check = await checkKey(key.env, value);
    process.stdout.write(process.stdout.isTTY ? "\r\x1b[K" : "\n");
    if (check.status === "invalid") {
      fail(`${check.message}`);
      continue;
    }
    if (check.status === "unknown") warn(`${check.message} Saved it anyway.`);
    else ok(`Works (…${value.slice(-4)})`);
    updates[key.env] = value;
    break;
  }
}

if (Object.keys(updates).length > 0 || !existsSync(ENV_FILE)) {
  await saveEnvValues(ROOT, updates);
  ok(`Saved to ${ENV_FILE}`);
}

// ---------- Start ----------

console.log(
  dockerReady
    ? `\n${bold("All set.")}`
    : `\n${bold("Almost set.")} The app will open, but checks need Docker running (see step 3).`,
);

if (process.argv.includes("--no-start")) {
  console.log(`Start the app with ${bold("npm run dev")}, then open http://localhost:3000\n`);
  rl.close();
  process.exit(0);
}

// No answer because input ended (a script, not a person): don't start a server or open a browser.
const start = (await ask(`Start chatgpt-rank now? ${dim("[Y/n]")} `))?.trim().toLowerCase() ?? "n";
rl.close();
if (start === "n" || start === "no") {
  console.log(`\nStart it any time with ${bold("npm run dev")}, then open http://localhost:3000\n`);
  process.exit(0);
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

let port = 3000;
while (!(await portIsFree(port)) && port < 3020) port++;
const url = `http://localhost:${port}`;

console.log(`\nStarting on ${bold(url)} ${dim("(Ctrl+C stops it; next time just run npm run dev)")}\n`);
const dev = spawn("npm", ["run", "dev", "--", "-p", String(port)], { stdio: "inherit", shell: isWindows });
dev.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => {}); // Ctrl+C reaches the dev server, which exits; then so do we.

// Open the browser once the server answers.
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const up = await fetch(`http://127.0.0.1:${port}/api/settings`, { signal: AbortSignal.timeout(30_000) })
    .then(() => true)
    .catch(() => false);
  if (up) {
    const [cmd, args] = isWindows
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
    break;
  }
}
