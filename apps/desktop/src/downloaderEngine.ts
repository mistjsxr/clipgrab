import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { createNeonClient, initializeDatabaseTables, mediaQueue, mediaHistory, eq, desc, inArray, neon } from '@clipgrab/db';
import { MediaJob } from '@clipgrab/types';
import { cleanMediaUrl, extractMediaId, createMediaJobPayload } from '@clipgrab/core-downloader';

export interface DownloadConfig {
  downloadPath: string;
  quality: 'best' | '4k' | '1080p' | '720p' | '480p' | 'audio';
  container: 'mp4' | 'mkv' | 'webm' | 'mp3' | 'mov' | 'avi';
  videoCodec: 'auto' | 'h264' | 'h265' | 'av1' | 'vp9';
  audioQuality: 'best' | '320k' | '256k' | '128k';
  toolPreference: 'auto' | 'ytdlp';
  autoUpdateEngine: boolean;
  eagleApiToken?: string;
  eaglePort?: string;
}

export const DEFAULT_DOWNLOAD_CONFIG: DownloadConfig = {
  downloadPath: '~/Downloads/ClipGrab',
  quality: 'best',
  container: 'mp4',
  videoCodec: 'auto',
  audioQuality: 'best',
  toolPreference: 'auto',
  autoUpdateEngine: false, // Default false to prevent download startup delays
  eagleApiToken: '',
  eaglePort: '22745',
};

export interface EngineBinaryStatus {
  name: string;
  binary: 'yt-dlp' | 'ffmpeg';
  installed: boolean;
  version: string;
  updateAvailable: boolean;
  latestVersion?: string;
  checking: boolean;
  updating: boolean;
}

// Map of active child processes running by jobId
const activeChildProcesses = new Map<string, any>();

// Standard macOS Homebrew PATH exported for GUI Tauri apps
const MACOS_PATH_ENV = 'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH";';

export function expandUserPath(inputPath?: string): string {
  if (!inputPath) return '';
  if (inputPath.startsWith('~')) {
    const home = process.env.HOME || '/Users/mistjs';
    return inputPath.replace(/^~/, home);
  }
  return inputPath;
}

export async function sendSystemNotification(title: string, body: string) {
  try {
    let granted = await invoke<boolean>('plugin:notification|is_permission_granted').catch(() => false);
    if (!granted) {
      const permission = await invoke<string>('plugin:notification|request_permission').catch(() => 'denied');
      granted = permission === 'granted';
    }
    if (granted) {
      await invoke('plugin:notification|notify', {
        options: { title, body }
      }).catch(console.error);
    }
  } catch (err) {
    console.error('Notification error:', err);
  }
}

export async function openFileInFinder(job: MediaJob, dbUrl?: string, configPath?: string): Promise<boolean> {
  try {
    let targetPath = expandUserPath(job.filePath || configPath || '~/Downloads/ClipGrab');
    const downloadFolder = expandUserPath(configPath || '~/Downloads/ClipGrab');
    const mediaId = extractMediaId(job.url) || '';

    // Database-backed Direct Path Finder Script
    const script = `
      ${MACOS_PATH_ENV}
      TARGET="${targetPath.replace(/"/g, '\\"')}"
      TITLE="${(job.title || '').replace(/"/g, '\\"')}"
      FOLDER="${downloadFolder.replace(/"/g, '\\"')}"
      MEDIA_ID="${mediaId.replace(/"/g, '\\"')}"

      # Tier 1: Direct exact file on disk -> Reveal immediately
      if [ -f "$TARGET" ]; then
        open -R "$TARGET"
        echo "$TARGET"
        exit 0
      fi

      # Tier 2: Search download folder by Title or Media ID
      FOUND=""
      if [ -d "$FOLDER" ]; then
        if [ -n "$TITLE" ] && [ "$TITLE" != "YOUTUBE Media" ] && [ "$TITLE" != "INSTAGRAM Media" ] && [ "$TITLE" != "TIKTOK Media" ] && [ "$TITLE" != "TWITTER Media" ]; then
          FOUND=$(find "$FOLDER" -maxdepth 2 -type f 2>/dev/null | grep -F -i "$TITLE" | head -n 1)
        fi

        if [ -z "$FOUND" ] && [ -n "$MEDIA_ID" ]; then
          FOUND=$(find "$FOLDER" -maxdepth 2 -type f 2>/dev/null | grep -F -i "$MEDIA_ID" | head -n 1)
        fi

        if [ -n "$FOUND" ] && [ -f "$FOUND" ]; then
          open -R "$FOUND"
          echo "$FOUND"
          exit 0
        else
          open "$FOLDER"
          exit 0
        fi
      fi

      open "${expandUserPath(configPath) || '/Users/mistjs/Downloads'}"
    `;

    const cmd = Command.create('sh', ['-c', script]);
    const output = await cmd.execute();
    const resolvedPath = output.stdout.trim();

    // Backfill DB with the exact resolved path if found & dbUrl provided
    if (resolvedPath && resolvedPath.startsWith('/') && resolvedPath !== job.filePath && dbUrl) {
      try {
        const db = createNeonClient(dbUrl);
        const filename = resolvedPath.split('/').pop() || '';
        const cleanTitle = filename.replace(/\.[^/.]+$/, '');

        await db
          .update(mediaQueue)
          .set({
            filePath: resolvedPath,
            title: cleanTitle || job.title,
            updatedAt: new Date(),
          })
          .where(eq(mediaQueue.id, job.id));
      } catch (e) {
        console.error('Failed to backfill DB with resolved path:', e);
      }
    }

    return output.code === 0;
  } catch (err) {
    console.error('Failed to open file in Finder:', err);
    return false;
  }
}

