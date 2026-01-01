import { GoogleGenerativeAI } from "@google/generative-ai";
// Import Request and Response types for Vercel Functions
import type { VercelRequest, VercelResponse } from '@vercel/node';

// This is the main change: We export a default function
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // We only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 1. Get the image from the request
    // Note: Vercel doesn't handle FormData well, so we expect a base64 string
    const { image, mimeType } = req.body;

    if (!image || !mimeType) {
      return res.status(400).json({ error: "No image or mimeType provided" });
    }

    // 2. Initialize Google AI
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Or gemini-2.5-flash

    // 3. Send to AI
    const prompt = `
      Analyze this equipment photo for a safety inspection app.
      Identify the equipment type.
      Provide a response in strictly VALID JSON format like this:
      {
        "equipmentName": "Name of equipment",
        "serialNumber": "Detected serial number or 'Unknown'",
        "safetyStatus": "Safe" or "Action Required",
        "issues": ["List of visible issues if any"]
      }
      Do not add markdown formatting. Just return raw JSON.
    `;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: image, // Already base64
          mimeType: mimeType,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();
    const data = JSON.parse(text.replace(/```json|```/g, "").trim());

    // 4. Send the successful response
    return res.status(200).json(data);

  } catch (error) {
    console.error("AI Error:", error);
    return res.status(500).json({ error: "Failed to analyze image" });
  }
}