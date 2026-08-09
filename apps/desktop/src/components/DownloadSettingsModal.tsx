import React, { useState, useEffect } from 'react';
import { Button, Card } from '@clipgrab/ui';
import { open } from '@tauri-apps/plugin-dialog';
import { DownloadConfig, checkToolAvailability, detectInstalledBrowsers } from '../downloaderEngine';
import { Folder, Settings2, CheckCircle2, XCircle, Sliders, Film, Music, Image as ImageIcon, Play, Wrench, Cpu } from 'lucide-react';

export interface DownloadSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: DownloadConfig;
  onSaveConfig: (newConfig: DownloadConfig) => void;
  onStartDownload?: (newConfig: DownloadConfig) => void;
  targetCount: number;
  title?: string;
}

export const DownloadSettingsModal: React.FC<DownloadSettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  onStartDownload,
  targetCount,
  title,
}) => {
  const [localConfig, setLocalConfig] = useState<DownloadConfig>(config);
  const [toolsStatus, setToolsStatus] = useState<{ ytdlp: boolean; ffmpeg: boolean; gallerydl: boolean }>({
    ytdlp: false,
    ffmpeg: false,
    gallerydl: false,
  });
  const [installedBrowsers, setInstalledBrowsers] = useState<Array<{ id: string; name: string; installed: boolean }>>([]);

  useEffect(() => {
    // Migration helper if format was previously used instead of container
    const initialConfig = { ...config };
    if ((config as any).format && !config.container) {
      initialConfig.container = (config as any).format;
    }
    setLocalConfig(initialConfig);
  }, [config]);

  useEffect(() => {
    if (isOpen) {
      checkToolAvailability('yt-dlp').then((available) => setToolsStatus((s) => ({ ...s, ytdlp: available })));
      checkToolAvailability('ffmpeg').then((available) => setToolsStatus((s) => ({ ...s, ffmpeg: available })));
      checkToolAvailability('gallery-dl').then((available) => setToolsStatus((s) => ({ ...s, gallerydl: available })));
      detectInstalledBrowsers().then((browsers) => setInstalledBrowsers(browsers));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePickDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: localConfig.downloadPath.replace('~', ''),
      });
      if (selected && typeof selected === 'string') {
        setLocalConfig((c) => ({ ...c, downloadPath: selected }));
      }
    } catch (err) {
      console.error('Directory picker error:', err);
    }
  };

  const handleConfirmAndStart = () => {
    onSaveConfig(localConfig);
    if (onStartDownload) {
      onStartDownload(localConfig);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xs flex items-center justify-center p-6 z-50 animate-fade-in">
      <Card className="max-w-xl w-full p-6 space-y-5 relative border-cyber-purple/50 bg-slate-950 shadow-[0_0_50px_rgba(139,92,246,0.15)] max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-900 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-gradient-to-br from-cyber-purple to-cyber-pink text-white rounded">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-100">
                {title || 'Media Download Options'}
              </h2>
              <p className="text-[10px] text-slate-500">Configure destination, container format, video codec, and session cookies.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-cyber-pink text-xs font-bold transition-colors">
            ✕ CLOSE
          </button>
        </div>

        {/* System Binary Health Check */}
        <div className="p-3 bg-slate-900/40 border border-slate-900 rounded-md space-y-2">
          <label className="text-[9px] uppercase font-bold tracking-wider text-slate-500">Detected System CLI Engines</label>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex items-center space-x-1.5 bg-slate-950 p-2 rounded border border-slate-900">
              {toolsStatus.ytdlp ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-cyber-pink" />}
              <span className="text-[10px] font-mono font-bold text-slate-300">yt-dlp</span>
            </div>
            <div className="flex items-center space-x-1.5 bg-slate-950 p-2 rounded border border-slate-900">
              {toolsStatus.ffmpeg ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-amber-400" />}
              <span className="text-[10px] font-mono font-bold text-slate-300">ffmpeg</span>
            </div>
            <div className="flex items-center space-x-1.5 bg-slate-950 p-2 rounded border border-slate-900">
              {toolsStatus.gallerydl ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-slate-600" />}
              <span className="text-[10px] font-mono font-bold text-slate-300">gallery-dl</span>
            </div>
          </div>
        </div>

        {/* Form Controls */}
        <div className="space-y-4">
          {/* Destination Path Selector */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Save Destination Folder</label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={localConfig.downloadPath}
                onChange={(e) => setLocalConfig({ ...localConfig, downloadPath: e.target.value })}
                className="flex-1 bg-slate-900/60 border border-slate-800 rounded-md px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyber-cyan"
              />
              <Button variant="secondary" size="sm" className="h-9 px-3 text-xs" onClick={handlePickDirectory}>
                <Folder className="w-3.5 h-3.5 mr-1.5 text-cyber-cyan" /> Browse
              </Button>
            </div>
          </div>

          {/* Grid Options */}
          <div className="grid grid-cols-2 gap-4">
            {/* Resolution / Quality */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center">
                <Film className="w-3 h-3 mr-1 text-cyber-pink" /> Quality / Resolution
              </label>
              <select
                value={localConfig.quality}
                onChange={(e) => setLocalConfig({ ...localConfig, quality: e.target.value as any })}
                className="w-full bg-slate-900 border border-slate-800 rounded-md px-3 py-2 text-xs font-semibold text-slate-200 focus:outline-none focus:border-cyber-cyan"
              >
                <option value="best">Best Available (Highest)</option>
                <option value="4k">4K (2160p Ultra HD)</option>
                <option value="1080p">1080p Full HD</option>
                <option value="720p">720p HD</option>
                <option value="480p">480p SD</option>
                <option value="audio">Audio Only</option>
              </select>
            </div>

            {/* Container Extension Format */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center">
                <Settings2 className="w-3 h-3 mr-1 text-cyber-cyan" /> File Container Format
              </label>
              <select
                value={localConfig.container || 'mp4'}
                onChange={(e) => setLocalConfig({ ...localConfig, container: e.target.value as any })}
                className="w-full bg-slate-900 border border-slate-800 rounded-md px-3 py-2 text-xs font-semibold text-slate-200 focus:outline-none focus:border-cyber-cyan"
              >
                <option value="mp4">MP4 (.mp4 - MPEG-4)</option>
                <option value="mkv">MKV (.mkv - Matroska)</option>
                <option value="webm">WEBM (.webm - Web Media)</option>
                <option value="mov">MOV (.mov - Apple QuickTime)</option>
                <option value="avi">AVI (.avi - Audio Video Interleave)</option>
                <option value="mp3">MP3 (.mp3 - Audio Only)</option>
              </select>
            </div>

            {/* Video Codec Selection */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center">
                <Cpu className="w-3 h-3 mr-1 text-violet-400" /> Video Codec Encoding
              </label>
              <select
                value={localConfig.videoCodec || 'auto'}
                onChange={(e) => setLocalConfig({ ...localConfig, videoCodec: e.target.value as any })}
                className="w-full bg-slate-900 border border-slate-800 rounded-md px-3 py-2 text-xs font-semibold text-slate-200 focus:outline-none focus:border-cyber-cyan"
              >
                <option value="auto">Auto (Best Hardware Compatibility)</option>
                <option value="h264">H.264 / AVC (Most Compatible)</option>
                <option value="h265">H.265 / HEVC (High Efficiency)</option>
                <option value="av1">AV1 (Next-Gen Open Codec)</option>
                <option value="vp9">VP9 (Google WebM Standard)</option>
              </select>
            </div>

            {/* Audio Bitrate */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center">
                <Music className="w-3 h-3 mr-1 text-cyber-purple" /> Audio Bitrate
              </label>
              <select
                value={localConfig.audioQuality}
                onChange={(e) => setLocalConfig({ ...localConfig, audioQuality: e.target.value as any })}
                className="w-full bg-slate-900 border border-slate-800 rounded-md px-3 py-2 text-xs font-semibold text-slate-200 focus:outline-none focus:border-cyber-cyan"
              >
                <option value="best">Best (320 kbps VBR)</option>
                <option value="320k">320 kbps CBR</option>
                <option value="256k">256 kbps</option>
                <option value="128k">128 kbps</option>
              </select>
            </div>

            {/* Download Engine Preference */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center">
                <Wrench className="w-3 h-3 mr-1 text-cyber-cyan" /> CLI Execution Tool
              </label>
              <select
                value={localConfig.toolPreference || 'auto'}
                onChange={(e) => setLocalConfig({ ...localConfig, toolPreference: e.target.value as any })}
                className="w-full bg-slate-900 border border-slate-800 rounded-md px-3 py-2 text-xs font-semibold text-slate-200 focus:outline-none focus:border-cyber-cyan"
              >
                <option value="auto">Auto-Detect (yt-dlp for video, gallery-dl for photos)</option>
                <option value="ytdlp">Force yt-dlp Engine</option>
                <option value="gallerydl">Force gallery-dl Engine</option>
              </select>
            </div>

            {/* Photo Gallery Toggle */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center">
                <ImageIcon className="w-3 h-3 mr-1 text-emerald-400" /> Photo Engine
              </label>
              <label className="flex items-center space-x-2 bg-slate-900/60 border border-slate-800 rounded-md p-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localConfig.useGalleryDlForPhotos}
                  onChange={(e) => setLocalConfig({ ...localConfig, useGalleryDlForPhotos: e.target.checked })}
                  className="rounded border-slate-700 text-cyber-pink focus:ring-0"
                />
                <span className="text-xs text-slate-300 font-semibold">Enable gallery-dl for photos</span>
              </label>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end space-x-3 border-t border-slate-900 pt-4">
          <Button variant="secondary" size="sm" onClick={onClose} className="px-4">
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={handleConfirmAndStart} className="font-bold text-xs uppercase tracking-wider">
            <Play className="w-4 h-4 mr-1.5 fill-current" />
            {targetCount > 1 ? `Start Download (${targetCount} Tasks)` : `Start Download`}
          </Button>
        </div>
      </Card>
    </div>
  );
};
