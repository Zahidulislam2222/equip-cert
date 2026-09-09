import type { AIProvider, EquipmentAnalysis } from './types';
import { serverConfig } from '../config';
import { EQUIPMENT_ANALYSIS_PROMPT, parseAIResponse } from './prompt';

export function createAnthropicProvider(apiKey: string, model: string): AIProvider {
  return {
    async analyzeImage(base64: string, mimeType: string): Promise<EquipmentAnalysis> {
      const response = await fetch(serverConfig.ai.anthropic.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': serverConfig.ai.anthropic.version,
        },
        body: JSON.stringify({
          model,
          max_tokens: serverConfig.ai.maxTokens,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mimeType, data: base64 },
                },
                { type: 'text', text: EQUIPMENT_ANALYSIS_PROMPT },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.content?.[0]?.text || '';
      return parseAIResponse(text);
    },
  };
}
