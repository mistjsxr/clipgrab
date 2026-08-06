import { createNeonClient, mediaQueue } from '@clipgrab/db';
import { createMediaJobPayload, isValidMediaUrl } from '@clipgrab/core-downloader';
import { PairingPayload } from '@clipgrab/types';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'clipgrab-enqueue-link',
    title: 'Send to ClipGrab Queue',
    contexts: ['link', 'page', 'video', 'audio'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'clipgrab-enqueue-link') {
    const targetUrl = info.linkUrl || info.srcUrl || info.pageUrl;
    if (!targetUrl || !isValidMediaUrl(targetUrl)) {
      console.warn('Selected URL is not a supported media URL:', targetUrl);
      return;
    }

    try {
      const storage = await chrome.storage.local.get('clipgrab_pairing_key');
      const pairingKey = storage.clipgrab_pairing_key;
      if (!pairingKey) {
        console.error('Extension is not paired to ClipGrab Neon DB!');
        return;
      }

      const jsonStr = atob(pairingKey);
      const parsed: PairingPayload = JSON.parse(jsonStr);

      const client = createNeonClient(parsed.databaseUrl);
      const payload = createMediaJobPayload(targetUrl, 'browser_extension');

      await client.insert(mediaQueue).values({
        id: payload.id,
        url: payload.url,
        title: payload.title,
        platform: payload.platform,
        status: payload.status,
        requestedByDeviceId: payload.requestedByDeviceId,
        progress: 0,
      });

      console.log('Successfully enqueued task from extension:', payload.id);
    } catch (err) {
      console.error('Failed to enqueue media task from extension background script:', err);
    }
  }
});
