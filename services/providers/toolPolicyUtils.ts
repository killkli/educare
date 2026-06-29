import { ChatParams, ToolChoicePolicy, ToolDefinition } from '../llmAdapter';

interface ToolPolicyParams {
  tools?: ToolDefinition[];
  allowedToolNames?: string[];
  toolChoice?: ToolChoicePolicy;
}

export interface ResolvedToolPolicy {
  visibleTools?: ToolDefinition[];
  toolChoice: ToolChoicePolicy;
}

const DEFAULT_TOOL_CHOICE: ToolChoicePolicy = { mode: 'auto' };

const ensureUniqueToolNames = (tools: ToolDefinition[]): void => {
  const seen = new Set<string>();

  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool definition: ${tool.name}`);
    }
    seen.add(tool.name);
  }
};

const buildVisibleTools = (
  tools?: ToolDefinition[],
  allowedToolNames?: string[],
): ToolDefinition[] | undefined => {
  if (!tools?.length) {
    return undefined;
  }

  ensureUniqueToolNames(tools);

  if (!allowedToolNames?.length) {
    return tools;
  }

  const allowedNameSet = new Set(allowedToolNames);
  const visibleTools = tools.filter(tool => allowedNameSet.has(tool.name));

  const visibleNames = new Set(visibleTools.map(tool => tool.name));
  const missingToolNames = allowedToolNames.filter(name => !visibleNames.has(name));

  if (missingToolNames.length > 0) {
    throw new Error(`Unknown tools in allowedToolNames: ${missingToolNames.join(', ')}`);
  }

  return visibleTools;
};

const validateToolChoice = (
  visibleTools: ToolDefinition[] | undefined,
  toolChoice: ToolChoicePolicy,
): void => {
  if (toolChoice.mode === 'auto' || toolChoice.mode === 'none') {
    return;
  }

  if (!visibleTools?.length) {
    throw new Error(`Tool choice mode ${toolChoice.mode} requires at least one visible tool.`);
  }

  if (toolChoice.mode === 'requireSpecific') {
    const hasRequestedTool = visibleTools.some(tool => tool.name === toolChoice.name);

    if (!hasRequestedTool) {
      throw new Error(`Requested tool is not visible: ${toolChoice.name}`);
    }
  }
};

export const resolveToolPolicy = (
  params: Pick<ChatParams, 'tools' | 'allowedToolNames' | 'toolChoice'> | ToolPolicyParams,
): ResolvedToolPolicy => {
  const visibleTools = buildVisibleTools(params.tools, params.allowedToolNames);
  const toolChoice = params.toolChoice ?? DEFAULT_TOOL_CHOICE;

  validateToolChoice(visibleTools, toolChoice);

  return {
    visibleTools,
    toolChoice,
  };
};
