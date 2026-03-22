// Multi-LinkedIn Account Management
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import type { LinkedInAccount, LinkedInAccountsData } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACCOUNTS_FILE = path.join(__dirname, '..', '..', '.linkedin-accounts.json');
const LEGACY_TOKEN_FILE = path.join(__dirname, '..', '..', '.token.json');

const { LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET } = process.env;

// Load accounts from file
export function loadAccounts(): LinkedInAccountsData {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
      return data;
    }
  } catch (e) {
    console.error('[LinkedIn Accounts] Error loading accounts file:', e);
  }
  return { accounts: [], version: 1 };
}

// Save accounts to file
export function saveAccounts(data: LinkedInAccountsData): void {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2));
}

// Get all accounts (org-wide access)
export function getAllAccounts(): Omit<LinkedInAccount, 'accessToken' | 'refreshToken'>[] {
  const data = loadAccounts();
  return data.accounts.map(({ accessToken, refreshToken, ...account }) => account);
}

// Get account by ID (internal use - includes tokens)
export function getAccountById(accountId: string): LinkedInAccount | null {
  const data = loadAccounts();
  return data.accounts.find(a => a.id === accountId) || null;
}

// Get organization default account
export function getDefaultAccount(): LinkedInAccount | null {
  const data = loadAccounts();
  const defaultAccount = data.accounts.find(a => a.isDefault);
  if (defaultAccount) return defaultAccount;
  // If no default, return first account
  return data.accounts[0] || null;
}