// Engine Binary Version & Health Inspection Functions
export async function getBinaryVersion(binary: 'yt-dlp' | 'ffmpeg'): Promise<{ installed: boolean; version: string }> {
  try {
    let flag = '--version';
    if (binary === 'ffmpeg') flag = '-version';
    const cmd = Command.create('sh', ['-c', `${MACOS_PATH_ENV} ${binary} ${flag}`]);
    const output = await cmd.execute();

    if (output.code === 0 && output.stdout.trim()) {
      let ver = output.stdout.split('\n')[0].trim();
      if (binary === 'ffmpeg') {
        const match = ver.match(/ffmpeg version ([^\s]+)/i);
        if (match) ver = match[1];
      }
      return { installed: true, version: ver };
    }
    return { installed: false, version: 'Not Installed' };
  } catch {
    return { installed: false, version: 'Not Installed' };
  }
}

export async function checkBinaryUpdate(binary: 'yt-dlp' | 'ffmpeg'): Promise<{ updateAvailable: boolean; latestVersion?: string }> {
  try {
    if (binary === 'yt-dlp') {
      const cmd = Command.create('sh', ['-c', `${MACOS_PATH_ENV} yt-dlp -U`]);
      const output = await cmd.execute();
      const text = (output.stdout + output.stderr).toLowerCase();
      if (text.includes('updating') || text.includes('available') || text.includes('update')) {
        const latestMatch = output.stdout.match(/latest version is ([^\s]+)/i);
        return { updateAvailable: true, latestVersion: latestMatch ? latestMatch[1] : 'New Version' };
      }
      return { updateAvailable: false };
    } else {
      // ffmpeg brew check
      const cmd = Command.create('sh', ['-c', `${MACOS_PATH_ENV} brew outdated ffmpeg`]);
      const output = await cmd.execute();
      if (output.stdout.trim().includes('ffmpeg')) {
        return { updateAvailable: true };
      }
      return { updateAvailable: false };
    }
  } catch {
    return { updateAvailable: false };
  }
}

export async function updateBinaryOnDemand(binary: 'yt-dlp' | 'ffmpeg'): Promise<{ success: boolean; message: string; newVersion?: string }> {
  try {
    let script = `${MACOS_PATH_ENV} ${binary} -U`;
    if (binary === 'ffmpeg') {
      script = `${MACOS_PATH_ENV} brew upgrade ffmpeg`;
    }

    const cmd = Command.create('sh', ['-c', script]);
    const output = await cmd.execute();

    if (output.code === 0) {
      const updated = await getBinaryVersion(binary);
      return { success: true, message: `Successfully updated ${binary}!`, newVersion: updated.version };
    } else {
      // Fallback try brew upgrade
      const brewCmd = Command.create('sh', ['-c', `${MACOS_PATH_ENV} brew upgrade ${binary}`]);
      const brewOut = await brewCmd.execute();
      if (brewOut.code === 0) {
        const updated = await getBinaryVersion(binary);
        return { success: true, message: `Successfully updated ${binary} via Homebrew!`, newVersion: updated.version };
      }
      return { success: false, message: output.stderr.trim() || brewOut.stderr.trim() || 'Update failed' };
    }
  } catch (err: any) {
    return { success: false, message: err?.message || 'Update failed' };
  }
}

export async function checkToolAvailability(toolName: string): Promise<boolean> {
  try {
    const cmd = Command.create('sh', ['-c', `${MACOS_PATH_ENV} which ${toolName}`]);
    const output = await cmd.execute();
    return output.code === 0 && output.stdout.trim().length > 0;
  } catch (err) {
    return false;
  }
}

export async function detectInstalledBrowsers(): Promise<Array<{ id: string; name: string; installed: boolean }>> {
  const browsers = [
    { id: 'chrome', name: 'Google Chrome', appPath: '/Applications/Google Chrome.app' },
    { id: 'safari', name: 'Safari', appPath: '/Applications/Safari.app' },
    { id: 'firefox', name: 'Firefox', appPath: '/Applications/Firefox.app' },
    { id: 'brave', name: 'Brave Browser', appPath: '/Applications/Brave Browser.app' },
    { id: 'edge', name: 'Microsoft Edge', appPath: '/Applications/Microsoft Edge.app' },
  ];

  const results = await Promise.all(
    browsers.map(async (b) => {
      try {
        const cmd = Command.create('sh', ['-c', `test -d "${b.appPath}" && echo "yes"`]);
        const res = await cmd.execute();
        return { id: b.id, name: b.name, installed: res.stdout.trim() === 'yes' };
      } catch {
        return { id: b.id, name: b.name, installed: false };
      }
    })
  );

  return results;
}

export function isPhotoUrl(url: string, platform: string): boolean {
  if (platform === 'twitter' && url.includes('/photo/')) {
    return true;
  }
  if (platform === 'instagram' && (url.includes('/p/') || url.includes('/photos/') || url.includes('carousel'))) {
    return true;
  }
  return false;
}

export async function cancelJobDownload(jobId: string, dbUrl: string): Promise<boolean> {
  const child = activeChildProcesses.get(jobId);
  if (child) {
    try {
      await child.kill();
    } catch (e) {
      console.error('Failed to kill child process:', e);
    }
    activeChildProcesses.delete(jobId);
  }

  try {
    const db = createNeonClient(dbUrl);
    await db
      .update(mediaQueue)
      .set({ status: 'failed', error: 'Cancelled by user', progress: 0, updatedAt: new Date() })
      .where(eq(mediaQueue.id, jobId));
  } catch (err) {
    console.error('Failed to update DB for cancelled job:', err);
  }

  return true;
}

export async function deleteJobFromQueue(jobId: string, dbUrl: string): Promise<boolean> {
  if (activeChildProcesses.has(jobId)) {
    await cancelJobDownload(jobId, dbUrl);
  }

  try {
    const db = createNeonClient(dbUrl);
    await db.delete(mediaQueue).where(eq(mediaQueue.id, jobId));
    return true;
  } catch (err) {
    console.error('Failed to delete job from DB:', err);
    return false;
  }
}

