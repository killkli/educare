
import { Assistant } from '../types';

export const saveAssistantsToSheet = async (scriptUrl: string, assistants: Assistant[]): Promise<void> => {
  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain', // Apps Script web apps often work best with text/plain for POST bodies
      },
      body: JSON.stringify({ action: 'save', payload: assistants }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to save to Google Sheet: ${errorText}`);
    }
  } catch (error) {
    console.error("Error saving to Google Sheet:", error);
    throw error;
  }
};

export const loadAssistantFromSheet = async (scriptUrl: string, assistantId: string): Promise<Assistant | null> => {
  try {
    const url = new URL(scriptUrl);
    url.searchParams.append('action', 'load');
    url.searchParams.append('id', assistantId);
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      mode: 'cors',
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to load from Google Sheet: ${errorText}`);
    }

    const data = await response.json();

    if (data && data.success) {
      return data.payload as Assistant;
    }
    return null;
  } catch (error) {
    console.error("Error loading from Google Sheet:", error);
    throw error;
  }
};