// Create new account
export function createAccount(
  accountData: Omit<LinkedInAccount, 'id' | 'createdAt'>
): LinkedInAccount {
  const data = loadAccounts();

  // If this is the first account or isDefault is true, ensure only one default
  if (accountData.isDefault || data.accounts.length === 0) {
    data.accounts.forEach(a => a.isDefault = false);
  }

  const newAccount: LinkedInAccount = {
    ...accountData,
    id: `linkedin-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    createdAt: new Date().toISOString(),
    isDefault: accountData.isDefault || data.accounts.length === 0,
  };

  data.accounts.push(newAccount);
  saveAccounts(data);

  console.log(`[LinkedIn Accounts] Created account: ${newAccount.accountName} (${newAccount.id})`);
  return newAccount;
}

// Update account
export function updateAccount(
  accountId: string,
  updates: Partial<Pick<LinkedInAccount, 'accountName' | 'adAccountId' | 'isDefault'>>
): LinkedInAccount | null {
  const data = loadAccounts();
  const index = data.accounts.findIndex(a => a.id === accountId);

  if (index === -1) return null;

  // If setting as default, unset others
  if (updates.isDefault) {
    data.accounts.forEach(a => a.isDefault = false);
  }

  data.accounts[index] = { ...data.accounts[index], ...updates };
  saveAccounts(data);

  return data.accounts[index];
}

// Delete account
export function deleteAccount(accountId: string): boolean {
  const data = loadAccounts();
  const index = data.accounts.findIndex(a => a.id === accountId);

  if (index === -1) return false;

  const wasDefault = data.accounts[index].isDefault;
  data.accounts.splice(index, 1);

  // If deleted account was default, set first remaining as default
  if (wasDefault && data.accounts.length > 0) {
    data.accounts[0].isDefault = true;
  }

  saveAccounts(data);
  console.log(`[LinkedIn Accounts] Deleted account: ${accountId}`);
  return true;
}

// Set default account
export function setDefaultAccount(accountId: string): boolean {
  const data = loadAccounts();
  const account = data.accounts.find(a => a.id === accountId);

  if (!account) return false;

  data.accounts.forEach(a => a.isDefault = a.id === accountId);
  saveAccounts(data);

  console.log(`[LinkedIn Accounts] Set default account: ${account.accountName}`);
  return true;
}

// Update tokens for an account
export function updateAccountTokens(
  accountId: string,
  accessToken: string,
  refreshToken?: string,
  expiresIn?: number
): boolean {
  const data = loadAccounts();
  const index = data.accounts.findIndex(a => a.id === accountId);

  if (index === -1) return false;

  data.accounts[index].accessToken = accessToken;
  if (refreshToken) {
    data.accounts[index].refreshToken = refreshToken;
  }
  if (expiresIn) {
    data.accounts[index].tokenExpiresAt = Date.now() + expiresIn * 1000;
  }

  saveAccounts(data);
  return true;
}

// Refresh account token using refresh token (uses account's own OAuth credentials)
export async function refreshAccountToken(accountId: string): Promise<boolean> {
  const account = getAccountById(accountId);
  if (!account || !account.refreshToken) {
    console.log(`[LinkedIn Accounts] No refresh token for account: ${accountId}`);
    return false;
  }

  // Use account-specific credentials, fall back to env vars for legacy accounts
  const clientId = account.clientId || LINKEDIN_CLIENT_ID;
  const clientSecret = account.clientSecret || LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(`[LinkedIn Accounts] No OAuth credentials for account: ${accountId}`);
    return false;
  }

  try {
    console.log(`[LinkedIn Accounts] Refreshing token for: ${account.accountName}`);

    const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const data = await response.json();

    if (data.access_token) {
      updateAccountTokens(
        accountId,
        data.access_token,
        data.refresh_token || account.refreshToken,
        data.expires_in
      );
      console.log(`[LinkedIn Accounts] Token refreshed for: ${account.accountName}`);
      return true;
    } else {
      console.error(`[LinkedIn Accounts] Token refresh failed:`, data);
      return false;
    }
  } catch (error) {
    console.error(`[LinkedIn Accounts] Token refresh error:`, error);
    return false;
  }
}

// Get valid access token (auto-refresh if needed)
export async function getValidAccessToken(accountId: string): Promise<string | null> {
  const account = getAccountById(accountId);
  if (!account) return null;

  // Check if token is expired or expiring soon (5 min buffer)
  const fiveMinutes = 5 * 60 * 1000;
  if (account.tokenExpiresAt && account.tokenExpiresAt < Date.now() + fiveMinutes) {
    console.log(`[LinkedIn Accounts] Token expiring soon, attempting refresh...`);
    const refreshed = await refreshAccountToken(accountId);
    if (refreshed) {
      const updated = getAccountById(accountId);
      return updated?.accessToken || null;
    }
    // If refresh failed but token not yet expired, return current token
    if (account.tokenExpiresAt > Date.now()) {
      return account.accessToken;
    }
    return null;
  }

  return account.accessToken;
}

// Migrate from legacy .token.json
export function migrateFromLegacyToken(adminEmail: string): LinkedInAccount | null {
  const data = loadAccounts();

  // Skip if already migrated or accounts exist
  if (data.migratedFromLegacy || data.accounts.length > 0) {
    return null;
  }

  try {
    if (!fs.existsSync(LEGACY_TOKEN_FILE)) {
      return null;
    }

    const legacyData = JSON.parse(fs.readFileSync(LEGACY_TOKEN_FILE, 'utf-8'));
    const adAccountId = process.env.LINKEDIN_AD_ACCOUNT_ID;

    if (!legacyData.access_token || !adAccountId) {
      console.log('[LinkedIn Accounts] Legacy token missing required data');
      return null;
    }

    // Create account from legacy data
    const account = createAccount({
      accountName: 'Round1 AI (Migrated)',
      adAccountId,
      accessToken: legacyData.access_token,
      refreshToken: legacyData.refresh_token,
      tokenExpiresAt: legacyData.expires_at,
      isDefault: true,
      createdBy: adminEmail,
    });

    // Mark as migrated
    const updatedData = loadAccounts();
    updatedData.migratedFromLegacy = true;
    saveAccounts(updatedData);

    // Rename legacy file
    fs.renameSync(LEGACY_TOKEN_FILE, LEGACY_TOKEN_FILE + '.migrated');

    console.log('[LinkedIn Accounts] Successfully migrated legacy token');
    return account;
  } catch (error) {
    console.error('[LinkedIn Accounts] Migration failed:', error);
    return null;
  }
}

// Check if legacy token exists (for backward compatibility during transition)
export function hasLegacyToken(): boolean {
  return fs.existsSync(LEGACY_TOKEN_FILE) || !!process.env.LINKEDIN_ACCESS_TOKEN;
}

// Get legacy token (for backward compatibility)
export function getLegacyToken(): { accessToken: string; refreshToken?: string; expiresAt?: number } | null {
  // First check env vars
  if (process.env.LINKEDIN_ACCESS_TOKEN) {
    return {
      accessToken: process.env.LINKEDIN_ACCESS_TOKEN,
      refreshToken: process.env.LINKEDIN_REFRESH_TOKEN,
    };
  }

  // Then check file
  try {
    if (fs.existsSync(LEGACY_TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(LEGACY_TOKEN_FILE, 'utf-8'));
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_at,
      };
    }
  } catch (e) {
    // Ignore errors
  }

  return null;
}
