import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    // 1. Get the image from the request
    const formData = await req.formData();
    const file = formData.get("image") as File;

    if (!file) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    // 2. Prepare the file for Google Gemini
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Image = buffer.toString("base64");

    // 3. Initialize Google AI
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 4. Send to AI (The Prompt)
    const prompt = `
      Analyze this equipment photo for a safety inspection app.
      Identify the equipment type.
      Provide a response in strictly VALID JSON format like this:
      {
        "equipmentName": "Name of equipment",
        "serialNumber": "Detected serial number or 'Unknown'",
        "safetyStatus": "Safe" or "Action Required" (based on visual damage),
        "issues": ["List of visible issues if any"]
      }
      Do not add markdown formatting like \`\`\`json. Just return the raw JSON string.
    `;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Image,
          mimeType: file.type,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();

    // 5. Clean and parse the response
    const cleanedText = text.replace(/```json|```/g, "").trim();
    const data = JSON.parse(cleanedText);

    return NextResponse.json(data);

  } catch (error) {
    console.error("AI Error:", error);
    return NextResponse.json(
      { error: "Failed to analyze image" },
      { status: 500 }
    );
  }
}