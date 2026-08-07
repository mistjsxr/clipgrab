import { MediaJob } from '@clipgrab/types';

export function cleanMediaUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    // Strip social tracking query parameters (igsh, hl, utm_*, si, s, t, etc.)
    const trackingKeys = ['igsh', 'hl', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'si', 's', 't'];
    trackingKeys.forEach((key) => parsed.searchParams.delete(key));

    let clean = parsed.toString();
    if (clean.endsWith('?')) clean = clean.slice(0, -1);
    return clean;
  } catch {
    return rawUrl.trim();
  }
}

export function detectPlatform(url: string): MediaJob['platform'] {
  const clean = cleanMediaUrl(url);
  if (/youtube\.com|youtu\.be/i.test(clean)) return 'youtube';
  if (/twitter\.com|x\.com/i.test(clean)) return 'twitter';
  if (/tiktok\.com/i.test(clean)) return 'tiktok';
  if (/instagram\.com/i.test(clean)) return 'instagram';
  if (/\.(mp4|mp3|mkv|webm|mov|avi)(\?.*)?$/i.test(clean)) return 'direct';
  return 'unknown';
}

export function isValidMediaUrl(url: string): boolean {
  try {
    const clean = cleanMediaUrl(url);
    const parsed = new URL(clean);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return detectPlatform(clean) !== 'unknown';
  } catch {
    return false;
  }
}

export function extractMediaId(url: string): string | null {
  try {
    const clean = cleanMediaUrl(url);
    const platform = detectPlatform(clean);
    const parsed = new URL(clean);

    if (platform === 'youtube') {
      if (parsed.hostname.includes('youtu.be')) {
        return parsed.pathname.slice(1);
      }
      return parsed.searchParams.get('v');
    }

    if (platform === 'twitter') {
      const match = parsed.pathname.match(/status\/(\d+)/);
      return match ? match[1] : null;
    }

    if (platform === 'tiktok') {
      const match = parsed.pathname.match(/video\/(\d+)/);
      return match ? match[1] : null;
    }

    if (platform === 'instagram') {
      const match = parsed.pathname.match(/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/);
      return match ? match[1] : null;
    }

    return null;
  } catch {
    return null;
  }
}

export function createMediaJobPayload(
  url: string,
  requestedByDeviceId: string,
  title?: string
): Omit<MediaJob, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string } {
  const cleanUrl = cleanMediaUrl(url);
  const id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const platform = detectPlatform(cleanUrl);
  const now = new Date().toISOString();

  return {
    id,
    url: cleanUrl,
    title: title || `${platform.toUpperCase()} Media`,
    platform,
    status: 'pending',
    requestedByDeviceId,
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
}
