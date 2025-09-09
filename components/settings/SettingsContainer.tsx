import React from 'react';
import ApiKeySetup from './ApiKeySetup';
import MigrationPanel from './MigrationPanel';
import ProviderSettings from './ProviderSettings';

export const SettingsContainer: React.FC = () => {
  return (
    <div className='flex flex-col gap-4'>
      <h2 className='text-xl font-bold'>Settings</h2>
      <ProviderSettings />
      <ApiKeySetup />
      <MigrationPanel />
    </div>
  );
};