// SAFE INDIVIDUAL FILE DELETION — NEVER DELETES THE PARENT FOLDER
export async function removeDownloadedFileAndResetJob(job: MediaJob, dbUrl: string): Promise<boolean> {
  if (activeChildProcesses.has(job.id)) {
    await cancelJobDownload(job.id, dbUrl);
  }

  const rawPath = job.filePath || '';
  if (rawPath) {
    const expandedPath = expandUserPath(rawPath);
    
    // SAFEGUARDS:
    // 1. Only run rm -f if target is a REGULAR FILE (-f).
    // 2. NEVER run rm on a DIRECTORY (-d).
    const safeDeleteScript = `
      ${MACOS_PATH_ENV}
      TARGET="${expandedPath.replace(/"/g, '\\"')}"

      if [ -d "$TARGET" ]; then
        echo "[SAFEGUARD BLOCK]: Target is a directory ($TARGET). Parent folder will NOT be deleted."
        exit 0
      fi

      if [ -f "$TARGET" ]; then
        rm -f -- "$TARGET"
        echo "[SUCCESS DELETED FILE]: $TARGET"
        exit 0
      fi
    `;

    try {
      const cmd = Command.create('sh', ['-c', safeDeleteScript]);
      const res = await cmd.execute();
      console.log(`[SAFE FILE DISK DELETION LOG]: ${res.stdout.trim()}`);
    } catch (e) {
      console.error('Failed to execute safe rm -f on filePath:', e);
    }
  }

  // Update Neon DB status to pending, clear filePath, reset progress to 0
  try {
    const db = createNeonClient(dbUrl);
    await db
      .update(mediaQueue)
      .set({ status: 'pending', progress: 0, filePath: null, error: null, updatedAt: new Date() })
      .where(eq(mediaQueue.id, job.id));
    return true;
  } catch (err) {
    console.error('Failed to reset job in DB:', err);
    return false;
  }
}

export async function deleteJobAndFile(job: MediaJob, dbUrl: string): Promise<boolean> {
  if (activeChildProcesses.has(job.id)) {
    await cancelJobDownload(job.id, dbUrl);
  }

  const rawPath = job.filePath || '';
  if (rawPath) {
    const expandedPath = expandUserPath(rawPath);
    
    const safeDeleteScript = `
      ${MACOS_PATH_ENV}
      TARGET="${expandedPath.replace(/"/g, '\\"')}"

      if [ -d "$TARGET" ]; then
        echo "[SAFEGUARD BLOCK]: Target is a directory ($TARGET). Parent folder will NOT be deleted."
        exit 0
      fi

      if [ -f "$TARGET" ]; then
        rm -f -- "$TARGET"
        echo "[SUCCESS DELETED FILE]: $TARGET"
        exit 0
      fi
    `;

    try {
      const cmd = Command.create('sh', ['-c', safeDeleteScript]);
      const res = await cmd.execute();
      console.log(`[SAFE FILE DISK DELETION LOG]: ${res.stdout.trim()}`);
    } catch (e) {
      console.error('Failed to execute safe rm -f on filePath:', e);
    }
  }

  try {
    const db = createNeonClient(dbUrl);
    await db.delete(mediaQueue).where(eq(mediaQueue.id, job.id));
    return true;
  } catch (err) {
    console.error('Failed to delete job from DB:', err);
    return false;
  }
}

export interface HistoryBatchGroup {
  batchId: string;
  actionType: 'CLEAR_WORKSPACE' | 'CLEAR_COMPLETED' | 'BULK_DELETE' | 'SINGLE_DELETE' | string;
  archivedAt: string;
  items: Array<{
    id: string;
    originalJobId?: string;
    url: string;
    title?: string;
    platform: string;
    finalStatus: string;
    filePath?: string;
    requestedByDeviceId: string;
    archivedAt: string;
  }>;
}

// ULTRA-FAST TRUNCATE WORKSPACE CLEARING (5ms TRUNCATE TABLE WITH ACTION BATCH ID)
export async function archiveAndClearAllWorkspace(jobsToClear: MediaJob[], dbUrl: string): Promise<boolean> {
  if (jobsToClear.length === 0) return true;
  try {
    await initializeDatabaseTables(dbUrl).catch(console.error);
    const db = createNeonClient(dbUrl);
    const batchId = `batch_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const actionType = 'CLEAR_WORKSPACE';

    const historyEntries = jobsToClear.map((j) => ({
      id: crypto.randomUUID(),
      batchId,
      actionType,
      originalJobId: j.id,
      url: j.url,
      title: j.title || null,
      platform: j.platform,
      finalStatus: j.status,
      filePath: j.filePath || null,
      requestedByDeviceId: j.requestedByDeviceId,
      archivedAt: new Date(),
    }));

    // 1. Batch insert into media_history vault
    try {
      await db.insert(mediaHistory).values(historyEntries);
    } catch (insertErr) {
      console.warn('Failed to insert history entries into DB:', insertErr);
    }

    // 2. ULTRA-FAST 5ms TRUNCATE TABLE statement directly on Neon Postgres
    const sql = neon(dbUrl);
    await sql`TRUNCATE TABLE media_queue;`;

    return true;
  } catch (err) {
    console.error('Failed to truncate media_queue table:', err);
    return false;
  }
}

// BULK SUBSET JOBS CLEARING (WHERE id IN (...) WITH ACTION BATCH ID)
export async function archiveAndClearSubsetJobs(
  jobsToClear: MediaJob[],
  dbUrl: string,
  actionType: 'CLEAR_COMPLETED' | 'BULK_DELETE' | 'SINGLE_DELETE' = 'CLEAR_COMPLETED'
): Promise<boolean> {
  if (jobsToClear.length === 0) return true;
  try {
    await initializeDatabaseTables(dbUrl).catch(console.error);
    const db = createNeonClient(dbUrl);
    const batchId = `batch_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

    const historyEntries = jobsToClear.map((j) => ({
      id: crypto.randomUUID(),
      batchId,
      actionType,
      originalJobId: j.id,
      url: j.url,
      title: j.title || null,
      platform: j.platform,
      finalStatus: j.status,
      filePath: j.filePath || null,
      requestedByDeviceId: j.requestedByDeviceId,
      archivedAt: new Date(),
    }));

    const jobIds = jobsToClear.map((j) => j.id);

    // 1. Batch insert into media_history vault
    try {
      await db.insert(mediaHistory).values(historyEntries);
    } catch (insertErr) {
      console.warn('Failed to insert history entries into DB:', insertErr);
    }

    // 2. SINGLE BULK DELETE statement via inArray (1 HTTP query!)
    await db.delete(mediaQueue).where(inArray(mediaQueue.id, jobIds));

    return true;
  } catch (err) {
    console.error('Failed to clear subset jobs:', err);
    return false;
  }
}

