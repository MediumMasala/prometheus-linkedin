import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

// Auth configuration - loaded from environment
function getAuthConfig() {
  return {
    username: process.env.AUTH_USERNAME || 'admin',
    password: process.env.AUTH_PASSWORD || 'prometheus2024',
    jwtSecret: process.env.JWT_SECRET || 'prometheus-secret-key-change-in-production',
    tokenExpiry: '24h',
  };
}

export interface AuthRequest extends Request {
  user?: { username: string };
}

// Generate JWT token
export function generateToken(username: string): string {
  const config = getAuthConfig();
  return jwt.sign({ username }, config.jwtSecret, { expiresIn: '24h' });
}

// Verify credentials and return token
export function login(username: string, password: string): { success: boolean; token?: string; error?: string } {
  const config = getAuthConfig();

  if (username === config.username && password === config.password) {
    const token = generateToken(username);
    return { success: true, token };
  }

  return { success: false, error: 'Invalid username or password' };
}

// Middleware to protect routes
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  // Skip auth for login route
  if (req.path === '/api/auth/login') {
    return next();
  }

  // Skip auth in development if AUTH_DISABLED is set
  if (process.env.AUTH_DISABLED === 'true') {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const config = getAuthConfig();

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { username: string };
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Check if user is authenticated (for optional auth routes)
export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const config = getAuthConfig();

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { username: string };
      req.user = decoded;
    } catch (error) {
      // Token invalid, but continue without auth
    }
  }

  next();
}
