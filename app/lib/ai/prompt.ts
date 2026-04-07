// Shared AI prompt — single source of truth for all providers
export const EQUIPMENT_ANALYSIS_PROMPT = `Analyze this equipment photo for a safety inspection app.
Identify the equipment type.
Provide a response in strictly VALID JSON format like this:
{
  "equipmentName": "Name of equipment",
  "serialNumber": "Detected serial number or 'Unknown'",
  "safetyStatus": "Safe" or "Action Required",
  "issues": ["List of visible issues if any"]
}
Do not add markdown formatting. Just return raw JSON.`;

export function parseAIResponse(text: string) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}