export async function archiveAndClearJobs(jobsToClear: MediaJob[], dbUrl: string): Promise<boolean> {
  return archiveAndClearSubsetJobs(jobsToClear, dbUrl, 'CLEAR_COMPLETED');
}

export async function fetchMediaHistory(dbUrl: string): Promise<any[]> {
  try {
    const db = createNeonClient(dbUrl);
    await initializeDatabaseTables(dbUrl).catch(console.error);
    const records = await db.select().from(mediaHistory).orderBy(desc(mediaHistory.archivedAt));
    return records;
  } catch (err) {
    console.error('Failed to fetch media history:', err);
    return [];
  }
}

export function groupHistoryByActionBatches(records: any[]): HistoryBatchGroup[] {
  const map = new Map<string, HistoryBatchGroup>();

  for (const r of records) {
    const dateKey = r.archivedAt ? new Date(r.archivedAt).toISOString().slice(0, 16) : 'legacy';
    const bId = r.batchId || `legacy_${dateKey}`;
    const aType = r.actionType || (r.finalStatus === 'completed' ? 'CLEAR_COMPLETED' : 'CLEAR_WORKSPACE');

    if (!map.has(bId)) {
      map.set(bId, {
        batchId: bId,
        actionType: aType,
        archivedAt: r.archivedAt ? new Date(r.archivedAt).toISOString() : new Date().toISOString(),
        items: [],
      });
    }

    map.get(bId)!.items.push({
      id: r.id,
      originalJobId: r.originalJobId || undefined,
      url: r.url,
      title: r.title || undefined,
      platform: r.platform || 'media',
      finalStatus: r.finalStatus || 'cleared',
      filePath: r.filePath || undefined,
      requestedByDeviceId: r.requestedByDeviceId || 'desktop',
      archivedAt: r.archivedAt ? new Date(r.archivedAt).toISOString() : new Date().toISOString(),
    });
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime()
  );
}

// RESTORE ENTIRE BATCH OR SINGLE ITEM BACK TO LIVE MEDIA QUEUE & REMOVE FROM HISTORY VAULT
export async function restoreBatchToQueue(batchItems: any[], dbUrl: string): Promise<boolean> {
  if (batchItems.length === 0) return true;
  try {
    const db = createNeonClient(dbUrl);
    await initializeDatabaseTables(dbUrl).catch(console.error);

    const queueEntries = batchItems.map((item) => {
      const payload = createMediaJobPayload(item.url, 'restored_from_history');
      const isCompleted = item.finalStatus === 'completed' || item.status === 'completed' || !!item.filePath;
      return {
        id: payload.id,
        url: payload.url,
        title: item.title || payload.title,
        platform: item.platform || payload.platform,
        status: isCompleted ? 'completed' : (item.finalStatus || item.status || 'pending'),
        requestedByDeviceId: item.requestedByDeviceId || 'restored_history',
        progress: isCompleted ? 100 : (item.progress || 0),
        filePath: item.filePath || null,
      };
    });

    // 1. Re-enqueue items back into live media_queue
    await db.insert(mediaQueue).values(queueEntries);

    // 2. Remove restored items from media_history vault (1 single query!)
    const historyItemIds = batchItems.map((item) => item.id).filter(Boolean);
    if (historyItemIds.length > 0) {
      await db.delete(mediaHistory).where(inArray(mediaHistory.id, historyItemIds));
    }

    return true;
  } catch (err) {
    console.error('Failed to restore batch to queue:', err);
    return false;
  }
}

export async function clearMediaHistoryVault(dbUrl: string): Promise<boolean> {
  try {
    const db = createNeonClient(dbUrl);
    await initializeDatabaseTables(dbUrl).catch(console.error);
    await db.delete(mediaHistory);
    return true;
  } catch (err) {
    console.error('Failed to clear media history vault:', err);
    return false;
  }
}

export function exportHistoryToTxt(records: any[]): string {
  const batches = groupHistoryByActionBatches(records);
  const header = `==================================================\nCLIPGRAB ACTION-BASED HISTORY EXPORT\nGenerated At: ${new Date().toISOString()}\nTotal Action Batches: ${batches.length}\nTotal Archived Links: ${records.length}\n==================================================\n\n`;

  const body = batches
    .map((b, bIdx) => {
      const dateStr = new Date(b.archivedAt).toLocaleString();
      const actionName = (b.actionType || 'ACTION_BATCH').replace(/_/g, ' ');
      const itemLines = b.items
        .map(
          (item, i) =>
            `   [${i + 1}] [${item.platform.toUpperCase()}] ${item.title ? `"${item.title}" - ` : ''}${item.url}${item.filePath ? ` (Saved: ${item.filePath})` : ''}`
        )
        .join('\n');
      return `BATCH #${bIdx + 1} | [${actionName}] | [${dateStr}] | (${b.items.length} links)\n--------------------------------------------------\n${itemLines}\n`;
    })
    .join('\n');

  return header + body;
}

