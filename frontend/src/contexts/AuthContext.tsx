import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type UserRole = 'admin' | 'viewer';

export interface User {
  id: string;
  email: string;
  role: UserRole;
}

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  user: User | null;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'prometheus_auth_token';
const USER_KEY = 'prometheus_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setAuthDisabled] = useState(false);

  // Check for existing token on mount OR if auth is disabled
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // First check if auth is disabled on backend
        const healthRes = await fetch('/api/health');
        const health = await healthRes.json();

        if (health.authDisabled) {
          setAuthDisabled(true);
          setToken('disabled'); // Set a dummy token
          setIsLoading(false);
          return;
        }
      } catch (e) {
        // If health check fails, continue with normal auth
      }

      // Normal auth flow
      const savedToken = localStorage.getItem(TOKEN_KEY);
      const savedUser = localStorage.getItem(USER_KEY);
      if (savedToken) {
        // Verify token is still valid
        const valid = await verifyToken(savedToken);
        if (valid) {
          // Set globally BEFORE state update
          (window as any).__prometheusAuthToken = savedToken;
          setToken(savedToken);
          if (savedUser) {
            try {
              setUser(JSON.parse(savedUser));
            } catch (e) {
              // Ignore invalid user data
            }
          }
        } else {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        }
      }
      setIsLoading(false);
    };

    checkAuth();
  }, []);

  const verifyToken = async (tokenToVerify: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/verify', {
        headers: {
          Authorization: `Bearer ${tokenToVerify}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  const login = useCallback(async (username: string, password: string) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok && data.token) {
        // Set token globally IMMEDIATELY (before state update triggers re-render)
        (window as any).__prometheusAuthToken = data.token;
        localStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);

        // Save user info if provided
        if (data.user) {
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
          setUser(data.user);
        }

        return { success: true };
      } else {
        return { success: false, error: data.error || 'Login failed' };
      }
    } catch (error) {
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  // Add token to all fetch requests
  useEffect(() => {
    if (token) {
      // Store token globally for fetch interceptor
      (window as any).__prometheusAuthToken = token;
    } else {
      delete (window as any).__prometheusAuthToken;
    }
  }, [token]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!token,
        isLoading,
        token,
        user,
        isAdmin: user?.role === 'admin',
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Helper to get auth headers
export function getAuthHeaders(): HeadersInit {
  const token = (window as any).__prometheusAuthToken;
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

// Authenticated fetch wrapper
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = (window as any).__prometheusAuthToken;
  const headers = new Headers(options.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });

  // If unauthorized on a non-login request, clear token and redirect
  // But don't reload in a loop - only clear and let React handle it
  if (response.status === 401 && !url.includes('/auth/login')) {
    localStorage.removeItem(TOKEN_KEY);
    delete (window as any).__prometheusAuthToken;
    // Don't reload - the auth state change will trigger re-render to login page
  }

  return response;
}
