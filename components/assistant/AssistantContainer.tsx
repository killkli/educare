import React, { useState, useEffect, useCallback } from 'react';
import { Assistant } from '../../types';
import { AssistantList } from './AssistantList';
import { AssistantEditor } from './AssistantEditor';
import { ShareModal } from './ShareModal';
import { AssistantContainerProps, ViewMode } from './types';
import * as db from '../../services/db';

export const AssistantContainer: React.FC<AssistantContainerProps> = ({
  assistants,
  selectedAssistant,
  onAssistantChange,
  onAssistantSave,
  onAssistantDelete,
  onShare,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [assistantToShare, setAssistantToShare] = useState<Assistant | null>(null);

  // Reset view mode when no assistants
  useEffect(() => {
    if (assistants.length === 0 && viewMode === 'list') {
      setViewMode('new');
    }
  }, [assistants.length, viewMode]);

  const handleSelectAssistant = useCallback(
    async (assistantId: string) => {
      const assistant = await db.getAssistant(assistantId);
      if (assistant) {
        onAssistantChange(assistant);
        setViewMode('list');
      }
    },
    [onAssistantChange],
  );

  const handleEditAssistant = useCallback((assistant: Assistant) => {
    setEditingAssistant(assistant);
    setViewMode('edit');
  }, []);

  const handleDeleteAssistant = useCallback(
    async (assistantId: string) => {
      if (window.confirm('確定要刪除此助理和所有聊天記錄嗎？')) {
        await onAssistantDelete(assistantId);
        if (selectedAssistant?.id === assistantId) {
          onAssistantChange(null);
        }
        setViewMode(assistants.length > 1 ? 'list' : 'new');
      }
    },
    [assistants.length, onAssistantDelete, onAssistantChange, selectedAssistant],
  );

  const handleShareAssistant = useCallback(
    (assistant: Assistant) => {
      setAssistantToShare(assistant);
      setShareModalOpen(true);
      onShare(assistant);
    },
    [onShare],
  );

  const handleCreateNew = useCallback(() => {
    setEditingAssistant(null);
    setViewMode('new');
  }, []);

  const handleSaveAssistant = useCallback(
    async (assistant: Assistant) => {
      await onAssistantSave(assistant);
      onAssistantChange(assistant);
      setViewMode('list');
      setEditingAssistant(null);
    },
    [onAssistantSave, onAssistantChange],
  );

  const handleCancelEdit = useCallback(() => {
    setViewMode(assistants.length > 0 ? 'list' : 'new');
    setEditingAssistant(null);
  }, [assistants.length]);

  const handleShareModalClose = useCallback(() => {
    setShareModalOpen(false);
    setAssistantToShare(null);
  }, []);

  if (viewMode === 'new') {
    return (
      <>
        <AssistantEditor
          assistant={null}
          onSave={handleSaveAssistant}
          onCancel={handleCancelEdit}
          onShare={handleShareAssistant}
        />
        {assistantToShare && (
          <ShareModal
            isOpen={shareModalOpen}
            onClose={handleShareModalClose}
            assistant={assistantToShare}
          />
        )}
      </>
    );
  }

  if (viewMode === 'edit' && editingAssistant) {
    return (
      <>
        <AssistantEditor
          assistant={editingAssistant}
          onSave={handleSaveAssistant}
          onCancel={handleCancelEdit}
          onShare={handleShareAssistant}
        />
        {assistantToShare && (
          <ShareModal
            isOpen={shareModalOpen}
            onClose={handleShareModalClose}
            assistant={assistantToShare}
          />
        )}
      </>
    );
  }

  return (
    <>
      <AssistantList
        assistants={assistants}
        selectedAssistant={selectedAssistant}
        onSelect={handleSelectAssistant}
        onEdit={handleEditAssistant}
        onDelete={handleDeleteAssistant}
        onShare={handleShareAssistant}
        onCreateNew={handleCreateNew}
      />
      {assistantToShare && (
        <ShareModal
          isOpen={shareModalOpen}
          onClose={handleShareModalClose}
          assistant={assistantToShare}
        />
      )}
    </>
  );
};
