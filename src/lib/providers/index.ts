import type { ProviderId, ProviderStatus, Source } from "../types";
import { PROVIDER_LABELS } from "../types";
import { askChatGPT } from "./openai";
import { askClaude } from "./anthropic";
import { askGemini } from "./gemini";

export interface AskOptions {
  model: string;
  webSearch: boolean;
  country?: string;
}

export interface ProviderAnswer {
  text: string;
  model: string;
  sources: Source[];
  searchQueries: string[];
}

interface ProviderDef {
  envKey: string;
  modelEnv: string;
  defaultModel: string;
  ask: (query: string, opts: AskOptions) => Promise<ProviderAnswer>;
}

// Defaults aim at what each consumer app runs today; override them in .env.local.
const PROVIDERS: Record<ProviderId, ProviderDef> = {
  chatgpt: { envKey: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL", defaultModel: "gpt-6.1-sol", ask: askChatGPT },
  claude: { envKey: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL", defaultModel: "claude-opus-5-5", ask: askClaude },
  gemini: { envKey: "GEMINI_API_KEY", modelEnv: "GEMINI_MODEL", defaultModel: "gemini-3.8-flash", ask: askGemini },
};

export function providerModel(id: ProviderId): string {
  const def = PROVIDERS[id];
  return process.env[def.modelEnv] || def.defaultModel;
}

export function providerStatus(id: ProviderId): ProviderStatus {
  const def = PROVIDERS[id];
  return {
    id,
    label: PROVIDER_LABELS[id],
    model: providerModel(id),
    configured: Boolean(process.env[def.envKey]),
    envKey: def.envKey,
  };
}

export function ask(id: ProviderId, query: string, opts: Omit<AskOptions, "model">): Promise<ProviderAnswer> {
  return PROVIDERS[id].ask(query, { ...opts, model: providerModel(id) });
}