export async function runInstagramEmbedScraper(
  url: string,
  downloadDir: string,
  onLogOutput?: (type: 'stdout' | 'stderr' | 'info', text: string) => void
): Promise<{ success: boolean; files: string[]; error?: string }> {
  try {
    const pyScript = `import urllib.request, re, ssl, json, os, sys

ssl._create_default_https_context = ssl._create_unverified_context
raw_url = sys.argv[1]
out_dir = sys.argv[2]

shortcode_match = re.search(r'/(?:p|reel|reels)/([A-Za-z0-9_-]+)', raw_url)
shortcode = shortcode_match.group(1) if shortcode_match else 'post'
embed_url = f'https://www.instagram.com/p/{shortcode}/embed/captioned/'

req = urllib.request.Request(embed_url, headers={
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
})

try:
    html = urllib.request.urlopen(req).read().decode('utf-8')
except Exception as e:
    print(json.dumps({'success': False, 'error': str(e)}))
    sys.exit(0)

author_match = re.search(r'"username":\s*"([^"]+)"', html) or re.search(r'class="UsernameText">([^<]+)', html)
author = author_match.group(1) if author_match else 'instagram_user'

cdn_pattern = r"""https://[^\s"'><]+\.(?:jpg|jpeg|png|webp)[^\s"'><]*"""
raw_urls = re.findall(cdn_pattern, html)

downloaded = []
seen = set()

idx = 1
for u in raw_urls:
    u_clean = u.replace('&amp;', '&').replace('\\u0026', '&')
    if 'profile_pic' in u_clean or 's150x150' in u_clean or 's320x320' in u_clean:
        continue
    
    clean_cdn_url = re.sub(r'stp=[^&]+&?', '', u_clean)
    if clean_cdn_url in seen:
        continue
    seen.add(clean_cdn_url)

    ext = 'jpg'
    if '.png' in u_clean: ext = 'png'
    elif '.webp' in u_clean: ext = 'webp'

    fn = f'Photo by {author}_{shortcode}_{idx}.{ext}'
    idx += 1

    img_req = urllib.request.Request(clean_cdn_url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })
    try:
        data = urllib.request.urlopen(img_req).read()
        if len(data) > 3000:
            os.makedirs(out_dir, exist_ok=True)
            target_path = os.path.join(out_dir, fn)
            with open(target_path, 'wb') as f:
                f.write(data)
            downloaded.append(target_path)
    except Exception:
        pass

print(json.dumps({'success': len(downloaded) > 0, 'files': downloaded}))
`;

    const shCmd = `${MACOS_PATH_ENV} python3 - "${url.replace(/"/g, '\\"')}" "${downloadDir.replace(/"/g, '\\"')}" << 'PYEOF'\n${pyScript}\nPYEOF\n`;
    const cmd = Command.create('sh', ['-c', shCmd]);
    const output = await cmd.execute();

    if (onLogOutput && output.stderr) {
      onLogOutput('stderr', output.stderr);
    }

    if (output.code === 0 && output.stdout) {
      const parsed = JSON.parse(output.stdout.trim());
      if (parsed.success && parsed.files && parsed.files.length > 0) {
        if (onLogOutput) {
          onLogOutput('info', `[INSTAGRAM NATIVE] Extracted ${parsed.files.length} photo file(s) cleanly.`);
        }
        return { success: true, files: parsed.files };
      } else if (parsed.error) {
        return { success: false, files: [], error: parsed.error };
      }
    }
  } catch (err: any) {
    console.error('runInstagramEmbedScraper error:', err);
    if (onLogOutput) {
      onLogOutput('stderr', `[EMBED ERR] ${err?.message || err}`);
    }
    return { success: false, files: [], error: err?.message || String(err) };
  }
  return { success: false, files: [], error: 'No media extracted from public embed page' };
}

