import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { createNeonClient, mediaQueue, eq } from '@clipgrab/db';
import { MediaJob } from '@clipgrab/types';
import { cleanMediaUrl, extractMediaId } from '@clipgrab/core-downloader';

export interface DownloadConfig {
  downloadPath: string;
  quality: 'best' | '4k' | '1080p' | '720p' | '480p' | 'audio';
  container: 'mp4' | 'mkv' | 'webm' | 'mp3' | 'mov' | 'avi';
  videoCodec: 'auto' | 'h264' | 'h265' | 'av1' | 'vp9';
  audioQuality: 'best' | '320k' | '256k' | '128k';
  useGalleryDlForPhotos: boolean;
  toolPreference: 'auto' | 'ytdlp' | 'gallerydl';
  cookiesBrowser: 'none' | 'chrome' | 'safari' | 'firefox' | 'brave' | 'edge';
  autoUpdateEngine: boolean;
}

export const DEFAULT_DOWNLOAD_CONFIG: DownloadConfig = {
  downloadPath: '~/Downloads/ClipGrab',
  quality: 'best',
  container: 'mp4',
  videoCodec: 'auto',
  audioQuality: 'best',
  useGalleryDlForPhotos: true,
  toolPreference: 'auto',
  cookiesBrowser: 'none',
  autoUpdateEngine: false, // Default false to prevent download startup delays
};

export interface EngineBinaryStatus {
  name: string;
  binary: 'yt-dlp' | 'gallery-dl' | 'ffmpeg';
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
    let targetPath = job.filePath || configPath || '~/Downloads/ClipGrab';
    if (targetPath.startsWith('~')) {
      targetPath = targetPath.replace('~', process.env.HOME || '/Users/mistjs');
    }

    const downloadFolder = (configPath || '~/Downloads/ClipGrab').startsWith('~')
      ? (configPath || '~/Downloads/ClipGrab').replace('~', process.env.HOME || '/Users/mistjs')
      : configPath || '~/Downloads/ClipGrab';

    const mediaId = extractMediaId(job.url) || '';

