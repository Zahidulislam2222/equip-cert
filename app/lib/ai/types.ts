export interface EquipmentAnalysis {
  equipmentName: string;
  serialNumber: string;
  safetyStatus: 'Safe' | 'Action Required';
  issues: string[];
}

export interface AIProvider {
  analyzeImage(base64: string, mimeType: string): Promise<EquipmentAnalysis>;
}

export type AIProviderType = 'google' | 'openai' | 'anthropic';
