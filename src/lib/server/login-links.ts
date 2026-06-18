import QRCode from 'qrcode';

import { createLoginLink, type CreatedLoginLink } from './auth';

export interface LoginLinkPresentation {
  connectionUrl: string;
  expiresAt: string;
  qrDataUrl: string;
}

export async function createPresentedLoginLink(input: {
  userId: string;
  baseUrl: string;
  ttlMinutes?: number;
}): Promise<LoginLinkPresentation> {
  const link = await createLoginLink(input);
  return await presentLoginLink(link);
}

export async function presentLoginLink(link: CreatedLoginLink): Promise<LoginLinkPresentation> {
  return {
    connectionUrl: link.connectionUrl,
    expiresAt: link.expiresAt.toISOString(),
    qrDataUrl: await QRCode.toDataURL(link.connectionUrl, {
      width: 360,
      margin: 1,
      color: {
        dark: '#111111',
        light: '#0000'
      }
    })
  };
}

export function resolveRequestBaseUrl(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

export function resolveConfiguredBaseUrl(): string {
  const raw =
    process.env.APP_BASE_URL?.trim() ||
    process.env.PUBLIC_BASE_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    process.env.ORIGIN?.trim();
  if (!raw) {
    return 'http://127.0.0.1:5173';
  }
  return raw.replace(/\/+$/, '');
}
