// LinkedIn Account Resolution Middleware
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.js';
import type { LinkedInApiContext } from '../types/index.js';
import {
  getAccountById,
  getDefaultAccount,
  getValidAccessToken,
  hasLegacyToken,
  getLegacyToken,
} from './linkedin-accounts.js';

// Extended request with LinkedIn account context
export interface AccountRequest extends AuthRequest {
  linkedInAccount?: LinkedInApiContext;
}

// Middleware to resolve LinkedIn account for a request
export async function resolveAccount(
  req: AccountRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Get account ID from header, query, or body
  const accountId =
    (req.headers['x-linkedin-account-id'] as string) ||
    (req.query.accountId as string) ||
    (req.body?.accountId as string);

  let context: LinkedInApiContext | null = null;

  if (accountId) {
    // Specific account requested
    const account = getAccountById(accountId);
    if (!account) {
      res.status(404).json({ error: 'LinkedIn account not found', accountId });
      return;
    }

    const accessToken = await getValidAccessToken(accountId);
    if (!accessToken) {
      res.status(401).json({
        error: 'LinkedIn token expired or invalid',
        accountId,
        action: 'reconnect',
        message: 'Please reconnect this LinkedIn account',
      });
      return;
    }

    context = {
      accountId: account.id,
      adAccountId: account.adAccountId,
      accessToken,
    };
  } else {
    // Try default account
    const defaultAccount = getDefaultAccount();

    if (defaultAccount) {
      const accessToken = await getValidAccessToken(defaultAccount.id);
      if (accessToken) {
        context = {
          accountId: defaultAccount.id,
          adAccountId: defaultAccount.adAccountId,
          accessToken,
        };
      }
    }

    // Fall back to legacy token if no multi-account setup
    if (!context && hasLegacyToken()) {
      const legacy = getLegacyToken();
      if (legacy && process.env.LINKEDIN_AD_ACCOUNT_ID) {
        context = {
          accountId: 'legacy',
          adAccountId: process.env.LINKEDIN_AD_ACCOUNT_ID,
          accessToken: legacy.accessToken,
        };
      }
    }
  }

  if (!context) {
    res.status(400).json({
      error: 'No LinkedIn account configured',
      hint: 'Connect a LinkedIn account via /api/linkedin/accounts',
    });
    return;
  }

  req.linkedInAccount = context;
  next();
}

// Optional account resolution (doesn't fail if no account)
export async function optionalAccount(
  req: AccountRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const accountId =
    (req.headers['x-linkedin-account-id'] as string) ||
    (req.query.accountId as string) ||
    (req.body?.accountId as string);

  if (accountId) {
    const account = getAccountById(accountId);
    if (account) {
      const accessToken = await getValidAccessToken(accountId);
      if (accessToken) {
        req.linkedInAccount = {
          accountId: account.id,
          adAccountId: account.adAccountId,
          accessToken,
        };
      }
    }
  } else {
    // Try default account
    const defaultAccount = getDefaultAccount();
    if (defaultAccount) {
      const accessToken = await getValidAccessToken(defaultAccount.id);
      if (accessToken) {
        req.linkedInAccount = {
          accountId: defaultAccount.id,
          adAccountId: defaultAccount.adAccountId,
          accessToken,
        };
      }
    }

    // Fall back to legacy
    if (!req.linkedInAccount && hasLegacyToken()) {
      const legacy = getLegacyToken();
      if (legacy && process.env.LINKEDIN_AD_ACCOUNT_ID) {
        req.linkedInAccount = {
          accountId: 'legacy',
          adAccountId: process.env.LINKEDIN_AD_ACCOUNT_ID,
          accessToken: legacy.accessToken,
        };
      }
    }
  }

  next();
}
