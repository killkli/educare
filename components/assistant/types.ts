import { Assistant, RagChunk } from '../../types';

export interface AssistantListProps {
  assistants: Assistant[];
  selectedAssistant: Assistant | null | undefined;
  onSelect: (assistantId: string) => void;
  onEdit: (assistant: Assistant) => void;
  onDelete: (assistantId: string) => void;
  onShare: (assistant: Assistant) => void;
  onCreateNew: () => void;
}

export interface AssistantCardProps {
  assistant: Assistant;
  isSelected: boolean;
  onSelect: (assistantId: string) => void;
  onEdit: (assistant: Assistant) => void;
  onDelete: (assistantId: string) => void;
  onShare: (assistant: Assistant) => void;
}

export interface AssistantContainerProps {
  assistants: Assistant[];
  selectedAssistant: Assistant | null | undefined;
  onAssistantChange: (assistant: Assistant | null) => void;
  onAssistantSave: (assistant: Assistant) => void;
  onAssistantDelete: (assistantId: string) => void;
  onShare: (assistant: Assistant) => void;
}

export interface RAGFileUploadProps {
  ragChunks: RagChunk[];
  onRagChunksChange: (chunks: RagChunk[]) => void;
  disabled?: boolean;
}

export type ViewMode = 'list' | 'edit' | 'new';