export async function executeJobDownload(
  job: MediaJob,
  config: DownloadConfig,
  dbUrl: string,
  onProgress?: (jobId: string, progress: number, status: MediaJob['status']) => void,
  onLogOutput?: (jobId: string, type: 'stdout' | 'stderr' | 'info', text: string) => void
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const db = createNeonClient(dbUrl);
  const targetUrl = cleanMediaUrl(job.url);

  // Update status to 'downloading'
  try {
    await db
      .update(mediaQueue)
      .set({ status: 'downloading', progress: 5, updatedAt: new Date() })
      .where(eq(mediaQueue.id, job.id));
    if (onProgress) onProgress(job.id, 5, 'downloading');
  } catch (err) {
    console.error('Failed to set downloading status in DB:', err);
  }

  const ytdlpAvailable = await checkToolAvailability('yt-dlp');
  if (!ytdlpAvailable) {
    const errorMsg = 'yt-dlp binary is not installed on system PATH. Install it using "brew install yt-dlp" in your terminal.';
    if (onLogOutput) {
      onLogOutput(job.id, 'stderr', `[ERR] ${errorMsg}`);
    }
    await db
      .update(mediaQueue)
      .set({ status: 'failed', error: errorMsg, updatedAt: new Date() })
      .where(eq(mediaQueue.id, job.id));
    if (onProgress) onProgress(job.id, 0, 'failed');
    return { success: false, error: errorMsg };
  }

  const runSingleAttempt = (): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    return new Promise((resolve) => {
      let args: string[] = [];
      const toolBinary = 'yt-dlp';
      let detectedFilePath = '';

      const outputTemplate = `${expandUserPath(config.downloadPath)}/%(title)s_%(id)s.%(ext)s`;

      args = [
        '--progress',
        '--newline',
        '--print', 'after_move:filepath',
        '--embed-metadata',
        '--parse-metadata', 'webpage_url:%(meta_comment)s',
        '--parse-metadata', 'webpage_url:%(meta_purl)s',
        '--parse-metadata', 'webpage_url:%(meta_description)s',
        '-o', outputTemplate
      ];

        // Quality selection
        if (config.quality === '4k') {
          args.push('-f', 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best');
        } else if (config.quality === '1080p') {
          args.push('-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best');
        } else if (config.quality === '720p') {
          args.push('-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best');
        } else if (config.quality === '480p') {
          args.push('-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]/best');
        } else {
          args.push('-f', 'bestvideo+bestaudio/best');
        }

        if (config.container === 'mp3' || config.quality === 'audio') {
          args.push('-x', '--audio-format', 'mp3');
          if (config.audioQuality !== 'best') {
            args.push('--audio-quality', config.audioQuality);
          }
        } else {
          // ULTRA-FAST SUB-SECOND REMUXING & APPLE HARDWARE ACCELERATED ENCODING
          const targetContainer = config.container || 'mp4';

          if (config.videoCodec === 'auto' || config.videoCodec === 'h264') {
            // Direct Fast Stream Remuxing (Zero CPU re-encoding, sub-second finish!)
            args.push('--remux-video', targetContainer);
            args.push('-S', 'vcodec:h264,vcodec:avc,res,acodec:m4a,acodec:aac');
          } else if (config.videoCodec === 'h265') {
            // Apple VideoToolbox Hardware Accelerated HEVC (20x faster GPU hardware encoding!)
            args.push('--recode-video', targetContainer);
            args.push('--postprocessor-args', 'ffmpeg: -c:v hevc_videotoolbox -tag:v hvc1 -c:a aac');
          } else {
            args.push('--recode-video', targetContainer);
            args.push('--postprocessor-args', `ffmpeg: -c:v ${config.videoCodec === 'av1' ? 'libsvtav1' : 'libvpx-vp9'} -preset fast -c:a aac`);
          }
        }

        args.push(targetUrl);

      const commandToExec = `${MACOS_PATH_ENV} ${toolBinary} ${args.map((a) => `"${a}"`).join(' ')}`;
      if (onLogOutput) {
        onLogOutput(job.id, 'info', `$ ${toolBinary} ${args.map((a) => `"${a}"`).join(' ')}`);
      }

      try {
        const cmd = Command.create('sh', ['-c', commandToExec]);
        let lastProgress = 5;
        let lastDbProgress = 5;
        let activeStreamIndex = 0;
        let detectedFilePath: string | undefined;
        let detectedFilePaths: string[] = [];

        cmd.stdout.on('data', (chunk: string) => {
          // Split stdout by carriage returns (\r) and newlines (\n)
          const lines = chunk.split(/[\r\n]+/);
          for (const line of lines) {
            if (!line.trim()) continue;

            if (onLogOutput) {
              onLogOutput(job.id, 'stdout', line);
            }

            // Track destination files & streams
            const trimmedLine = line.trim();

            if ((trimmedLine.startsWith('/Users/') || trimmedLine.startsWith('/') || trimmedLine.startsWith('C:\\')) && !trimmedLine.includes('[download]') && !trimmedLine.includes('[info]')) {
              const cleanPath = trimmedLine.replace(/^["']|["']$/g, '');
              if (!cleanPath.endsWith('.tmp') && !cleanPath.endsWith('.part')) {
                detectedFilePath = cleanPath;
                if (!detectedFilePaths.includes(cleanPath)) detectedFilePaths.push(cleanPath);
              }
            } else if (line.includes('Destination:')) {
              activeStreamIndex++;
              const candidate = line.replace(/.*Destination:/, '').trim().replace(/^["']|["']$/g, '');
              if (!candidate.endsWith('.tmp') && !candidate.endsWith('.part')) {
                detectedFilePath = candidate;
                if (!detectedFilePaths.includes(candidate)) detectedFilePaths.push(candidate);
              }
            } else {
              const destMatch = line.match(/(?:Merging formats into|has already been downloaded|output is)\s+["']?([^"'\r\n]+)/i);
              if (destMatch && destMatch[1]) {
                const candidate = destMatch[1].trim().replace(/^["']|["']$/g, '');
                if (!candidate.endsWith('.tmp') && !candidate.endsWith('.part')) {
                  detectedFilePath = candidate;
                  if (!detectedFilePaths.includes(candidate)) detectedFilePaths.push(candidate);
                }
              }
            }

            // Parse progress e.g. "[download]  45.6% of  15.20MiB"
            const progressMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/i);
            if (progressMatch) {
              const pct = parseFloat(progressMatch[1]);
              let mappedProgress = 5;

              if (activeStreamIndex <= 1) {
                // Stream 1 (video): 5% -> 75%
                mappedProgress = 5 + Math.round(pct * 0.70);
              } else {
                // Stream 2 (audio): 75% -> 92%
                mappedProgress = 75 + Math.round(pct * 0.17);
              }

              mappedProgress = Math.min(Math.max(mappedProgress, 5), 94);

              if (mappedProgress > lastProgress) {
                lastProgress = mappedProgress;
                
                // 1. Instantly update React local UI state with zero latency
                if (onProgress) {
                  onProgress(job.id, mappedProgress, 'downloading');
                }

                // 2. Throttle Neon Postgres DB writes to every 10% step
                if (mappedProgress - lastDbProgress >= 10) {
                  lastDbProgress = mappedProgress;
                  db.update(mediaQueue)
                    .set({ progress: mappedProgress, updatedAt: new Date() })
                    .where(eq(mediaQueue.id, job.id))
                    .catch(console.error);
                }
              }
            } else if (line.includes('[ffmpeg]') || line.includes('[Merger]') || line.includes('[VideoConvertor]')) {
              lastProgress = 95;
              if (onProgress) {
                onProgress(job.id, 95, 'downloading');
              }
            }
          }
        });

        cmd.stderr.on('data', (data: string) => {
          if (onLogOutput) {
            onLogOutput(job.id, 'stderr', data);
          }
          console.warn(`[${toolBinary} stderr]:`, data);
        });

        cmd.on('close', async (data) => {
          activeChildProcesses.delete(job.id);

          if (data.code === 0) {
            if (onLogOutput) {
              onLogOutput(job.id, 'info', `✔ Process completed successfully (exit code 0)`);
            }

            // SAFEGUARD: Only return detectedFilePath if it's a specific file, NEVER the parent directory
            const targetFilePath = detectedFilePaths.length > 0
              ? detectedFilePaths.join('||')
              : (detectedFilePath && detectedFilePath !== expandUserPath(config.downloadPath) ? detectedFilePath : undefined);

            resolve({ success: true, filePath: targetFilePath });
          } else {
            const errorMsg = `Process exited with code ${data.code}`;
            resolve({ success: false, error: errorMsg });
          }
        });

        cmd.spawn().then((child) => {
          activeChildProcesses.set(job.id, child);
        }).catch((err) => {
          activeChildProcesses.delete(job.id);
          const errorMsg = err?.message || `Failed to spawn ${toolBinary}.`;
          resolve({ success: false, error: errorMsg });
        });
      } catch (err: any) {
        activeChildProcesses.delete(job.id);
        const errorMsg = err?.message || 'Download execution error';
        resolve({ success: false, error: errorMsg });
      }
    });
  };

  const isInstagramPhoto = targetUrl.includes('instagram.com/p/');
  const isInstagramReel = targetUrl.includes('instagram.com/reel/') || targetUrl.includes('instagram.com/reels/');

  let result: { success: boolean; filePath?: string; error?: string } = { success: false };

  // 1. For Instagram Photo posts (/p/): Run Public Embed Scraper EXCLUSIVELY!
  if (isInstagramPhoto) {
    if (onLogOutput) {
      onLogOutput(job.id, 'info', '[INSTAGRAM PHOTO] Extracting photos directly via Public Instagram Embed Engine...');
    }
    try {
      const embedResult = await runInstagramEmbedScraper(
        targetUrl,
        expandUserPath(config.downloadPath),
        (type, text) => { if (onLogOutput) onLogOutput(job.id, type, text); }
      );
      if (embedResult.success && embedResult.files.length > 0) {
        result = { success: true, filePath: embedResult.files.join('||') };
        if (onLogOutput) {
          onLogOutput(job.id, 'info', `[INSTAGRAM PHOTO] ✔ Successfully downloaded ${embedResult.files.length} photo file(s) via Public Embed Engine!`);
        }
      } else {
        const errorMsg = embedResult.error || 'Failed to extract photos from public embed page';
        if (onLogOutput) {
          onLogOutput(job.id, 'stderr', `[ERR] ${errorMsg}`);
        }
        await db
          .update(mediaQueue)
          .set({ status: 'failed', error: errorMsg, updatedAt: new Date() })
          .where(eq(mediaQueue.id, job.id));
        if (onProgress) onProgress(job.id, 0, 'failed');
        return { success: false, error: errorMsg };
      }
    } catch (e: any) {
      const errorMsg = e?.message || 'Instagram Embed Engine execution failed';
      if (onLogOutput) {
        onLogOutput(job.id, 'stderr', `[ERR] ${errorMsg}`);
      }
      await db
        .update(mediaQueue)
        .set({ status: 'failed', error: errorMsg, updatedAt: new Date() })
        .where(eq(mediaQueue.id, job.id));
      if (onProgress) onProgress(job.id, 0, 'failed');
      return { success: false, error: errorMsg };
    }
  } else {
    // 2. For Instagram Reels (/reel/, /reels/) and all other video links: Run yt-dlp directly!
    if (isInstagramReel && onLogOutput) {
      onLogOutput(job.id, 'info', '[INSTAGRAM REEL] Extracting video stream directly via yt-dlp...');
    }
    result = await runSingleAttempt();
  }

  // Update DB on final outcome with exact file path string
  if (result.success) {
    const finalFilePath = result.filePath || undefined;
    let extractedTitle = job.title;

    if (finalFilePath) {
      const firstPath = finalFilePath.split('||')[0];
      const filename = firstPath.split('/').pop() || '';
      const cleanTitle = filename.replace(/\.[^/.]+$/, '');
      if (cleanTitle) {
        extractedTitle = cleanTitle;
      }

      // Universal FFmpeg Metadata URL Stamper (Zero re-encoding, 5ms execution)
      const expandedPath = expandUserPath(firstPath);
      const extIndex = expandedPath.lastIndexOf('.');
      const ext = extIndex !== -1 ? expandedPath.substring(extIndex) : '.mp4';
      const tempPath = expandedPath + '.meta_tmp' + ext;
      const safeTarget = expandedPath.replace(/"/g, '\\"');
      const safeTemp = tempPath.replace(/"/g, '\\"');
      const safeUrl = targetUrl.replace(/"/g, '\\"');

      const stampScript = `
        ${MACOS_PATH_ENV}
        if [ -f "${safeTarget}" ]; then
          ffmpeg -y -i "${safeTarget}" -metadata comment="${safeUrl}" -metadata description="${safeUrl}" -metadata purl="${safeUrl}" -metadata title="${(extractedTitle || '').replace(/"/g, '\\"')}" -c copy "${safeTemp}" 2>/dev/null && mv -f "${safeTemp}" "${safeTarget}" 2>/dev/null
        fi
      `;

      try {
        const stampCmd = Command.create('sh', ['-c', stampScript]);
        await stampCmd.execute();
      } catch (e) {
        console.warn('Failed to stamp metadata via FFmpeg:', e);
      }

      // Eagle App Automatic Local Sync
      try {
        const eagleRes = await sendToEagleApp(finalFilePath, targetUrl, extractedTitle || job.title, job.platform, config.eagleApiToken, config.eaglePort);
        if (eagleRes.success && onLogOutput) {
          onLogOutput(job.id, 'info', `[EAGLE] 🦅 Automatically imported ${eagleRes.message}`);
        }
      } catch (e) {
        // Eagle App closed or not running (silent fallback)
      }
    }

    await db
      .update(mediaQueue)
      .set({
        status: 'completed',
        progress: 100,
        title: extractedTitle || job.title,
        ...(finalFilePath ? { filePath: finalFilePath } : {}),
        updatedAt: new Date()
      })
      .where(eq(mediaQueue.id, job.id))
      .catch(console.error);

    if (onProgress) onProgress(job.id, 100, 'completed');
    sendSystemNotification('ClipGrab Download Complete', `Media downloaded successfully: ${extractedTitle || job.url}`);
  } else {
    const finalErr = result.error || 'Execution failed';
    if (onLogOutput) {
      onLogOutput(job.id, 'stderr', `[ERR] ${finalErr}`);
    }
    await db
      .update(mediaQueue)
      .set({ status: 'failed', error: finalErr, updatedAt: new Date() })
      .where(eq(mediaQueue.id, job.id))
      .catch(console.error);
    if (onProgress) onProgress(job.id, 0, 'failed');
    sendSystemNotification('ClipGrab Download Failed', `Download encountered an error: ${finalErr}`);
  }

  return result;
}

function deriveLowercaseTag(url: string, platform?: string): string {
  try {
    if (!url) return (platform && platform !== 'unknown' && platform !== 'direct') ? platform.toLowerCase() : 'media';
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    let host = parsed.hostname.toLowerCase().replace(/^www\./, '');

    if (host.includes('youtube') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('instagram')) return 'instagram';
    if (host.includes('twitter') || host === 'x.com' || host.endsWith('.x.com')) return 'x';
    if (host.includes('linkedin')) return 'linkedin';
    if (host.includes('tiktok')) return 'tiktok';
    if (host.includes('facebook') || host.includes('fb.watch')) return 'facebook';
    if (host.includes('pinterest') || host.includes('pin.it')) return 'pinterest';
    if (host.includes('reddit')) return 'reddit';

    const parts = host.split('.');
    if (parts.length >= 2) {
      return parts[parts.length - 2].toLowerCase();
    }
    return host.toLowerCase();
  } catch {
    if (platform && platform !== 'unknown' && platform !== 'direct') {
      if (platform.toLowerCase() === 'twitter') return 'x';
      return platform.toLowerCase();
    }
    return 'media';
  }
}

export async function sendToEagleApp(
  filePath: string,
  url: string,
  title?: string,
  platform?: string,
  token?: string,
  port?: string | number
): Promise<{ success: boolean; message: string }> {
  try {
    const activePort = port ? String(port).trim() : '22745';
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
    const endpoint = `http://127.0.0.1:${activePort}/api/item/addFromPath${tokenQuery}`;

    // Collect all target file paths (split pipe-delimited or find sibling files)
    let filesToSync: string[] = [];

    if (filePath.includes('||')) {
      filesToSync = filePath.split('||').map((p) => expandUserPath(p.trim())).filter(Boolean);
    } else {
      const singlePath = expandUserPath(filePath);
      filesToSync.push(singlePath);

      // Check for sibling numbered files (e.g. Photo by user_1.jpg, Photo by user_2.jpg...)
      try {
        const lastSlash = singlePath.lastIndexOf('/');
        if (lastSlash !== -1) {
          const dir = singlePath.substring(0, lastSlash);
          const filename = singlePath.substring(lastSlash + 1);
          const match = filename.match(/^(.*)_\d+\.([^.]+)$/);

          if (match && dir) {
            const prefix = match[1]; // e.g. "Photo by naridarbandi"
            const safeDir = dir.replace(/"/g, '\\"');
            const safePrefix = prefix.replace(/"/g, '\\"');
            
            const findCmd = Command.create('sh', [
              '-c',
              `ls -1 "${safeDir}/${safePrefix}"_* 2>/dev/null`
            ]);
            const output = await findCmd.execute();
            if (output.code === 0 && output.stdout) {
              const lines = output.stdout.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
              if (lines.length > 0) {
                filesToSync = lines;
              }
            }
          }
        }
      } catch (e) {
        // Fall back to singlePath
      }
    }

    if (filesToSync.length === 0) {
      return { success: false, message: 'No valid files found to sync to Eagle.' };
    }

    let successCount = 0;
    let lastErr = '';
    const sourceTag = deriveLowercaseTag(url, platform);

    for (let i = 0; i < filesToSync.length; i++) {
      const targetPath = filesToSync[i];
      const filename = targetPath.split('/').pop() || '';
      const baseName = filename.replace(/\.[^/.]+$/, '');
      const itemTitle = baseName;

      const itemPayload = {
        path: targetPath,
        name: itemTitle,
        url: url,
        website: url,
        annotation: url,
        tags: [sourceTag],
        ...(token ? { token } : {}),
      };

      const payloadJson = JSON.stringify(itemPayload);
      let imported = false;

      // 1. Try webview fetch
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payloadJson,
        });

        if (res.ok) {
          const data = await res.json();
          if (data.status === 'success') {
            imported = true;
          } else if (data.message) {
            lastErr = data.message;
          }
        }
      } catch (e1) {
        // Fallback to curl
      }

      // 2. Fallback via curl shell command
      if (!imported) {
        try {
          const safeEscapedJson = payloadJson.replace(/'/g, "'\\''");
          const curlCmd = Command.create('sh', [
            '-c',
            `curl -s -X POST "${endpoint}" -H "Content-Type: application/json" -d '${safeEscapedJson}'`
          ]);
          const output = await curlCmd.execute();
          if (output.code === 0 && output.stdout) {
            const data = JSON.parse(output.stdout);
            if (data.status === 'success') {
              imported = true;
            } else if (data.message) {
              lastErr = data.message;
            }
          }
        } catch (curlErr) {
          console.error('Curl fallback failed:', curlErr);
        }
      }

      if (imported) {
        successCount++;
      }
    }

    if (successCount > 0) {
      return {
        success: true,
        message: `Successfully imported ${successCount} file(s) into Eagle App!`,
      };
    }

    return {
      success: false,
      message: lastErr || `Could not connect to Eagle App on port ${activePort}.`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Eagle App sync error: ${err?.message || err}`,
    };
  }
}
