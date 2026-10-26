export interface User {
  id: string;
  email: string;
  name: string;
  role?: string;
  created_at?: string;
}

export interface UserApiKeys {
  serpapi_key?: string;
  serpapiKey?: string;
  serper_key?: string;
  serperKey?: string;
  gemini_api_key?: string;
  geminiApiKey?: string;
  leadocean_api_key?: string;
  leadoceanApiKey?: string;
  leadocean_endpoint?: string;
  leadoceanEndpoint?: string;
  apify_token?: string;
  openai_api_key?: string;
  default_engine?: 'serpapi' | 'serper';
  defaultEngine?: 'serpapi' | 'serper';
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
