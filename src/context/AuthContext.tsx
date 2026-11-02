import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, UserApiKeys, AuthContextType } from '../types/auth';
import { authService } from '../services/authService';
import { getAuthToken, setAuthToken } from '../config/api';
import { storageService } from '../services/storageService';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [keys, setKeys] = useState<UserApiKeys>({});
  const [token, setTokenState] = useState<string | null>(() => getAuthToken());
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Sync isolated keys with storageService so UI components immediately reflect user's settings
  const syncSettingsWithKeys = (k: UserApiKeys, currentUserId?: string | null) => {
    if (currentUserId !== undefined) {
      storageService.setUserId(currentUserId);
    }
    const settingsUpdate: any = {};
    if (k.serpapi_key !== undefined) settingsUpdate.serpApiKey = k.serpapi_key;
    if (k.serper_key !== undefined) settingsUpdate.serperApiKey = k.serper_key;
    if (k.gemini_api_key !== undefined) settingsUpdate.geminiApiKey = k.gemini_api_key;
    if (k.leadocean_api_key !== undefined) settingsUpdate.leadoceanApiKey = k.leadocean_api_key;
    if (k.leadocean_endpoint !== undefined) settingsUpdate.leadoceanEndpoint = k.leadocean_endpoint || 'https://api.leadocean.io/v1/people/enrich';
    if (k.default_engine !== undefined) settingsUpdate.defaultDecisionMakerEngine = (k.default_engine as 'serpapi' | 'serper') || 'serpapi';
    if (k.openai_api_key !== undefined) settingsUpdate.openAiApiKey = k.openai_api_key;

    storageService.saveSettings(settingsUpdate);
    // Asynchronously restore user projects from backend database into local workspace
    storageService.syncProjectsWithBackend().catch(() => {});
  };

  const refreshAuth = async () => {
    const currentToken = getAuthToken();
    if (!currentToken) {
      storageService.setUserId(null);
      setUser(null);
      setKeys({});
      setIsAuthenticated(false);
      setIsLoading(false);
      return;
    }

    try {
      const data = await authService.getMe();
      storageService.setUserId(data.user.id);
      setUser(data.user);
      setKeys(data.keys);
      setIsAuthenticated(true);
      setTokenState(currentToken);
      syncSettingsWithKeys(data.keys, data.user.id);
    } catch {
      storageService.setUserId(null);
      setUser(null);
      setKeys({});
      setAuthToken(null);
      setTokenState(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshAuth();
  }, []);

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const data = await authService.login(email, password);
      storageService.setUserId(data.user.id);
      setUser(data.user);
      setKeys(data.keys || {});
      setTokenState(data.token);
      setIsAuthenticated(true);
      syncSettingsWithKeys(data.keys || {}, data.user.id);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Login failed' };
    }
  };

  const logout = async () => {
    try {
      await authService.logout();
    } finally {
      storageService.setUserId(null);
      setUser(null);
      setKeys({});
      setTokenState(null);
      setIsAuthenticated(false);
    }
  };

  const updateKeys = async (newKeys: Partial<UserApiKeys>): Promise<{ success: boolean; error?: string }> => {
    try {
      const updated = await authService.updateUserKeys(newKeys);
      setKeys(updated);
      syncSettingsWithKeys(updated);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to update keys' };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        keys,
        token,
        isAuthenticated,
        isLoading,
        login,
        logout,
        updateKeys,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
