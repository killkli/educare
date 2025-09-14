import { useState, useEffect } from 'react';
import { checkAssistantExistsInTurso } from '../services/tursoService';

export const useTursoAssistantStatus = (assistantId: string | null) => {
  const [isInTurso, setIsInTurso] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [lastCheckedId, setLastCheckedId] = useState<string | null>(null);

  useEffect(() => {
    const checkStatus = async () => {
      if (!assistantId || assistantId === lastCheckedId) {
        return;
      }

      setIsChecking(true);
      setLastCheckedId(assistantId);

      try {
        const exists = await checkAssistantExistsInTurso(assistantId);
        setIsInTurso(exists);
      } catch (error) {
        console.error('Failed to check assistant status in Turso:', error);
        setIsInTurso(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkStatus();
  }, [assistantId, lastCheckedId]);

  // Reset when assistant changes
  useEffect(() => {
    if (!assistantId) {
      setIsInTurso(false);
      setIsChecking(false);
      setLastCheckedId(null);
    }
  }, [assistantId]);

  const recheckStatus = async () => {
    if (!assistantId) {
      return;
    }

    setIsChecking(true);
    try {
      const exists = await checkAssistantExistsInTurso(assistantId);
      setIsInTurso(exists);
    } catch (error) {
      console.error('Failed to recheck assistant status in Turso:', error);
      setIsInTurso(false);
    } finally {
      setIsChecking(false);
    }
  };

  return {
    isInTurso,
    isChecking,
    canShare: isInTurso,
    recheckStatus,
  };
};
