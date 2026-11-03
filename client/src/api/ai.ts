import { http } from '../lib/http';
import { getSessionId } from '@/utils/session';
import type {
  SupportChatRequest,
  SupportChatResponse,
  AIStatusResponse,
  AICopywriterRequest,
  AICopywriterResponse,
  AITranslationRequest,
  AITranslationResponse,
  AITrendReport,
  AISelectResponse,
  AIUsageStats,
  AIUsageStatsQuery,
  AIReportSummary,
  AIReportDetail,
  AiSettingsView,
  AiSettingsTestResult,
  AgentListResult,
  CustomAgent,
  CreateAgentRequest,
  UpdateAgentRequest,
  UpdateAiSettingsRequest,
  RunAgentResult,
} from '@shared/api.interface';

export async function supportChat(
  payload: SupportChatRequest,
): Promise<SupportChatResponse> {
  const { data } = await http.post<SupportChatResponse>(
    '/api/ai/support/chat',
    payload,
    { headers: { 'x-session-id': getSessionId() } },
  );
  return data;
}

export async function getAIStatus(): Promise<AIStatusResponse> {
  const { data } =
    await http.get<AIStatusResponse>('/api/ai/status');
  return data;
}

export async function generateCopywriter(
  payload: AICopywriterRequest,
): Promise<AICopywriterResponse> {
  const { data } = await http.post<AICopywriterResponse>(
    '/api/ai/copywriter',
    payload,
  );
  return data;
}

export async function translateText(
  payload: AITranslationRequest,
): Promise<AITranslationResponse> {
  const { data } = await http.post<AITranslationResponse>(
    '/api/ai/translate',
    payload,
  );
  return data;
}

export async function generateTrendReport(): Promise<AITrendReport> {
  const { data } = await http.post<AITrendReport>(
    '/api/ai/trend/generate',
    {},
  );
  return data;
}

export async function generateSelectSuggestion(): Promise<AISelectResponse> {
  const { data } = await http.post<AISelectResponse>(
    '/api/ai/select/generate',
    {},
  );
  return data;
}

export async function getUsageStats(
  params?: AIUsageStatsQuery,
): Promise<AIUsageStats> {
  const query = new URLSearchParams();
  if (params?.agent) query.set('agent', params.agent);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  const { data } = await http.get<AIUsageStats>(
    `/api/ai/usage-stats${query.toString() ? `?${query.toString()}` : ''}`,
  );
  return data;
}

export async function getAIReports(type?: string): Promise<AIReportSummary[]> {
  const { data } = await http.get<AIReportSummary[]>(
    `/api/ai/reports${type ? `?type=${encodeURIComponent(type)}` : ''}`,
  );
  return data;
}

export async function getAIReport(id: string): Promise<AIReportDetail> {
  const { data } = await http.get<AIReportDetail>(`/api/ai/reports/${id}`);
  return data;
}

// ==================== 模型设置 ====================

export async function getAiSettings(): Promise<AiSettingsView> {
  const { data } = await http.get<AiSettingsView>('/api/ai/settings');
  return data;
}

export async function updateAiSettings(body: UpdateAiSettingsRequest): Promise<AiSettingsView> {
  const { data } = await http.put<AiSettingsView>('/api/ai/settings', body);
  return data;
}

export async function testAiSettings(): Promise<AiSettingsTestResult> {
  const { data } = await http.post<AiSettingsTestResult>('/api/ai/settings/test');
  return data;
}

// ==================== 自定义 Agent ====================

export async function listAiAgents(): Promise<AgentListResult> {
  const { data } = await http.get<AgentListResult>('/api/ai/agents');
  return data;
}

export async function createAiAgent(body: CreateAgentRequest): Promise<CustomAgent> {
  const { data } = await http.post<CustomAgent>('/api/ai/agents', body);
  return data;
}

export async function updateAiAgent(id: string, body: UpdateAgentRequest): Promise<CustomAgent> {
  const { data } = await http.put<CustomAgent>(`/api/ai/agents/${id}`, body);
  return data;
}

export async function deleteAiAgent(id: string): Promise<{ success: boolean }> {
  const { data } = await http.delete<{ success: boolean }>(`/api/ai/agents/${id}`);
  return data;
}

export async function runAiAgent(id: string, input: string): Promise<RunAgentResult> {
  const { data } = await http.post<RunAgentResult>(`/api/ai/agents/${id}/run`, { input });
  return data;
}
