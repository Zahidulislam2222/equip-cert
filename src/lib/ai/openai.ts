import OpenAI from 'openai';
import type { AIProvider, EquipmentAnalysis } from './types';
import { EQUIPMENT_ANALYSIS_PROMPT, parseAIResponse } from './prompt';

export function createOpenAIProvider(apiKey: string, model: string): AIProvider {
  const client = new OpenAI({ apiKey });

  return {
    async analyzeImage(base64: string, mimeType: string): Promise<EquipmentAnalysis> {
      const dataUrl = `data:${mimeType};base64,${base64}`;
      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: EQUIPMENT_ANALYSIS_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      });
      const text = response.choices[0]?.message?.content || '';
      return parseAIResponse(text);
    },
  };
}
