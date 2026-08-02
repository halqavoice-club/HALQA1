import { getBaseURL } from '@/lib/api';

const BASE = getBaseURL().replace('/api/v1', '');

export function getAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return BASE + url;
}

export function getAvatarInitials(firstName?: string, lastName?: string): string {
  return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
}

const COLORS = ['#4f46e5','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2'];
export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

/**
 * Convenience helper used by detail screens.
 * Takes either a URL string or null/undefined, returns a full URI.
 * Falls back to a UI Avatars URL using the name.
 */
export function avatarUrl(url: string | null | undefined, name: string): string {
  if (url) {
    if (url.startsWith('http')) return url;
    return BASE + url;
  }
  const encoded = encodeURIComponent(name || 'U');
  return `https://ui-avatars.com/api/?name=${encoded}&background=4f46e5&color=fff&size=128`;
}
