import React, { useEffect, useRef } from 'react';
import { Button, Card } from '@clipgrab/ui';
import { Terminal, X, Copy, Trash2, Check, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { MediaJob } from '@clipgrab/types';

export interface CommandConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: MediaJob | null;
  logs: string[];
  onClearLogs: () => void;
}

export const CommandConsoleModal: React.FC<CommandConsoleModalProps> = ({
  isOpen,
  onClose,
  job,
  logs,
  onClearLogs,
}) => {
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = React.useState(false);

  // Auto scroll to bottom when new logs arrive
  useEffect(() => {
    if (isOpen && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isOpen]);

  if (!isOpen || !job) return null;

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const liveStatus = job.status;
  const liveProgress = job.progress || 0;

  let badgeStyle = 'bg-slate-900 text-slate-400 border-slate-800';
  if (liveStatus === 'downloading') {
    badgeStyle = 'bg-cyan-950/80 text-cyan-400 border-cyan-500/50 animate-pulse';
  } else if (liveStatus === 'completed') {
    badgeStyle = 'bg-emerald-950/80 text-emerald-400 border-emerald-500/50';
  } else if (liveStatus === 'failed') {
    badgeStyle = 'bg-rose-950/80 text-rose-400 border-rose-500/50';
  }

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-6 z-50 animate-fade-in">
      <Card className="max-w-3xl w-full h-[560px] p-0 flex flex-col border-violet-500/40 bg-slate-950 shadow-[0_0_60px_rgba(139,92,246,0.2)] overflow-hidden">
        {/* Terminal Titlebar Header */}
        <div className="p-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block"></span>
              <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block"></span>
              <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block"></span>
            </div>
            <div className="flex items-center space-x-2 pl-2 border-l border-slate-800">
              <Terminal className="w-4 h-4 text-cyan-400" />
              <span className="font-mono text-xs font-bold text-slate-200 truncate max-w-md">
                CLI Console Stream: {job.title || job.url}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopyLogs}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              title="Copy terminal logs"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onClearLogs}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              title="Clear terminal output"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 transition-colors"
              title="Close terminal view"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Job Info Sub-Header - Synced Live Status */}
        <div className="px-4 py-2 bg-slate-900/40 border-b border-slate-900 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
          <div className="flex items-center space-x-3 truncate">
            <span className="text-slate-500">ID: {job.id}</span>
            <span className="text-slate-500">•</span>
            <span className="text-pink-500 capitalize font-bold">{job.platform}</span>
            <span className="text-slate-500">•</span>
            <span className="truncate text-slate-300 select-all">{job.url}</span>
          </div>
          <span className={`font-bold uppercase text-[9px] px-2.5 py-0.5 rounded border transition-all ${badgeStyle}`}>
            {liveStatus} ({liveProgress}%)
          </span>
        </div>

        {/* Live Terminal Output Area */}
        <div className="flex-1 p-4 bg-slate-950 font-mono text-xs overflow-y-auto space-y-1.5 select-text selection:bg-violet-900 selection:text-white">
          <div className="text-slate-600 text-[10px]">
            [ClipGrab CLI Process Stream - yt-dlp / gallery-dl / ffmpeg]
          </div>
          <div className="text-slate-600 text-[10px] pb-2 border-b border-slate-900">
            Spawning process pipeline...
          </div>

          {logs.length === 0 ? (
            <div className="py-12 text-center text-slate-600 text-xs">
              Waiting for CLI stdout/stderr output stream...
            </div>
          ) : (
            logs.map((line, idx) => {
              let lineStyle = 'text-slate-300';
              if (line.includes('[ERR]') || line.includes('ERROR:') || line.includes('error')) {
                lineStyle = 'text-rose-400 font-semibold';
              } else if (line.includes('[download]') || line.includes('[SYSTEM]')) {
                lineStyle = 'text-cyan-400';
              } else if (line.includes('[ffmpeg]') || line.includes('[Merger]')) {
                lineStyle = 'text-pink-400';
              } else if (line.includes('Completed') || line.includes('100%') || line.includes('✔')) {
                lineStyle = 'text-emerald-400 font-bold';
              }

              return (
                <div key={idx} className={`leading-relaxed whitespace-pre-wrap ${lineStyle}`}>
                  {line}
                </div>
              );
            })
          )}
          <div ref={terminalEndRef} />
        </div>

        {/* Synchronized Bottom Status Banner */}
        {liveStatus === 'completed' && (
          <div className="px-4 py-2.5 bg-emerald-950/80 border-t border-emerald-900/60 flex items-center justify-between text-xs font-mono text-emerald-300 shrink-0">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="font-bold">DOWNLOAD PROCESS COMPLETE — ALL FILES SAVED SUCCESSFULLY</span>
            </div>
            <span className="text-[10px] text-emerald-400/80 font-bold uppercase">Exit Code 0</span>
          </div>
        )}

        {liveStatus === 'downloading' && (
          <div className="px-4 py-2.5 bg-cyan-950/80 border-t border-cyan-900/60 flex items-center justify-between text-xs font-mono text-cyan-300 shrink-0">
            <div className="flex items-center space-x-2">
              <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />
              <span className="font-bold">DOWNLOADING IN PROGRESS... ({liveProgress}%)</span>
            </div>
            <span className="text-[10px] text-cyan-400/80 font-bold uppercase">Active Stream</span>
          </div>
        )}

        {liveStatus === 'failed' && (
          <div className="px-4 py-2.5 bg-rose-950/80 border-t border-rose-900/60 flex items-center justify-between text-xs font-mono text-rose-300 shrink-0">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span className="font-bold">PROCESS FAILED — SEE ERROR LOG ABOVE</span>
            </div>
            <span className="text-[10px] text-rose-400/80 font-bold uppercase">Error Exited</span>
          </div>
        )}

        {/* Footer */}
        <div className="p-3 bg-slate-900/90 border-t border-slate-900 flex justify-between items-center text-[10px] font-mono text-slate-500 shrink-0">
          <span>Engine: yt-dlp / gallery-dl / ffmpeg</span>
          <span>Log Lines: {logs.length}</span>
        </div>
      </Card>
    </div>
  );
};
