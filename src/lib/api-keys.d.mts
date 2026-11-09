import type { ProviderId } from "./types";

export type ApiKeyEnv = "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "GEMINI_API_KEY";

export interface ApiKeyInfo {
  env: ApiKeyEnv;
  vendor: string;
  assistant: string;
  provider: ProviderId;
  url: string;
  required: boolean;
  purpose: string;
}

export interface KeyCheck {
  status: "valid" | "invalid" | "unknown";
  message?: string;
}

export const API_KEYS: readonly ApiKeyInfo[];
export const ENV_FILE: string;
export function cleanKey(raw: string): string;
export function keyFormatProblem(value: string): string | null;
export function checkKey(env: ApiKeyEnv, key: string): Promise<KeyCheck>;
export function setEnvValue(text: string, name: string, value: string): string;
export function readEnvFile(dir: string): Promise<string>;
export function saveEnvValues(dir: string, values: Record<string, string>): Promise<void>;
