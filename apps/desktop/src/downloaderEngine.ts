import { Command } from '@tauri-apps/plugin-shell';
import { createNeonClient, mediaQueue, eq } from '@clipgrab/db';
import { MediaJob } from '@clipgrab/types';
import { cleanMediaUrl } from '@clipgrab/core-downloader';

export interface DownloadConfig {
  downloadPath: string;
  quality: 'best' | '4k' | '1080p' | '720p' | '480p' | 'audio';
  container: 'mp4' | 'mkv' | 'webm' | 'mp3' | 'mov' | 'avi';
  videoCodec: 'auto' | 'h264' | 'h265' | 'av1' | 'vp9';
  audioQuality: 'best' | '320k' | '256k' | '128k';
  useGalleryDlForPhotos: boolean;
  toolPreference: 'auto' | 'ytdlp' | 'gallerydl';
  cookiesBrowser: 'none' | 'chrome' | 'safari' | 'firefox' | 'brave' | 'edge';
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
};

// Map of active child processes running by jobId
const activeChildProcesses = new Map<string, any>();

// Standard macOS Homebrew PATH exported for GUI Tauri apps
const MACOS_PATH_ENV = 'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH";';

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
  // Only return true for explicit photo posts, not Instagram /p/ links which are often Reels
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

      const currentUseGalleryDl = forceYtDlp ? false : useGalleryDl;

      if (currentUseGalleryDl) {
        toolBinary = 'gallery-dl';
        const outputDir = config.downloadPath.startsWith('~')
          ? config.downloadPath.replace('~', process.env.HOME || '/Users/mistjs')
          : config.downloadPath;
        // Pass -o path={} to force flat directory saving without nested subfolders
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

        args = ['--newline', '-o', outputTemplate];

        if (config.cookiesBrowser && config.cookiesBrowser !== 'none') {
          args.push('--cookies-from-browser', config.cookiesBrowser);
        }

        // Codec preference sorting (-S)
        if (config.videoCodec && config.videoCodec !== 'auto') {
          if (config.videoCodec === 'h264') {
            args.push('-S', 'vcodec:h264,res,acodec');
          } else if (config.videoCodec === 'h265') {
            args.push('-S', 'vcodec:hevc,res,acodec');
          } else if (config.videoCodec === 'av1') {
            args.push('-S', 'vcodec:av01,res,acodec');
          } else if (config.videoCodec === 'vp9') {
            args.push('-S', 'vcodec:vp9,res,acodec');
          }
        }

        // Quality & Format rules
        if (config.container === 'mp3' || config.quality === 'audio') {
          args.push('-x', '--audio-format', 'mp3');
          if (config.audioQuality !== 'best') {
            args.push('--audio-quality', config.audioQuality);
          }
        } else {
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
          args.push('--merge-output-format', config.container || 'mp4');
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

        cmd.stdout.on('data', (line: string) => {
          if (onLogOutput) {
            onLogOutput(job.id, 'stdout', line);
          }

          const progressMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
          if (progressMatch) {
            const parsedProgress = Math.min(Math.round(parseFloat(progressMatch[1])), 99);
            if (parsedProgress > lastProgress) {
              lastProgress = parsedProgress;
              db.update(mediaQueue)
                .set({ progress: parsedProgress, updatedAt: new Date() })
                .where(eq(mediaQueue.id, job.id))
                .catch(console.error);
              if (onProgress) onProgress(job.id, parsedProgress, 'downloading');
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

            await db
              .update(mediaQueue)
              .set({ status: 'completed', progress: 100, updatedAt: new Date() })
              .where(eq(mediaQueue.id, job.id))
              .catch(console.error);

            if (onProgress) onProgress(job.id, 100, 'completed');
            resolve({ success: true, filePath: config.downloadPath });
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

  // Update DB on final outcome
  if (result.success) {
    await db
      .update(mediaQueue)
      .set({ status: 'completed', progress: 100, updatedAt: new Date() })
      .where(eq(mediaQueue.id, job.id))
      .catch(console.error);
    if (onProgress) onProgress(job.id, 100, 'completed');
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
  }

  return result;
}
