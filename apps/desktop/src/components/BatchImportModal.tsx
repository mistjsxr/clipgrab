import React, { useState } from 'react';
import { Button, Card } from '@clipgrab/ui';
import { parseBatchFileContent, detectPlatform } from '@clipgrab/core-downloader';
import { FileText, Upload, Check, X, AlertCircle, Link2 } from 'lucide-react';

export interface BatchImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmImport: (urls: string[]) => void;
}

export const BatchImportModal: React.FC<BatchImportModalProps> = ({ isOpen, onClose, onConfirmImport }) => {
  const [parsedUrls, setParsedUrls] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const processFile = (file: File) => {
    setErrorMsg('');
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) {
        setErrorMsg('File content is empty.');
        return;
      }
      const extracted = parseBatchFileContent(text);
      if (extracted.length === 0) {
        setErrorMsg('No valid media links found in file. Supported: YouTube, Twitter/X, TikTok, Instagram, Direct MP4/MP3.');
        setParsedUrls([]);
      } else {
        setParsedUrls(extracted);
      }
    };
    reader.onerror = () => {
      setErrorMsg('Failed to read file.');
    };
    reader.readAsText(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleConfirm = () => {
    if (parsedUrls.length > 0) {
      onConfirmImport(parsedUrls);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xs flex items-center justify-center p-6 z-50 animate-fade-in">
      <Card className="max-w-xl w-full p-6 space-y-5 relative border-cyber-purple/50 bg-slate-950 shadow-[0_0_50px_rgba(139,92,246,0.15)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-900 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-gradient-to-br from-violet-600 to-pink-500 text-white rounded">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-100">
                Bulk Batch File Import
              </h2>
              <p className="text-[10px] text-slate-500">Upload .txt or .json link lists to add batch tasks to the queue.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-cyber-pink text-xs font-bold transition-colors">
            ✕ CLOSE
          </button>
        </div>

        {/* Drag & Drop Upload Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-all cursor-pointer ${
            isDragOver
              ? 'border-cyber-pink bg-pink-950/20'
              : 'border-slate-800 bg-slate-900/30 hover:border-violet-500/60'
          }`}
        >
          <input
            type="file"
            accept=".txt,.json"
            onChange={handleFileInput}
            className="hidden"
            id="batch-file-upload-input"
          />
          <label htmlFor="batch-file-upload-input" className="cursor-pointer block space-y-2">
            <Upload className="w-8 h-8 mx-auto text-violet-400 stroke-[1.5]" />
            <div className="text-xs text-slate-300 font-bold">
              {fileName ? fileName : 'Drop .txt or .json batch file here, or click to browse'}
            </div>
            <p className="text-[10px] text-slate-500">
              Supports plain text list of URLs or JSON array/object containing media links.
            </p>
          </label>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-950/40 border border-rose-900/60 rounded text-xs text-rose-300 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Parsed Preview List */}
        {parsedUrls.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400 font-bold uppercase text-[10px]">Extracted Links ({parsedUrls.length})</span>
              <span className="text-emerald-400 font-bold text-[10px]">✓ Validated</span>
            </div>
            <div className="max-h-40 overflow-y-auto bg-slate-900/60 border border-slate-900 rounded p-2 space-y-1 font-mono text-[11px]">
              {parsedUrls.map((url, idx) => (
                <div key={idx} className="flex items-center justify-between py-1 px-2 bg-slate-950 rounded border border-slate-900">
                  <span className="truncate max-w-sm text-slate-300 select-all">{url}</span>
                  <span className="px-1.5 py-0.5 text-[9px] rounded bg-slate-900 border border-slate-800 text-slate-400 font-bold uppercase">
                    {detectPlatform(url)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end space-x-3 border-t border-slate-900 pt-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleConfirm}
            disabled={parsedUrls.length === 0}
            className="font-bold text-xs uppercase tracking-wider"
          >
            <Check className="w-4 h-4 mr-1.5" /> Enqueue Batch ({parsedUrls.length} Links)
          </Button>
        </div>
      </Card>
    </div>
  );
};
