interface RecoverableErrorLike {
  ok?: boolean;
  recoverable?: boolean;
  code?: unknown;
  message?: unknown;
  guidance?: unknown;
  details?: unknown;
}

export interface RecoverableErrorEscalation {
  toolName: string;
  code: string;
  attempt: number;
  fallbackStrategy: string;
  userVisibleSummary: string;
  modelVisibleGuidance: string;
}

export interface ToolLoopEscalationResult extends RecoverableErrorLike {
  escalation: RecoverableErrorEscalation;
  loopAction: 'retry-with-guidance' | 'stop-route';
}

export const isRecoverableToolErrorResult = (
  value: unknown,
): value is RecoverableErrorLike & {
  ok: false;
  recoverable: true;
  code: string;
  message: string;
} => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as RecoverableErrorLike;
  return (
    candidate.ok === false &&
    candidate.recoverable === true &&
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    typeof candidate.message === 'string' &&
    candidate.message.length > 0
  );
};

const buildFallbackStrategy = (toolName: string, code: string): string => {
  if (code.includes('invalid-json') || code.includes('invalid-shape')) {
    return 'Retry with a smaller valid JSON object payload.';
  }

  if (code.includes('write') || code.includes('size') || code.includes('oversized')) {
    return 'Inspect the file first, then switch to replaceInFile or modifyLinesInFile instead of another large write.';
  }

  if (code.includes('ambiguous')) {
    return 'Read the file again and use a longer unique snippet or targeted line edit before retrying.';
  }

  if (code.includes('not-found') || code.includes('missing')) {
    return 'Confirm the current project path or project state with summary/inspection tools before retrying.';
  }

  if (toolName === 'renderPreview') {
    return 'Repair the referenced files or entrypoint before asking for another preview recheck.';
  }

  return 'Choose a safer fallback path by inspecting the current project state and changing the tool arguments before retrying.';
};

export const buildRecoverableErrorEscalation = (
  toolName: string,
  code: string,
  attempt: number,
): RecoverableErrorEscalation => {
  const fallbackStrategy = buildFallbackStrategy(toolName, code);
  const userVisibleSummary =
    attempt >= 3
      ? `Stopped repeated ${toolName} retries after ${attempt} recoverable ${code} failures. Fallback: ${fallbackStrategy}`
      : `Repeated ${toolName} recoverable error (${code}). Use fallback: ${fallbackStrategy}`;

  const modelVisibleGuidance =
    attempt >= 3
      ? `Stop repeating ${toolName} with the same failing pattern. ${fallbackStrategy}`
      : `Do not repeat the same ${toolName} call pattern. ${fallbackStrategy}`;

  return {
    toolName,
    code,
    attempt,
    fallbackStrategy,
    userVisibleSummary,
    modelVisibleGuidance,
  };
};

export const buildEscalatedToolResult = (
  toolName: string,
  result: RecoverableErrorLike & { ok: false; recoverable: true; code: string; message: string },
  attempt: number,
): ToolLoopEscalationResult => {
  const escalation = buildRecoverableErrorEscalation(toolName, result.code, attempt);
  const loopAction = attempt >= 3 ? 'stop-route' : 'retry-with-guidance';
  const guidancePrefix =
    typeof result.guidance === 'string' && result.guidance.length > 0 ? `${result.guidance} ` : '';

  return {
    ...result,
    recoverable: loopAction === 'retry-with-guidance',
    guidance: `${guidancePrefix}${escalation.modelVisibleGuidance}`.trim(),
    details:
      result.details && typeof result.details === 'object' && !Array.isArray(result.details)
        ? {
            ...(result.details as Record<string, unknown>),
            escalation,
          }
        : { escalation },
    escalation,
    loopAction,
  };
};

export const isStopRouteToolResult = (
  value: unknown,
): value is ToolLoopEscalationResult & { loopAction: 'stop-route' } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return (value as { loopAction?: string }).loopAction === 'stop-route';
};
