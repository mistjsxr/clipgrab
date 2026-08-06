import { MediaJob } from '@clipgrab/types';

export function detectPlatform(url: string): MediaJob['platform'] {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/\.(mp4|mp3|mkv|webm|mov|avi)(\?.*)?$/i.test(url)) return 'direct';
  return 'unknown';
}

export function isValidMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return detectPlatform(url) !== 'unknown';
  } catch {
    return false;
  }
}

export function extractMediaId(url: string): string | null {
  try {
    const platform = detectPlatform(url);
    const parsed = new URL(url);

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
      const match = parsed.pathname.match(/(?:p|reel)\/([A-Za-z0-9_-]+)/);
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
  const id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const platform = detectPlatform(url);
  const now = new Date().toISOString();

  return {
    id,
    url,
    title: title || `${platform.toUpperCase()} Media`,
    platform,
    status: 'pending',
    requestedByDeviceId,
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
}