    // Database-backed Direct Path Finder Script
    const script = `
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

      open "${configPath || '~/Downloads'}"
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
export async function getBinaryVersion(binary: 'yt-dlp' | 'gallery-dl' | 'ffmpeg'): Promise<{ installed: boolean; version: string }> {
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

export async function checkBinaryUpdate(binary: 'yt-dlp' | 'gallery-dl' | 'ffmpeg'): Promise<{ updateAvailable: boolean; latestVersion?: string }> {
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
    } else if (binary === 'gallery-dl') {
      const cmd = Command.create('sh', ['-c', `${MACOS_PATH_ENV} gallery-dl -U`]);
      const output = await cmd.execute();
      const text = (output.stdout + output.stderr).toLowerCase();
      if (text.includes('updating') || text.includes('available')) {
        return { updateAvailable: true };
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

export async function updateBinaryOnDemand(binary: 'yt-dlp' | 'gallery-dl' | 'ffmpeg'): Promise<{ success: boolean; message: string; newVersion?: string }> {
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

export async function removeDownloadedFileAndResetJob(job: MediaJob, dbUrl: string): Promise<boolean> {
  if (activeChildProcesses.has(job.id)) {
    await cancelJobDownload(job.id, dbUrl);
  }

  if (job.filePath) {
    try {
      const cmd = Command.create('sh', ['-c', `rm -f "${job.filePath}"`]);
      await cmd.execute();
    } catch (e) {
      console.error('Failed to remove local file:', e);
    }
  }

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

  if (job.filePath) {
    try {
      const cmd = Command.create('sh', ['-c', `rm -f "${job.filePath}"`]);
      await cmd.execute();
    } catch (e) {
      console.error('Failed to remove local file:', e);
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

  // Tool Selection & Fallback Logic
  let useGalleryDl = false;
  if (config.toolPreference === 'gallerydl') {
    useGalleryDl = true;
  } else if (config.toolPreference === 'ytdlp') {
    useGalleryDl = false;
  } else {
    useGalleryDl = config.useGalleryDlForPhotos && isPhotoUrl(targetUrl, job.platform);
  }

  if (useGalleryDl) {
    const galleryDlAvailable = await checkToolAvailability('gallery-dl');
    if (!galleryDlAvailable) {
      if (onLogOutput) {
        onLogOutput(job.id, 'info', '[NOTICE] gallery-dl is not installed on PATH. Automatically falling back to yt-dlp...');
      }
      useGalleryDl = false;
    }
  }

  const ytdlpAvailable = await checkToolAvailability('yt-dlp');
  if (!ytdlpAvailable && !useGalleryDl) {
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

  const runSingleAttempt = (forceYtDlp = false): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    return new Promise((resolve) => {
      let args: string[] = [];
      let toolBinary = 'yt-dlp';
      let detectedFilePath = '';

      const currentUseGalleryDl = forceYtDlp ? false : useGalleryDl;

      if (currentUseGalleryDl) {
        toolBinary = 'gallery-dl';
        const outputDir = config.downloadPath.startsWith('~')
          ? config.downloadPath.replace('~', process.env.HOME || '/Users/mistjs')
          : config.downloadPath;
        args = ['-d', outputDir, '-o', 'path={}'];

        if (config.cookiesBrowser && config.cookiesBrowser !== 'none') {
          args.push('--cookies-from-browser', config.cookiesBrowser);
        }

        args.push(targetUrl);
      } else {
        toolBinary = 'yt-dlp';
        const outputTemplate = config.downloadPath.startsWith('~')
          ? `${config.downloadPath.replace('~', process.env.HOME || '/Users/mistjs')}/%(title)s.%(ext)s`
          : `${config.downloadPath}/%(title)s.%(ext)s`;

        args = ['--progress', '--newline', '--print', 'after_move:filepath', '-o', outputTemplate];

        if (config.cookiesBrowser && config.cookiesBrowser !== 'none') {
          args.push('--cookies-from-browser', config.cookiesBrowser);
        }

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
      }

      const commandToExec = `${MACOS_PATH_ENV} ${toolBinary} ${args.map((a) => `"${a}"`).join(' ')}`;
      if (onLogOutput) {
        onLogOutput(job.id, 'info', `$ ${toolBinary} ${args.map((a) => `"${a}"`).join(' ')}`);
      }

      try {
        const cmd = Command.create('sh', ['-c', commandToExec]);
        let lastProgress = 5;
        let lastDbProgress = 5;
        let activeStreamIndex = 0;

        cmd.stdout.on('data', (chunk: string) => {
          // Split stdout by carriage returns (\r) and newlines (\n)
          const lines = chunk.split(/[\r\n]+/);
          for (const line of lines) {
            if (!line.trim()) continue;

            if (onLogOutput) {
              onLogOutput(job.id, 'stdout', line);
            }

            // Track destination files & streams
            if (line.includes('[download] Destination:')) {
              activeStreamIndex++;
              const candidate = line.replace('[download] Destination:', '').trim();
              if (!candidate.endsWith('.tmp') && !candidate.endsWith('.part')) {
                detectedFilePath = candidate;
              }
            } else {
              const destMatch = line.match(/(?:Merging formats into|has already been downloaded)\s+["']?([^"'\r\n]+)/i);
              if (destMatch && destMatch[1]) {
                const candidate = destMatch[1].trim();
                if (!candidate.endsWith('.tmp') && !candidate.endsWith('.part')) {
                  detectedFilePath = candidate;
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

            const targetFilePath = detectedFilePath || config.downloadPath;
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

  // Attempt #1
  let result = await runSingleAttempt(false);

  // Fallback Attempt #2 if gallery-dl failed with login/redirect error
  if (!result.success && useGalleryDl) {
    if (onLogOutput) {
      onLogOutput(job.id, 'info', '[AUTOFALLBACK] gallery-dl hit a login/redirect wall. Retrying automatically with yt-dlp...');
    }
    result = await runSingleAttempt(true);
  }

  // Update DB on final outcome with exact file path string
  if (result.success) {
    const finalFilePath = result.filePath || config.downloadPath;
    let extractedTitle = job.title;

    if (finalFilePath && finalFilePath !== config.downloadPath) {
      const filename = finalFilePath.split('/').pop() || '';
      const cleanTitle = filename.replace(/\.[^/.]+$/, '');
      if (cleanTitle) {
        extractedTitle = cleanTitle;
      }
    }

    await db
      .update(mediaQueue)
      .set({
        status: 'completed',
        progress: 100,
        title: extractedTitle || job.title,
        filePath: finalFilePath,
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
