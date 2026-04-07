import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AIProvider, EquipmentAnalysis } from './types';
import { EQUIPMENT_ANALYSIS_PROMPT, parseAIResponse } from './prompt';

export function createGoogleProvider(apiKey: string, model: string): AIProvider {
  const genAI = new GoogleGenerativeAI(apiKey);

  return {
    async analyzeImage(base64: string, mimeType: string): Promise<EquipmentAnalysis> {
      const aiModel = genAI.getGenerativeModel({ model });
      const result = await aiModel.generateContent([
        EQUIPMENT_ANALYSIS_PROMPT,
        { inlineData: { data: base64, mimeType } },
      ]);
      const response = await result.response;
      return parseAIResponse(response.text());
    },
  };
}
