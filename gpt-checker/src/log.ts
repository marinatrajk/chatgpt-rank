import fs from "node:fs";
import path from "node:path";

let file: string | null = null;

/** From now on, also append every log line (with a timestamp) to this file. */
export function logToFile(p: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  file = p;
}

export function log(message: string): void {
  console.log(message);
  if (file) fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
}
