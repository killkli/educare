import type { ChatSession, TokenUsageTotals } from '../types';
import type { ProviderUsageMetadata } from './llmAdapter';

export interface SessionTokenUpdate {
  promptTokenCount: number;
  candidatesTokenCount: number;
  usage?: ProviderUsageMetadata;
  provider?: string;
  model?: string;
}

const sumOptional = (
  current: number | undefined,
  delta: number | undefined,
): number | undefined => {
  if (typeof current === 'undefined' && typeof delta === 'undefined') {
    return undefined;
  }

  return (current ?? 0) + (delta ?? 0);
};

const buildNextTotals = (
  current: TokenUsageTotals | undefined,
  usage: ProviderUsageMetadata,
  fallbackInputTokens: number,
  fallbackOutputTokens: number,
): TokenUsageTotals => {
  const inputTokens = usage.inputTokens ?? fallbackInputTokens;
  const outputTokens = usage.outputTokens ?? fallbackOutputTokens;
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;

  return {
    inputTokens: (current?.inputTokens ?? 0) + inputTokens,
    outputTokens: (current?.outputTokens ?? 0) + outputTokens,
    totalTokens: (current?.totalTokens ?? 0) + totalTokens,
    cacheCreationInputTokens: sumOptional(
      current?.cacheCreationInputTokens,
      usage.cacheCreationInputTokens,
    ),
    cacheReadInputTokens: sumOptional(current?.cacheReadInputTokens, usage.cacheReadInputTokens),
    cachedInputTokens: sumOptional(current?.cachedInputTokens, usage.cachedInputTokens),
    reasoningTokens: sumOptional(current?.reasoningTokens, usage.reasoningTokens),
    toolUseTokens: sumOptional(current?.toolUseTokens, usage.toolUseTokens),
  };
};

export const applyTokenUsageToSession = (
  session: ChatSession,
  tokenUpdate: SessionTokenUpdate,
): ChatSession => {
  const { usage, provider, model } = tokenUpdate;
  const currentUsage = session.tokenUsage;
  const now = Date.now();

  if (usage?.source === 'api') {
    const totals = buildNextTotals(
      currentUsage?.totals,
      usage,
      tokenUpdate.promptTokenCount,
      tokenUpdate.candidatesTokenCount,
    );

    return {
      ...session,
      tokenCount: totals.totalTokens,
      tokenUsage: {
        source: 'api',
        totals,
        lastProvider: provider ?? currentUsage?.lastProvider,
        lastModel: model ?? currentUsage?.lastModel,
        lastUpdatedAt: now,
        unavailableTurns: currentUsage?.unavailableTurns ?? 0,
      },
    };
  }

  return {
    ...session,
    tokenUsage: {
      source: currentUsage?.totals ? 'api' : 'unavailable',
      totals: currentUsage?.totals,
      lastProvider: provider ?? currentUsage?.lastProvider,
      lastModel: model ?? currentUsage?.lastModel,
      lastUpdatedAt: now,
      unavailableTurns: (currentUsage?.unavailableTurns ?? 0) + 1,
    },
  };
};
