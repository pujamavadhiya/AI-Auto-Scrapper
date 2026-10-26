export interface User {
  id: string;
  email: string;
  name: string;
  role?: string;
  created_at?: string;
}

export interface UserApiKeys {
  serpapi_key?: string;
  serper_key?: string;
  gemini_api_key?: string;
  leadocean_api_key?: string;
  leadocean_endpoint?: string;
  apify_token?: string;
  openai_api_key?: string;
  default_engine?: 'serpapi' | 'serper';
  updated_at?: string;
}

export interface AuthResponse {
  status: string;
  token: string;
  user: User;
  keys: UserApiKeys;
}

export interface AuthContextType {
  user: User | null;
  keys: UserApiKeys;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateKeys: (newKeys: Partial<UserApiKeys>) => Promise<{ success: boolean; error?: string }>;
  refreshAuth: () => Promise<void>;
}
