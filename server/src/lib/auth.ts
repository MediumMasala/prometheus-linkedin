import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { authenticateUser, getUserById, type UserRole } from './users.js';

// Auth configuration - loaded from environment
function getAuthConfig() {
  return {
    jwtSecret: process.env.JWT_SECRET || 'prometheus-secret-key-change-in-production',
    tokenExpiry: '24h',
  };
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
  };
}

// Generate JWT token
export function generateToken(userId: string, email: string, role: UserRole): string {
  const config = getAuthConfig();
  return jwt.sign({ id: userId, email, role }, config.jwtSecret, { expiresIn: '24h' });
}

// Verify credentials and return token
export function login(email: string, password: string): { success: boolean; token?: string; user?: { id: string; email: string; role: UserRole }; error?: string } {
  const result = authenticateUser(email, password);

  if (result.success && result.user) {
    const token = generateToken(result.user.id, result.user.email, result.user.role);
    return {
      success: true,
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
      }
    };
  }

  return { success: false, error: result.error || 'Invalid email or password' };
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
    const decoded = jwt.verify(token, config.jwtSecret) as { id: string; email: string; role: UserRole };
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Middleware to require admin role
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}

// Middleware to require at least viewer role (any authenticated user)
export function requireViewer(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Both admin and viewer can access
  if (req.user.role !== 'admin' && req.user.role !== 'viewer') {
    return res.status(403).json({ error: 'Access denied' });
  }

  next();
}

// Check if user is authenticated (for optional auth routes)
export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const config = getAuthConfig();

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { id: string; email: string; role: UserRole };
      req.user = decoded;
    } catch (error) {
      // Token invalid, but continue without auth
    }
  }

  next();
}
