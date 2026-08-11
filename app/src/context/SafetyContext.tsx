import React, { createContext, useContext, useState } from 'react';

interface SafetyContextType {
  isDisconnectEnabled: boolean;
  toggleDisconnect: () => void;
  enableDisconnect: () => void;
}

const SafetyContext = createContext<SafetyContextType>({
  isDisconnectEnabled: false,
  toggleDisconnect: () => {},
  enableDisconnect: () => {},
});

const ENABLE_DISCONNECT_BY_DEFAULT = true; // Set to false to hide the disconnect button by default

export function SafetyProvider({ children }: { children: React.ReactNode }) {
  const [isDisconnectEnabled, setIsDisconnectEnabled] = useState(ENABLE_DISCONNECT_BY_DEFAULT);

  const toggleDisconnect = () => setIsDisconnectEnabled(prev => !prev);
  const enableDisconnect = () => setIsDisconnectEnabled(true);

  return (
    <SafetyContext.Provider value={{ isDisconnectEnabled, toggleDisconnect, enableDisconnect }}>
      {children}
    </SafetyContext.Provider>
  );
}

export function useSafety() {
  return useContext(SafetyContext);
}
