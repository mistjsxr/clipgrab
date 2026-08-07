import { Command } from '@tauri-apps/plugin-shell';
import { createNeonClient, mediaQueue, eq } from '@clipgrab/db';
import { MediaJob } from '@clipgrab/types';

export interface DownloadConfig {
  downloadPath: string;
  quality: 'best' | '1080p' | '720p' | '480p' | 'audio';
  format: 'mp4' | 'mkv' | 'webm' | 'mp3';
  audioQuality: 'best' | '320k' | '256k' | '128k';
  useGalleryDlForPhotos: boolean;
  toolPreference: 'auto' | 'ytdlp' | 'gallerydl';
}

export const DEFAULT_DOWNLOAD_CONFIG: DownloadConfig = {
  downloadPath: '~/Downloads/ClipGrab',
  quality: 'best',
  format: 'mp4',
  audioQuality: 'best',
  useGalleryDlForPhotos: true,
  toolPreference: 'auto',
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

export function isPhotoUrl(url: string, platform: string): boolean {
  if (platform === 'instagram' && !url.includes('/reel/') && !url.includes('/tv/')) {
    return true;
  }
  if (platform === 'twitter' && (url.includes('/photo/') || url.includes('/status/'))) {
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

export async function executeJobDownload(
  job: MediaJob,
  config: DownloadConfig,
  dbUrl: string,
  onProgress?: (jobId: string, progress: number, status: MediaJob['status']) => void,
  onLogOutput?: (jobId: string, type: 'stdout' | 'stderr' | 'info', text: string) => void
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const db = createNeonClient(dbUrl);

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
    useGalleryDl = config.useGalleryDlForPhotos && isPhotoUrl(job.url, job.platform);
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

  return new Promise((resolve) => {
    let args: string[] = [];
    let toolBinary = 'yt-dlp';

    if (useGalleryDl) {
      toolBinary = 'gallery-dl';
      const outputDir = config.downloadPath.startsWith('~')
        ? config.downloadPath.replace('~', process.env.HOME || '/Users/mistjs')
        : config.downloadPath;
      args = ['-d', outputDir, job.url];
    } else {
      toolBinary = 'yt-dlp';
      const outputTemplate = config.downloadPath.startsWith('~')
        ? `${config.downloadPath.replace('~', process.env.HOME || '/Users/mistjs')}/%(title)s.%(ext)s`
        : `${config.downloadPath}/%(title)s.%(ext)s`;

      args = ['--newline', '-o', outputTemplate];

      if (config.format === 'mp3' || config.quality === 'audio') {
        args.push('-x', '--audio-format', 'mp3');
        if (config.audioQuality !== 'best') {
          args.push('--audio-quality', config.audioQuality);
        }
      } else {
        if (config.quality === '1080p') {
          args.push('-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best');
        } else if (config.quality === '720p') {
          args.push('-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best');
        } else if (config.quality === '480p') {
          args.push('-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]/best');
        } else {
          args.push('-f', 'bestvideo+bestaudio/best');
        }
        args.push('--merge-output-format', config.format);
      }

      args.push(job.url);
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
          if (onLogOutput) {
            onLogOutput(job.id, 'stderr', `[ERR] ${errorMsg}`);
          }

          await db
            .update(mediaQueue)
            .set({ status: 'failed', error: errorMsg, updatedAt: new Date() })
            .where(eq(mediaQueue.id, job.id))
            .catch(console.error);

          if (onProgress) onProgress(job.id, lastProgress, 'failed');
          resolve({ success: false, error: errorMsg });
        }
      });

      cmd.spawn().then((child) => {
        activeChildProcesses.set(job.id, child);
      }).catch(async (err) => {
        activeChildProcesses.delete(job.id);
        const errorMsg = err?.message || `Failed to spawn ${toolBinary}. Ensure ${toolBinary} is installed on PATH.`;
        if (onLogOutput) {
          onLogOutput(job.id, 'stderr', `[ERR] ${errorMsg}`);
        }

        await db
          .update(mediaQueue)
          .set({ status: 'failed', error: errorMsg, updatedAt: new Date() })
          .where(eq(mediaQueue.id, job.id))
          .catch(console.error);

        if (onProgress) onProgress(job.id, 0, 'failed');
        resolve({ success: false, error: errorMsg });
      });
    } catch (err: any) {
      activeChildProcesses.delete(job.id);
      const errorMsg = err?.message || 'Download execution error';
      if (onLogOutput) {
        onLogOutput(job.id, 'stderr', `[ERR] ${errorMsg}`);
      }

      db.update(mediaQueue)
        .set({ status: 'failed', error: errorMsg, updatedAt: new Date() })
        .where(eq(mediaQueue.id, job.id))
        .catch(console.error);

      if (onProgress) onProgress(job.id, 0, 'failed');
      resolve({ success: false, error: errorMsg });
    }
  });
}
