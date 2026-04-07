import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAIProvider } from '../app/lib/ai/provider';
import type { AIProviderType } from '../app/lib/ai/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { image, mimeType } = req.body;

    if (!image || !mimeType) {
      return res.status(400).json({ error: 'No image or mimeType provided' });
    }

    // All config from env vars — zero hardcoding
    const provider = (process.env.AI_PROVIDER || 'google') as AIProviderType;
    const model = process.env.AI_MODEL_NAME || 'gemini-2.5-flash';
    const apiKey = process.env.AI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';

    if (!apiKey) {
      return res.status(500).json({ error: 'AI API key not configured' });
    }

    const ai = createAIProvider(provider, model, apiKey);
    const data = await ai.analyzeImage(image, mimeType);

    return res.status(200).json(data);
  } catch (error) {
    console.error('AI Error:', error);
    return res.status(500).json({ error: 'Failed to analyze image' });
  }
}
