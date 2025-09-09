import { useContext, createContext } from 'react';
import type { AppContextValue } from './AppContext.types';

export const AppContext = createContext<AppContextValue | undefined>(undefined);

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
