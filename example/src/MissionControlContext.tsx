import React, { createContext, useContext, useMemo } from 'react';
import {
  createMissionControlClient,
  type ConnectionMode,
  type MissionControlClient,
} from '@flanksource/mission-control-sdk';

type MissionControlProviderProps = {
  mode: ConnectionMode;
  baseUrl: string;
  children: React.ReactNode;
};

const MissionControlContext = createContext<MissionControlClient | null>(null);

export function MissionControlProvider({ mode, baseUrl, children }: MissionControlProviderProps) {
  const client = useMemo(
    () => createMissionControlClient({ mode, baseUrl }),
    [mode, baseUrl],
  );

  return (
    <MissionControlContext.Provider value={client}>
      {children}
    </MissionControlContext.Provider>
  );
}

export function useMissionControl(): MissionControlClient {
  const client = useContext(MissionControlContext);
  if (!client) {
    throw new Error('useMissionControl must be used inside MissionControlProvider');
  }
  return client;
}
