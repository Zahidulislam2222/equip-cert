import type { AIProvider, AIProviderType } from './types';
import { createGoogleProvider } from './google';
import { createOpenAIProvider } from './openai';
import { createAnthropicProvider } from './anthropic';

const providers: Record<AIProviderType, (apiKey: string, model: string) => AIProvider> = {
  google: createGoogleProvider,
  openai: createOpenAIProvider,
  anthropic: createAnthropicProvider,
};

export function createAIProvider(
  provider: AIProviderType,
  model: string,
  apiKey: string
): AIProvider {
  const factory = providers[provider];
  if (!factory) {
    throw new Error(`Unknown AI provider: ${provider}. Supported: ${Object.keys(providers).join(', ')}`);
  }
  return factory(apiKey, model);
}

export type { AIProvider, AIProviderType, EquipmentAnalysis } from './types';
