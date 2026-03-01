// User management for Prometheus
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.join(__dirname, '..', '..', '.users.json');

export type UserRole = 'admin' | 'viewer';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  createdBy: string;
  lastLogin?: string;
}

interface UsersData {
  users: User[];
  version: number;
}

// Hash password using SHA-256 with salt
function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, useSalt, 10000, 64, 'sha512').toString('hex');
  return { hash: `${useSalt}:${hash}`, salt: useSalt };
}

// Verify password
function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  const { hash: computed } = hashPassword(password, salt);
  return computed === storedHash;
}

// Load users from file
function loadUsers(): UsersData {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
      return data;
    }
  } catch (e) {
    console.error('[Users] Error loading users file:', e);
  }

  // Default: create admin user from env vars or defaults
  const defaultAdmin: User = {
    id: 'admin-default',
    email: process.env.AUTH_USERNAME || 'admin',
    passwordHash: hashPassword(process.env.AUTH_PASSWORD || 'prometheus2024').hash,
    role: 'admin',
    createdAt: new Date().toISOString(),
    createdBy: 'system',
  };

  const data: UsersData = { users: [defaultAdmin], version: 1 };
  saveUsers(data);
  return data;
}

// Save users to file
function saveUsers(data: UsersData): void {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

// Get all users (without password hashes)
export function getAllUsers(): Omit<User, 'passwordHash'>[] {
  const data = loadUsers();
  return data.users.map(({ passwordHash, ...user }) => user);
}

// Get user by email
export function getUserByEmail(email: string): User | null {
  const data = loadUsers();
  return data.users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

// Get user by ID
export function getUserById(id: string): User | null {
  const data = loadUsers();
  return data.users.find(u => u.id === id) || null;
}

// Authenticate user
export function authenticateUser(email: string, password: string): { success: boolean; user?: Omit<User, 'passwordHash'>; error?: string } {
  const user = getUserByEmail(email);

  if (!user) {
    return { success: false, error: 'Invalid email or password' };
  }

  if (!verifyPassword(password, user.passwordHash)) {
    return { success: false, error: 'Invalid email or password' };
  }

  // Update last login
  const data = loadUsers();
  const userIndex = data.users.findIndex(u => u.id === user.id);
  if (userIndex !== -1) {
    data.users[userIndex].lastLogin = new Date().toISOString();
    saveUsers(data);
  }

  const { passwordHash, ...safeUser } = user;
  return { success: true, user: safeUser };
}

// Create new user (admin only)
export function createUser(
  email: string,
  password: string,
  role: UserRole,
  createdBy: string
): { success: boolean; user?: Omit<User, 'passwordHash'>; error?: string } {
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { success: false, error: 'Invalid email format' };
  }

  // Check if user already exists
  if (getUserByEmail(email)) {
    return { success: false, error: 'User with this email already exists' };
  }

  // Validate password
  if (password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters' };
  }

  const data = loadUsers();

  const newUser: User = {
    id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    email: email.toLowerCase(),
    passwordHash: hashPassword(password).hash,
    role,
    createdAt: new Date().toISOString(),
    createdBy,
  };

  data.users.push(newUser);
  saveUsers(data);

  const { passwordHash, ...safeUser } = newUser;
  return { success: true, user: safeUser };
}

// Update user role (admin only)
export function updateUserRole(userId: string, newRole: UserRole): { success: boolean; error?: string } {
  const data = loadUsers();
  const userIndex = data.users.findIndex(u => u.id === userId);

  if (userIndex === -1) {
    return { success: false, error: 'User not found' };
  }

  // Prevent changing the last admin's role
  const adminCount = data.users.filter(u => u.role === 'admin').length;
  if (data.users[userIndex].role === 'admin' && newRole !== 'admin' && adminCount <= 1) {
    return { success: false, error: 'Cannot demote the last admin' };
  }

  data.users[userIndex].role = newRole;
  saveUsers(data);

  return { success: true };
}

// Update user password
export function updateUserPassword(userId: string, newPassword: string): { success: boolean; error?: string } {
  if (newPassword.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters' };
  }

  const data = loadUsers();
  const userIndex = data.users.findIndex(u => u.id === userId);

  if (userIndex === -1) {
    return { success: false, error: 'User not found' };
  }

  data.users[userIndex].passwordHash = hashPassword(newPassword).hash;
  saveUsers(data);

  return { success: true };
}

// Delete user (admin only)
export function deleteUser(userId: string): { success: boolean; error?: string } {
  const data = loadUsers();
  const userIndex = data.users.findIndex(u => u.id === userId);

  if (userIndex === -1) {
    return { success: false, error: 'User not found' };
  }

  // Prevent deleting the last admin
  const adminCount = data.users.filter(u => u.role === 'admin').length;
  if (data.users[userIndex].role === 'admin' && adminCount <= 1) {
    return { success: false, error: 'Cannot delete the last admin' };
  }

  data.users.splice(userIndex, 1);
  saveUsers(data);

  return { success: true };
}

// Check if a user has admin role
export function isAdmin(userId: string): boolean {
  const user = getUserById(userId);
  return user?.role === 'admin';
}

// Get user count by role
export function getUserStats(): { total: number; admins: number; viewers: number } {
  const data = loadUsers();
  return {
    total: data.users.length,
    admins: data.users.filter(u => u.role === 'admin').length,
    viewers: data.users.filter(u => u.role === 'viewer').length,
  };
}
