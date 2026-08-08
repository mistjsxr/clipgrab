import React, { useState, useEffect, useRef } from 'react';
import { Button, Card, Input, QRCodeView, StatusBadge } from '@clipgrab/ui';
import { createNeonClient, verifyNeonConnection, initializeDatabaseTables, mediaQueue, eq } from '@clipgrab/db';
import { isValidMediaUrl, createMediaJobPayload, cleanMediaUrl } from '@clipgrab/core-downloader';
import { MediaJob, PairingPayload } from '@clipgrab/types';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { Download, QrCode, Database, RefreshCw, Copy, Check, Plus, Monitor, ShieldCheck, Link2, Server, Trash2, Cpu, Laptop, Play, Settings2, FolderOpen, Ban, RotateCcw, Terminal, Sparkles, CheckSquare, Square, X, FileText, Search, Filter, Clipboard, ExternalLink, History, Archive, DownloadCloud, FileDown, ChevronDown } from 'lucide-react';
import { DownloadSettingsModal } from './components/DownloadSettingsModal';
import { CommandConsoleModal } from './components/CommandConsoleModal';
import { BatchImportModal } from './components/BatchImportModal';
import { DownloadConfig, DEFAULT_DOWNLOAD_CONFIG, executeJobDownload, cancelJobDownload, deleteJobAndFile, removeDownloadedFileAndResetJob, openFileInFinder, EngineBinaryStatus, getBinaryVersion, checkBinaryUpdate, updateBinaryOnDemand, archiveAndClearJobs, archiveAndClearAllWorkspace, archiveAndClearSubsetJobs, fetchMediaHistory, groupHistoryByActionBatches, restoreBatchToQueue, HistoryBatchGroup, clearMediaHistoryVault, exportHistoryToTxt, sendToEagleApp } from './downloaderEngine';

const LOCAL_STORAGE_DB_KEY = 'clipgrab_db_url';
const LOCAL_STORAGE_PASS_KEY = 'clipgrab_pass_id';
const LOCAL_STORAGE_CONFIG_KEY = 'clipgrab_download_config';
const LOCAL_STORAGE_EAGLE_TOKEN_KEY = 'clipgrab_eagle_token';
const LOCAL_STORAGE_EAGLE_PORT_KEY = 'clipgrab_eagle_port';

// Dark Theme Cyberpunk Checkbox Component
const DarkCheckbox: React.FC<{ checked: boolean; onChange: () => void; title?: string }> = ({ checked, onChange, title }) => (
  <button
    type="button"
    onClick={onChange}
    title={title}
    className={`w-4 h-4 rounded border transition-all duration-150 flex items-center justify-center cursor-pointer select-none ${
      checked
        ? 'bg-violet-600 border-violet-400 text-white shadow-[0_0_10px_rgba(139,92,246,0.5)]'
        : 'bg-slate-950 border-slate-800 hover:border-violet-500/70 text-transparent'
    }`}
  >
    <Check className="w-3 h-3 stroke-[3]" />
  </button>
);

export default function App() {
  const [dbUrl, setDbUrl] = useState('');
  const [passId, setPassId] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Main Sidebar Navigation Tab ('workspace' | 'history')
  const [activeTab, setActiveTab] = useState<'workspace' | 'history'>('workspace');

  // Dashboard state
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [showPairingModal, setShowPairingModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);
  const [pairingPayloadBase64, setPairingPayloadBase64] = useState('');
  const [copiedPairingKey, setCopiedPairingKey] = useState(false);
  const [eagleToken, setEagleToken] = useState(() => localStorage.getItem(LOCAL_STORAGE_EAGLE_TOKEN_KEY) || '');
  const [eaglePort, setEaglePort] = useState(() => localStorage.getItem(LOCAL_STORAGE_EAGLE_PORT_KEY) || '22745');

  // History Vault state
  const [historyRecords, setHistoryRecords] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [expandedBatchIds, setExpandedBatchIds] = useState<Record<string, boolean>>({});

  // UI Dropdown Menus state
  const [showCleanMenu, setShowCleanMenu] = useState(false);
  const [showSelectionStorageMenu, setShowSelectionStorageMenu] = useState(false);

  // Clipboard Auto-Detect State
  const [clipboardDetectedUrl, setClipboardDetectedUrl] = useState('');
  const [showClipboardBanner, setShowClipboardBanner] = useState(false);

  // Queue Filtering & Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'downloading' | 'completed' | 'failed'>('all');
  const [platformFilter, setPlatformFilter] = useState<'all' | 'youtube' | 'instagram' | 'tiktok' | 'twitter'>('all');

  // Gmail-style Selection state
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);

  // Engine Binary Status State
  const [engineStatuses, setEngineStatuses] = useState<EngineBinaryStatus[]>([
    { name: 'yt-dlp', binary: 'yt-dlp', installed: false, version: 'Checking...', updateAvailable: false, checking: true, updating: false },
    { name: 'FFmpeg', binary: 'ffmpeg', installed: false, version: 'Checking...', updateAvailable: false, checking: true, updating: false },
    { name: 'gallery-dl', binary: 'gallery-dl', installed: false, version: 'Checking...', updateAvailable: false, checking: true, updating: false },
  ]);

  // Download Engine & Terminal Console state
  const [downloadConfig, setDownloadConfig] = useState<DownloadConfig>(DEFAULT_DOWNLOAD_CONFIG);
  const [targetDownloadJobs, setTargetDownloadJobs] = useState<MediaJob[]>([]);
  const [isDownloadingBatch, setIsDownloadingBatch] = useState(false);
  const [jobLogs, setJobLogs] = useState<Record<string, string[]>>({});
  const [activeConsoleJob, setActiveConsoleJob] = useState<MediaJob | null>(null);

  // Mutable refs to prevent stale closure bugs in async download loops
  const userClosedConsoleRef = useRef(false);
  const isBatchCancelledRef = useRef(false);

  // Non-blocking Startup Engine Health & Version Inspection
  useEffect(() => {
    const inspectEngines = async () => {
      for (const b of ['yt-dlp', 'ffmpeg', 'gallery-dl'] as const) {
        const ver = await getBinaryVersion(b);
        setEngineStatuses((prev) =>
          prev.map((item) =>
            item.binary === b
              ? { ...item, installed: ver.installed, version: ver.version, checking: true }
              : item
          )
        );

        if (ver.installed) {
          const updateInfo = await checkBinaryUpdate(b);
          setEngineStatuses((prev) =>
            prev.map((item) =>
              item.binary === b
                ? {
                    ...item,
                    updateAvailable: updateInfo.updateAvailable,
                    latestVersion: updateInfo.latestVersion,
                    checking: false,
                  }
                : item
            )
          );
        } else {
          setEngineStatuses((prev) =>
            prev.map((item) => (item.binary === b ? { ...item, checking: false } : item))
          );
        }
      }
    };

    inspectEngines();
  }, []);

  const handleRefreshEngineHealth = async () => {
    setEngineStatuses((prev) => prev.map((s) => ({ ...s, checking: true })));
    for (const b of ['yt-dlp', 'ffmpeg', 'gallery-dl'] as const) {
      const ver = await getBinaryVersion(b);
      const updateInfo = ver.installed ? await checkBinaryUpdate(b) : { updateAvailable: false };
      setEngineStatuses((prev) =>
        prev.map((item) =>
          item.binary === b
            ? {
                ...item,
                installed: ver.installed,
                version: ver.version,
                updateAvailable: updateInfo.updateAvailable,
                latestVersion: updateInfo.latestVersion,
                checking: false,
              }
            : item
        )
      );
    }
  };

  const handleUpdateEngineBinary = async (binary: 'yt-dlp' | 'gallery-dl' | 'ffmpeg') => {
    setEngineStatuses((prev) =>
      prev.map((item) => (item.binary === binary ? { ...item, updating: true } : item))
    );

    const res = await updateBinaryOnDemand(binary);
    alert(res.message);

    const updatedVer = await getBinaryVersion(binary);
    setEngineStatuses((prev) =>
      prev.map((item) =>
        item.binary === binary
          ? {
              ...item,
              updating: false,
              installed: updatedVer.installed,
              version: updatedVer.version,
              updateAvailable: false,
            }
          : item
      )
    );
  };

  // Load existing credentials & download config on startup
  useEffect(() => {
    const savedUrl = localStorage.getItem(LOCAL_STORAGE_DB_KEY);
    const savedPass = localStorage.getItem(LOCAL_STORAGE_PASS_KEY);
    const savedConfig = localStorage.getItem(LOCAL_STORAGE_CONFIG_KEY);

    if (savedConfig) {
      try {
        setDownloadConfig(JSON.parse(savedConfig));
      } catch (e) {
        console.error('Failed to parse saved download config:', e);
      }
    }

    if (savedUrl && savedPass) {
      setDbUrl(savedUrl);
      setPassId(savedPass);
      setIsConfigured(true);
      generatePairingPayload(savedUrl, savedPass);
    }
  }, []);

  // Poll database for media queue jobs
  useEffect(() => {
    if (!isConfigured || !dbUrl) return;

    const fetchQueue = async () => {
      try {
        const client = createNeonClient(dbUrl);
        const records = await client.select().from(mediaQueue);
        const mappedJobs: MediaJob[] = records.map((r) => ({
          id: r.id,
          url: r.url,
          title: r.title || undefined,
          platform: r.platform as MediaJob['platform'],
          status: r.status as MediaJob['status'],
          requestedByDeviceId: r.requestedByDeviceId,
          progress: r.progress,
          filePath: r.filePath || undefined,
          error: r.error || undefined,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }));
        setJobs(mappedJobs);
      } catch (err) {
        console.error('Failed to fetch media queue from Neon DB:', err);
      }
    };

    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, [isConfigured, dbUrl]);

  // Fetch History Vault records from Neon DB
  const handleFetchHistory = async () => {
    if (!dbUrl) return;
    setLoadingHistory(true);
    const records = await fetchMediaHistory(dbUrl);
    setHistoryRecords(records);
    setLoadingHistory(false);
  };

  useEffect(() => {
    if (isConfigured && dbUrl && activeTab === 'history') {
      handleFetchHistory();
    }
  }, [isConfigured, dbUrl, activeTab]);

  // Clipboard Auto-Detect Listener on Window Focus
  useEffect(() => {
    if (!isConfigured) return;

    const checkClipboard = async () => {
      try {
        const text = await readText();
        if (text && isValidMediaUrl(text) && text !== clipboardDetectedUrl) {
          setClipboardDetectedUrl(text);
          setShowClipboardBanner(true);
        }
      } catch (err) {
        // Clipboard read permission ignored
      }
    };

    window.addEventListener('focus', checkClipboard);
    checkClipboard();
    return () => window.removeEventListener('focus', checkClipboard);
  }, [isConfigured, clipboardDetectedUrl]);

  const generatePairingPayload = (url: string, pass: string) => {
    const payload: PairingPayload = {
      databaseUrl: url,
      passId: pass,
      createdAt: new Date().toISOString(),
    };
    const base64 = btoa(JSON.stringify(payload));
    setPairingPayloadBase64(base64);
  };

  const handleSaveConfig = (newConfig: DownloadConfig) => {
    setDownloadConfig(newConfig);
    localStorage.setItem(LOCAL_STORAGE_CONFIG_KEY, JSON.stringify(newConfig));
  };

  const handleSetupDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
      setErrorMessage('Please enter a valid Neon HTTP Connection string starting with postgresql://');
      return;
    }

    setLoading(true);
    try {
      const isConnected = await verifyNeonConnection(dbUrl);
      if (!isConnected) {
        setErrorMessage('Connection failed! Please check your Neon database HTTP URL.');
        setLoading(false);
        return;
      }

      const initResult = await initializeDatabaseTables(dbUrl);
      if (!initResult.success) {
        setErrorMessage(initResult.error || 'Failed to auto-create schema tables in Neon.');
        setLoading(false);
        return;
      }

      const generatedPassId = `pass_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem(LOCAL_STORAGE_DB_KEY, dbUrl);
      localStorage.setItem(LOCAL_STORAGE_PASS_KEY, generatedPassId);

      setPassId(generatedPassId);
      setIsConfigured(true);
      generatePairingPayload(dbUrl, generatedPassId);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Setup encountered an unexpected error.');
    } finally {
      setLoading(false);
    }
  };

  const handleManualEnqueue = async (urlToEnqueue?: string) => {
    const targetUrl = urlToEnqueue || urlInput;
    if (!targetUrl.trim()) return;
    if (!isValidMediaUrl(targetUrl)) {
      alert('Please enter a valid supported media URL (YouTube, Twitter/X, TikTok, Instagram, Direct MP4/MP3).');
      return;
    }

    try {
      const client = createNeonClient(dbUrl);
      const payload = createMediaJobPayload(targetUrl, 'desktop_master');
      
      await client.insert(mediaQueue).values({
        id: payload.id,
        url: payload.url,
        title: payload.title,
        platform: payload.platform,
        status: payload.status,
        requestedByDeviceId: payload.requestedByDeviceId,
        progress: 0,
      });

      if (!urlToEnqueue) setUrlInput('');
      setShowClipboardBanner(false);
    } catch (err: any) {
      alert('Failed to enqueue task: ' + err?.message);
    }
  };

  // Confirm Batch File Import (.txt / .json)
  const handleConfirmBatchImport = async (urls: string[]) => {
    if (urls.length === 0 || !dbUrl) return;

    try {
      const client = createNeonClient(dbUrl);
      const insertValues = urls.map((u) => {
        const payload = createMediaJobPayload(u, 'bulk_file_import');
        return {
          id: payload.id,
          url: payload.url,
          title: payload.title,
          platform: payload.platform,
          status: payload.status,
          requestedByDeviceId: 'bulk_file_import',
          progress: 0,
        };
      });

      await client.insert(mediaQueue).values(insertValues);
      alert(`Enqueued ${urls.length} media links from batch file!`);
    } catch (err: any) {
      alert('Failed to import batch links: ' + err?.message);
    }
  };

  const appendJobLog = (jobId: string, text: string) => {
    setJobLogs((prev) => ({
      ...prev,
      [jobId]: [...(prev[jobId] || []), text],
    }));
  };

  // Queue Filtering Logic
  const filteredJobs = jobs.filter((j) => {
    const matchesSearch =
      searchQuery.trim() === '' ||
      (j.title && j.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
      j.url.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || j.status === statusFilter;
    const matchesPlatform = platformFilter === 'all' || j.platform === platformFilter;

    return matchesSearch && matchesStatus && matchesPlatform;
  });

  // History Action Batches Grouping & Searching Logic
  const allActionBatches = groupHistoryByActionBatches(historyRecords);
  
  const filteredActionBatches = allActionBatches.filter((batch) => {
    if (!historySearchQuery.trim()) return true;
    const q = historySearchQuery.toLowerCase();
    const matchesAction = batch.actionType.toLowerCase().includes(q);
    const matchesItems = batch.items.some(
      (item) => (item.title && item.title.toLowerCase().includes(q)) || item.url.toLowerCase().includes(q) || item.platform.toLowerCase().includes(q)
    );
    return matchesAction || matchesItems;
  });

  const toggleBatchExpand = (batchId: string) => {
    setExpandedBatchIds((prev) => ({ ...prev, [batchId]: prev[batchId] === false ? true : false }));
  };

  const handleRestoreBatch = async (batchItems: any[]) => {
    if (batchItems.length === 0) return;
    const restoredIds = batchItems.map((item) => item.id);

    const success = await restoreBatchToQueue(batchItems, dbUrl);
    if (success) {
      setHistoryRecords((prev) => prev.filter((r) => !restoredIds.includes(r.id)));
      alert(`Successfully restored ${batchItems.length} link(s) to Live Workspace and removed from History Vault!`);
      setActiveTab('workspace');
      handleFetchHistory();
    } else {
      alert('Failed to restore links to Live Workspace.');
    }
  };

  // Gmail-style Selection Handlers
  const isAllSelected = filteredJobs.length > 0 && selectedJobIds.length === filteredJobs.length;
  
  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedJobIds([]);
    } else {
      setSelectedJobIds(filteredJobs.map((j) => j.id));
    }
  };

  const toggleSelectJob = (id: string) => {
    setSelectedJobIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Trigger download options popup for a single job (Start / Retry)
  const triggerSingleJobOptions = (job: MediaJob) => {
    setTargetDownloadJobs([job]);
    setShowSettingsModal(true);
  };

  // Trigger download options popup for all pending jobs
  const triggerBatchJobOptions = () => {
    const pendingJobs = jobs.filter((j) => j.status === 'pending');
    if (pendingJobs.length === 0) {
      alert('No pending media jobs in queue to download.');
      return;
    }
    setTargetDownloadJobs(pendingJobs);
    setShowSettingsModal(true);
  };

  // Trigger download options for selected jobs subset
  const triggerSelectedJobsOptions = () => {
    const selectedJobs = jobs.filter((j) => selectedJobIds.includes(j.id));
    if (selectedJobs.length === 0) return;
    setTargetDownloadJobs(selectedJobs);
    setShowSettingsModal(true);
  };

  // Single Job Deletion (Disk + DB)
  const handleSingleDelete = async (job: MediaJob) => {
    if (
      confirm(
        `💥 PERMANENTLY DELETE "${job.title || job.url}"?\n\nWhat will happen:\n• 💾 Local File on Mac: Downloaded video/audio file will be DELETED from disk.\n• 📄 Queue Link: Database record will be archived into History Vault & removed from queue.`
      )
    ) {
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      await deleteJobAndFile(job, dbUrl);
    }
  };

  const handleSaveEagleToken = (val: string) => {
    let cleanToken = val.trim();
    let detectedPort = eaglePort;

    // Auto-detect port if user pastes a URL like http://127.0.0.1:45159/ or port number
    const portMatch = cleanToken.match(/:(\d{4,5})/);
    if (portMatch && portMatch[1]) {
      detectedPort = portMatch[1];
      setEaglePort(detectedPort);
      localStorage.setItem(LOCAL_STORAGE_EAGLE_PORT_KEY, detectedPort);
    }

    if (cleanToken.includes('token=')) {
      const match = cleanToken.match(/token=([^&]+)/);
      if (match && match[1]) {
        cleanToken = match[1];
      }
    }
    setEagleToken(cleanToken);
    localStorage.setItem(LOCAL_STORAGE_EAGLE_TOKEN_KEY, cleanToken);
    setDownloadConfig((prev) => ({ ...prev, eagleApiToken: cleanToken, eaglePort: detectedPort }));
  };

  const handleSaveEaglePort = (val: string) => {
    const cleanPort = val.trim();
    setEaglePort(cleanPort);
    localStorage.setItem(LOCAL_STORAGE_EAGLE_PORT_KEY, cleanPort);
    setDownloadConfig((prev) => ({ ...prev, eaglePort: cleanPort }));
  };

  // Single Job Manual Eagle Sync
  const handleManualEagleSync = async (job: MediaJob) => {
    if (!job.filePath) {
      alert('⚠️ No local file path recorded for this download. Please re-download or check file location.');
      return;
    }
    const token = eagleToken || downloadConfig.eagleApiToken;
    const port = eaglePort || downloadConfig.eaglePort || '22745';
    const res = await sendToEagleApp(job.filePath, job.url, job.title || undefined, job.platform, token, port);
    if (res.success) {
      alert('🦅 Successfully sent file and Source URL to Eagle App!');
    } else {
      alert(`⚠️ ${res.message}\n\nPlease ensure Eagle App is open on your Mac port ${port}.`);
    }
  };

  // Batch Sync Completed Downloads to Eagle App
  const handleBatchEagleSync = async () => {
    const completedJobs = jobs.filter((j) => j.status === 'completed' && j.filePath);
    if (completedJobs.length === 0) {
      alert('⚠️ No completed downloads with file paths found in queue to sync.');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let lastErrorMessage = '';
    const token = eagleToken || downloadConfig.eagleApiToken;
    const port = eaglePort || downloadConfig.eaglePort || '22745';

    for (const job of completedJobs) {
      const res = await sendToEagleApp(job.filePath!, job.url, job.title || undefined, job.platform, token, port);
      if (res.success) {
        successCount++;
      } else {
        failCount++;
        lastErrorMessage = res.message;
      }
    }

    if (successCount > 0) {
      alert(`🦅 Successfully synced ${successCount} file(s) and Source URLs to Eagle App!${failCount > 0 ? ` (${failCount} skipped/failed)` : ''}`);
    } else {
      alert(`⚠️ ${lastErrorMessage || `Could not connect to Eagle App on port ${port}.`}\n\nPlease check your Eagle API Token and Port in sidebar settings.`);
    }
  };

  // Single Job Remove File (Keep DB Link)
  const handleSingleRemoveFile = async (job: MediaJob) => {
    if (
      confirm(
        `🗑️ DELETE LOCAL FILE ONLY (KEEP LINK)?\n\nWhat will happen:\n• 💾 Local File on Mac: Physical file for "${job.title || job.url}" will be DELETED from disk to free space.\n• 📄 Queue Link: Link remains in queue & reset to PENDING for re-download anytime.`
      )
    ) {
      await removeDownloadedFileAndResetJob(job, dbUrl);
    }
  };

  // Bulk Delete (Delete from disk storage AND database)
  const handleBulkDeleteSelected = async () => {
    const selectedJobs = jobs.filter((j) => selectedJobIds.includes(j.id));
    if (selectedJobs.length === 0) return;

    if (
      !confirm(
        `💥 PERMANENTLY DELETE ${selectedJobs.length} SELECTED ITEM(S)?\n\nWhat will happen:\n• 💾 Local Files on Mac: Physical video/audio files will be DELETED from disk.\n• 📄 Queue Links: Database records will be archived into History Vault & removed from Live Workspace.`
      )
    ) {
      return;
    }

    setJobs((prev) => prev.filter((j) => !selectedJobIds.includes(j.id)));
    for (const job of selectedJobs) {
      await deleteJobAndFile(job, dbUrl);
    }
    setSelectedJobIds([]);
  };

  // Bulk Reset & Remove Downloaded File (Deletes file from disk, keeps DB link, resets status to pending)
  const handleBulkResetRemoveMedia = async () => {
    const selectedJobs = jobs.filter((j) => selectedJobIds.includes(j.id));
    if (selectedJobs.length === 0) return;

    if (
      !confirm(
        `🗑️ DELETE LOCAL DISK FILES ONLY (KEEP DB LINKS)?\n\nWhat will happen:\n• 💾 Local Files on Mac: Downloaded media files for ${selectedJobs.length} item(s) will be DELETED from disk to free storage space.\n• 📄 Queue Links: Links remain in Live Workspace & reset to PENDING for re-download anytime.`
      )
    ) {
      return;
    }

    for (const job of selectedJobs) {
      await removeDownloadedFileAndResetJob(job, dbUrl);
    }
    setSelectedJobIds([]);
  };

  // Archive selected subset of jobs to History Vault
  const handleArchiveSelectedToVault = async () => {
    const selectedJobs = jobs.filter((j) => selectedJobIds.includes(j.id));
    if (selectedJobs.length === 0) return;

    if (
      confirm(
        `📦 ARCHIVE ${selectedJobs.length} LINK(S) TO HISTORY VAULT?\n\nWhat will happen:\n• 📄 Queue Links: ${selectedJobs.length} link(s) moved to History Vault.\n• 💾 Local Files on Mac: 0 files deleted (Downloaded videos remain 100% safe on disk).`
      )
    ) {
      setJobs((prev) => prev.filter((j) => !selectedJobIds.includes(j.id)));
      await archiveAndClearSubsetJobs(selectedJobs, dbUrl, 'BULK_DELETE');
      setSelectedJobIds([]);
      handleFetchHistory();
    }
  };

  // ARCHIVE & CLEAR COMPLETED JOBS (Preserves local media files on disk, archives links in DB History Vault)
  const handleClearCompleted = async () => {
    const completedJobs = jobs.filter((j) => j.status === 'completed');
    if (completedJobs.length === 0) return;

    if (
      confirm(
        `🧹 CLEAR COMPLETED TASKS FROM WORKSPACE?\n\nWhat will happen:\n• 📄 Queue Links: ${completedJobs.length} completed link(s) archived into History Vault.\n• 💾 Local Files on Mac: 0 files deleted (Downloaded videos remain 100% safe on disk).`
      )
    ) {
      setJobs((prev) => prev.filter((j) => j.status !== 'completed'));
      await archiveAndClearSubsetJobs(completedJobs, dbUrl);
      handleFetchHistory();
    }
  };

  // ARCHIVE & CLEAR ALL WORKSPACE LINKS (Ultra-fast TRUNCATE TABLE: Preserves local media files, archives links in DB History Vault)
  const handleClearAllWorkspace = async () => {
    if (jobs.length === 0) return;

    if (
      confirm(
        `⚡ CLEAR ENTIRE LIVE WORKSPACE?\n\nWhat will happen:\n• 📄 Queue Links: All ${jobs.length} link(s) archived into History Vault.\n• 💾 Local Files on Mac: 0 files deleted (Downloaded videos remain 100% safe on disk).`
      )
    ) {
      const jobsToClear = [...jobs];
      setJobs([]);
      await archiveAndClearAllWorkspace(jobsToClear, dbUrl);
      handleFetchHistory();
    }
  };

  // Export History Vault to formatted .txt file
  const handleExportHistoryTxt = () => {
    if (historyRecords.length === 0) {
      alert('History Vault is empty. No records to export.');
      return;
    }
    const txtContent = exportHistoryToTxt(historyRecords);
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clipgrab-download-history-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Clear History Vault
  const handleClearHistoryVault = async () => {
    if (confirm('Are you sure you want to PERMANENTLY CLEAR your History Vault backup records?')) {
      await clearMediaHistoryVault(dbUrl);
      setHistoryRecords([]);
    }
  };

  // Re-Enqueue History item back to active queue
  const handleReEnqueueHistoryItem = async (historyItem: any) => {
    await handleManualEnqueue(historyItem.url);
    alert(`Re-enqueued link into Live Workspace: ${historyItem.url}`);
    setActiveTab('workspace');
  };

  // Optimize & clean all URLs in DB queue
  const handleOptimizeQueueUrls = async () => {
    if (!dbUrl) return;
    const client = createNeonClient(dbUrl);
    let count = 0;

    for (const job of jobs) {
      const cleaned = cleanMediaUrl(job.url);
      if (cleaned !== job.url) {
        count++;
        await client
          .update(mediaQueue)
          .set({ url: cleaned, updatedAt: new Date() })
          .where(eq(mediaQueue.id, job.id))
          .catch(console.error);
      }
    }

    if (count > 0) {
      alert(`Optimized & cleaned ${count} tracking URLs in your database queue!`);
    } else {
      alert('All URLs in queue are already clean & optimized!');
    }
  };

  // Confirmed execution from DownloadSettingsModal
  const handleConfirmedDownload = async (confirmedConfig: DownloadConfig) => {
    if (targetDownloadJobs.length === 0) return;

    setIsDownloadingBatch(true);
    userClosedConsoleRef.current = false;
    isBatchCancelledRef.current = false;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < targetDownloadJobs.length; i++) {
      if (isBatchCancelledRef.current) {
        break;
      }

      const job = targetDownloadJobs[i];
      
      // Only switch active console job if user hasn't explicitly closed it!
      if (!userClosedConsoleRef.current) {
        setActiveConsoleJob(job);
      }

      appendJobLog(job.id, `[SYSTEM] Starting task ${i + 1} of ${targetDownloadJobs.length}: ${job.title || job.url}`);

      const res = await executeJobDownload(
        job,
        confirmedConfig,
        dbUrl,
        (jobId, progress, status) => {
          setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, progress, status } : j)));
        },
        (jobId, _type, text) => {
          appendJobLog(jobId, text);
        }
      );

      if (isBatchCancelledRef.current) {
        break;
      }

      if (res.success) {
        successCount++;
        appendJobLog(job.id, `✔ Completed download ${i + 1}/${targetDownloadJobs.length}`);
      } else {
        failCount++;
        appendJobLog(job.id, `[ERR] Failed download ${i + 1}/${targetDownloadJobs.length}: ${res.error}`);
      }
    }

    // Append batch summary log line
    const lastJob = targetDownloadJobs[targetDownloadJobs.length - 1];
    if (lastJob) {
      appendJobLog(lastJob.id, '================================================');
      if (isBatchCancelledRef.current) {
        appendJobLog(lastJob.id, '🛑 BATCH TERMINATED BY USER (Partial downloads preserved).');
      } else if (failCount === 0) {
        appendJobLog(lastJob.id, `✔ BATCH COMPLETE: All ${successCount} media files downloaded successfully!`);
      } else {
        appendJobLog(lastJob.id, `⚠️ BATCH COMPLETED WITH NOTICES: ${successCount} Succeeded, ${failCount} Failed.`);
      }
      appendJobLog(lastJob.id, '================================================');
    }

    setIsDownloadingBatch(false);
  };

  // Single job cancel/stop
  const handleCancelJob = async (jobId: string) => {
    appendJobLog(jobId, '[SYSTEM] User requested process termination (stopping active download & preserving content)...');
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: 'failed', error: 'Stopped by user' } : j)));
    await cancelJobDownload(jobId, dbUrl);
  };

  // Top bar stop ALL downloads handler
  const handleStopAllDownloads = async () => {
    isBatchCancelledRef.current = true;
    
    // Find currently downloading job and kill its process
    const activeJob = jobs.find((j) => j.status === 'downloading');
    if (activeJob) {
      appendJobLog(activeJob.id, '[SYSTEM] User requested batch termination (stopping active task & preserving content)...');
      setJobs((prev) => prev.map((j) => (j.id === activeJob.id ? { ...j, status: 'failed', error: 'Stopped by user' } : j)));
      await cancelJobDownload(activeJob.id, dbUrl);
    }

    setIsDownloadingBatch(false);
  };

  const handleDisconnect = () => {
    if (confirm('Are you sure you want to disconnect? This will clear local database credentials.')) {
      localStorage.removeItem(LOCAL_STORAGE_DB_KEY);
      localStorage.removeItem(LOCAL_STORAGE_PASS_KEY);
      setIsConfigured(false);
      setDbUrl('');
      setPassId('');
      setJobs([]);
    }
  };

  const copyPairingKeyToClipboard = () => {
    navigator.clipboard.writeText(pairingPayloadBase64);
    setCopiedPairingKey(true);
    setTimeout(() => setCopiedPairingKey(false), 2000);
  };

  const pendingJobsCount = jobs.filter((j) => j.status === 'pending').length;
  const completedJobsCount = jobs.filter((j) => j.status === 'completed').length;
  const downloadingJobsCount = jobs.filter((j) => j.status === 'downloading').length;

  const unoptimizedCount = jobs.filter((j) => {
    return j.url.includes('?') && (j.url.includes('igsh=') || j.url.includes('hl=') || j.url.includes('utm_') || j.url.includes('si='));
  }).length;

  // Render ONBOARDING WIZARD if DB is not configured
  if (!isConfigured) {
    return (
      <div className="relative min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 overflow-hidden">
        {/* Glow Blobs */}
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-violet-900/10 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-pink-900/10 blur-[120px] pointer-events-none" />

        <Card className="max-w-xl w-full border-slate-900 bg-slate-950/40 backdrop-blur-2xl p-8 space-y-6 shadow-[0_0_50px_rgba(139,92,246,0.1)] border-violet-900/20">
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-violet-900/15 text-violet-400 rounded-md border border-violet-900/30 shadow-[0_0_15px_rgba(139,92,246,0.2)]">
              <Database className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-wider text-slate-100">
                ClipGrab <span className="text-pink-500">Setup</span>
              </h1>
              <p className="text-xs text-slate-400 font-medium tracking-wide">Bring Your Own Database (Neon Serverless Postgres)</p>
            </div>
          </div>

          <div className="border-t border-slate-900 my-4" />

          <form onSubmit={handleSetupDatabase} className="space-y-5">
            <Input
              label="Neon HTTP Database Connection String"
              placeholder="postgresql://user:password@ep-cool-db.us-east-2.aws.neon.tech/neondb?sslmode=require"
              value={dbUrl}
              onChange={(e) => setDbUrl(e.target.value)}
              error={errorMessage}
              className="font-mono text-xs bg-slate-950/80 border-slate-800"
            />

            <div className="p-4 bg-slate-900/30 rounded border border-violet-950 text-xs text-slate-400 space-y-2">
              <div className="flex items-center text-cyan-400 font-bold tracking-wider uppercase text-[10px] space-x-1.5">
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
                <span>Zero Server Connection Architecture</span>
              </div>
              <p className="leading-relaxed">
                ClipGrab runs purely between your hardware and your serverless Neon instance. Your access keys are stored locally on this machine and never transmitted to external relays.
              </p>
            </div>

            <Button variant="primary" size="lg" className="w-full h-12 uppercase tracking-widest text-xs font-bold" disabled={loading}>
              {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Server className="w-4 h-4 mr-2" />}
              {loading ? 'Validating Connection...' : 'Activate Command Center'}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  // Render MASTER COMMAND CENTER DASHBOARD
  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 flex overflow-hidden">
      {/* Background glow layers */}
      <div className="absolute top-[10%] left-[20%] w-[600px] h-[600px] rounded-full bg-violet-900/10 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[10%] right-[10%] w-[500px] h-[500px] rounded-full bg-pink-900/5 blur-[120px] pointer-events-none" />

      {/* Left Sidebar */}
      <aside className="w-80 bg-slate-950/60 backdrop-blur-md border-r border-slate-900 p-6 flex flex-col justify-between z-10 shrink-0 overflow-y-auto">
        <div className="space-y-6">
          {/* Logo / Branding */}
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-violet-600 to-pink-500 text-white rounded shadow-[0_0_15px_rgba(255,0,127,0.3)]">
              <Download className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-black uppercase tracking-wider text-slate-100">
                Clip<span className="text-pink-500">Grab</span>
              </h1>
              <div className="flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
                <span className="text-[9px] uppercase tracking-widest font-bold text-cyan-400">Master Node</span>
              </div>
            </div>
          </div>

          {/* Sidebar Navigation Tabs */}
          <div className="space-y-1 bg-slate-900/40 p-1.5 rounded-lg border border-slate-900">
            <button
              onClick={() => setActiveTab('workspace')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'workspace'
                  ? 'bg-gradient-to-r from-violet-600 to-pink-600 text-white shadow-[0_0_15px_rgba(139,92,246,0.3)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Monitor className="w-4 h-4" />
                <span>Live Workspace</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-950/80 font-mono text-slate-300 font-bold">{jobs.length}</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('history');
                handleFetchHistory();
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-gradient-to-r from-violet-600 to-pink-600 text-white shadow-[0_0_15px_rgba(139,92,246,0.3)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <div className="flex items-center space-x-2">
                <History className="w-4 h-4 text-cyan-400" />
                <span>History Vault</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-950/80 font-mono text-cyan-400 font-bold">{historyRecords.length}</span>
            </button>
          </div>

          <div className="border-t border-slate-900" />

          {/* Engine Binary Health & On-Demand Updater Widget */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Core Engines & Tools</label>
              <button
                onClick={handleRefreshEngineHealth}
                className="text-[10px] text-violet-400 hover:text-pink-400 font-bold uppercase flex items-center transition-colors"
                title="Re-check binary versions"
              >
                <RefreshCw className="w-3 h-3 mr-1" /> Refresh
              </button>
            </div>
            <div className="p-3 bg-slate-950/80 border border-slate-900 rounded-md space-y-3 text-xs">
              {engineStatuses.map((engine) => (
                <div key={engine.binary} className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center space-x-1.5 font-bold text-slate-200 text-xs">
                      <span>{engine.name}</span>
                      <span className="text-[9px] font-mono text-slate-500 font-normal">v{engine.version}</span>
                    </div>
                    <div className="mt-0.5">
                      {engine.checking ? (
                        <span className="text-[9px] font-mono text-cyan-400 animate-pulse">Checking...</span>
                      ) : engine.updateAvailable ? (
                        <span className="text-[9px] font-mono font-bold text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-900/60">
                          Update Available
                        </span>
                      ) : engine.installed ? (
                        <span className="text-[9px] font-mono font-bold text-emerald-400">Up to date</span>
                      ) : (
                        <span className="text-[9px] font-mono text-rose-500">Not Installed</span>
                      )}
                    </div>
                  </div>

                  {engine.updateAvailable && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px] border-amber-500/40 text-amber-300 hover:bg-amber-950/50"
                      disabled={engine.updating}
                      onClick={() => handleUpdateEngineBinary(engine.binary)}
                    >
                      {engine.updating ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
                      {engine.updating ? 'Updating...' : 'Update'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Database Info Widget */}
          <div className="space-y-2.5">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Database Connection</label>
            <div className="p-3 bg-slate-950/80 border border-slate-900 rounded-md space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Provider:</span>
                <span className="text-cyan-400 font-bold uppercase text-[9px] tracking-wider">Neon HTTP</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Status:</span>
                <span className="text-emerald-400 font-bold uppercase text-[9px] tracking-wider">Connected</span>
              </div>
              <div className="text-[10px] text-slate-600 truncate font-mono select-all bg-slate-900/50 p-1.5 rounded border border-slate-900">
                {dbUrl}
              </div>
            </div>
          </div>

          {/* Download Config Quick View */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Engine Defaults</label>
              <button
                onClick={() => {
                  setTargetDownloadJobs([]);
                  setShowSettingsModal(true);
                }}
                className="text-[10px] text-violet-400 hover:text-pink-500 font-bold uppercase flex items-center"
              >
                <Settings2 className="w-3 h-3 mr-1" /> Config
              </button>
            </div>
            <div className="p-3 bg-slate-950/80 border border-slate-900 rounded-md space-y-1.5 text-xs text-slate-400 font-mono">
              <div className="flex justify-between">
                <span>Container:</span>
                <span className="text-slate-200 uppercase font-bold">{downloadConfig.container}</span>
              </div>
              <div className="flex justify-between">
                <span>Quality:</span>
                <span className="text-slate-200 uppercase font-bold">{downloadConfig.quality}</span>
              </div>
              <div className="flex justify-between">
                <span>Engine:</span>
                <span className="text-slate-200 uppercase font-bold">{downloadConfig.toolPreference || 'auto'}</span>
              </div>
              <div className="flex items-center space-x-1 text-[10px] text-slate-500 pt-1 border-t border-slate-900 truncate">
                <FolderOpen className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                <span className="truncate">{downloadConfig.downloadPath}</span>
              </div>
            </div>
          </div>

          {/* Eagle App Integration Widget */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Eagle App Integration</label>
              {eagleToken ? (
                <span className="text-[9px] font-mono text-emerald-400 font-bold">🦅 Token Saved</span>
              ) : (
                <span className="text-[9px] font-mono text-amber-400 font-bold">Token Required</span>
              )}
            </div>
            <div className="p-3 bg-slate-950/80 border border-slate-900 rounded-md space-y-2.5">
              <div>
                <div className="text-[10px] text-slate-400 font-medium mb-1">Eagle API Token</div>
                <input
                  type="password"
                  value={eagleToken}
                  onChange={(e) => handleSaveEagleToken(e.target.value)}
                  placeholder="Paste Eagle API Token..."
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <div className="text-[10px] text-slate-400 font-medium mb-1">Eagle Port (Default: 22745)</div>
                <input
                  type="text"
                  value={eaglePort}
                  onChange={(e) => handleSaveEaglePort(e.target.value)}
                  placeholder="22745"
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-violet-500"
                />
              </div>

              {eagleToken ? (
                <p className="text-[9px] text-slate-500 leading-normal">
                  🦅 Eagle Sync active on port {eaglePort || '22745'}. Downloads auto-sync to Eagle App with web URLs.
                </p>
              ) : (
                <p className="text-[9px] text-slate-600 leading-normal">
                  Copy API Token from Eagle Preferences &gt; Developer to enable automatic library sync.
                </p>
              )}
            </div>
          </div>

          {/* Pairing Controls */}
          <div className="space-y-2.5">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Device Link</label>
            <Button
              variant="outline"
              className="w-full text-xs py-2.5 justify-start bg-slate-900/40 border-violet-500/30 text-violet-400 hover:bg-violet-900/10"
              onClick={() => setShowPairingModal(true)}
            >
              <QrCode className="w-4 h-4 mr-2" />
              Pair Mobile & Extension
            </Button>
          </div>
        </div>

        {/* Disconnect / Actions */}
        <div className="space-y-4 pt-4">
          <Button
            variant="danger"
            size="sm"
            className="w-full text-xs py-2 bg-transparent text-rose-500 hover:bg-rose-950/30 border-rose-950/40"
            onClick={handleDisconnect}
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" /> Disconnect Database
          </Button>
          <div className="text-[10px] text-center text-slate-600 font-medium">
            ClipGrab Desktop v2.0
          </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 p-6 md:p-8 overflow-y-auto z-10 w-full">
        {activeTab === 'workspace' ? (
          <div className="w-full space-y-6">
            {/* Clipboard Auto-Detect Banner */}
            {showClipboardBanner && (
              <div className="p-3 bg-gradient-to-r from-violet-900/80 to-pink-900/80 border border-violet-500/50 rounded-lg backdrop-blur-md flex items-center justify-between shadow-[0_0_20px_rgba(139,92,246,0.25)] animate-fade-in">
                <div className="flex items-center space-x-3 text-xs truncate mr-2">
                  <Clipboard className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                  <div className="truncate">
                    <span className="font-bold text-white uppercase text-[10px] tracking-wider block">Media Link Detected in Clipboard</span>
                    <span className="text-slate-300 font-mono text-[10px] truncate block select-all">{clipboardDetectedUrl}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <Button variant="primary" size="sm" className="h-8 px-3 text-[11px] font-bold" onClick={() => handleManualEnqueue(clipboardDetectedUrl)}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Quick Enqueue
                  </Button>
                  <button onClick={() => setShowClipboardBanner(false)} className="p-1 rounded text-slate-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Top Bar / Queue Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black uppercase tracking-wider text-slate-100">Live Workspace</h2>
                <p className="text-xs text-slate-500">Monitor active download queue and capture direct media sources.</p>
              </div>
              
              {/* Top Right Controls */}
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 text-xs border-violet-500/40 text-violet-300 hover:bg-violet-950/30 cursor-pointer"
                  onClick={handleBatchEagleSync}
                  disabled={completedJobsCount === 0}
                  title="Batch-sync all completed downloads & Source URLs to open Eagle App"
                >
                  🦅 Sync Eagle
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 text-xs border-violet-500/30 text-violet-300 hover:bg-violet-950/20"
                  onClick={() => setShowBatchImportModal(true)}
                >
                  <FileText className="w-3.5 h-3.5 mr-1.5 text-pink-400" />
                  Bulk Import
                </Button>

                {/* Clean Workspace Actions Dropdown */}
                <div className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 text-xs border-violet-500/40 text-violet-300 hover:bg-violet-950/30"
                    onClick={() => setShowCleanMenu((prev) => !prev)}
                  >
                    <Archive className="w-3.5 h-3.5 mr-1.5 text-violet-400" />
                    Clean ▾
                  </Button>

                  {showCleanMenu && (
                    <div className="absolute right-0 mt-1.5 w-56 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl p-1.5 z-50 space-y-1 animate-fade-in">
                      <button
                        onClick={() => {
                          setShowCleanMenu(false);
                          handleClearCompleted();
                        }}
                        disabled={completedJobsCount === 0}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 rounded-md disabled:opacity-40 transition-colors text-left cursor-pointer"
                      >
                        <div className="flex items-center space-x-2">
                          <Archive className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Clear Completed Tasks</span>
                        </div>
                        <span className="text-[10px] font-mono font-bold text-slate-500">({completedJobsCount})</span>
                      </button>

                      <button
                        onClick={() => {
                          setShowCleanMenu(false);
                          handleClearAllWorkspace();
                        }}
                        disabled={jobs.length === 0}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-950/40 rounded-md disabled:opacity-40 transition-colors text-left cursor-pointer"
                      >
                        <div className="flex items-center space-x-2">
                          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                          <span>Clear Entire Workspace</span>
                        </div>
                        <span className="text-[10px] font-mono font-bold text-rose-500">({jobs.length})</span>
                      </button>
                    </div>
                  )}
                </div>

                {unoptimizedCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 text-xs border-amber-500/30 text-amber-300 hover:bg-amber-950/20"
                    onClick={handleOptimizeQueueUrls}
                  >
                    <Sparkles className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
                    Optimize URLs ({unoptimizedCount})
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 text-xs border-slate-800 text-slate-400 hover:text-slate-200"
                  onClick={() => {
                    setTargetDownloadJobs([]);
                    setShowSettingsModal(true);
                  }}
                >
                  <Settings2 className="w-4 h-4 mr-1.5" /> Options
                </Button>

                {/* Dynamic Morphing Primary CTA Button */}
                {isDownloadingBatch ? (
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="primary"
                      size="sm"
                      className="h-9 px-4 text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-cyan-600 to-violet-600 hover:from-violet-600 hover:to-cyan-600 shadow-[0_0_15px_rgba(6,182,212,0.3)] animate-pulse cursor-pointer"
                      onClick={() => {
                        userClosedConsoleRef.current = false;
                        const activeJob = jobs.find((j) => j.status === 'downloading') || targetDownloadJobs[0];
                        if (activeJob) {
                          setActiveConsoleJob(activeJob);
                        }
                      }}
                      title="Click to view live CLI Terminal Console"
                    >
                      <RefreshCw className="w-4 h-4 animate-spin mr-1.5" />
                      Downloading... (CLI)
                    </Button>

                    <Button
                      variant="danger"
                      size="sm"
                      className="h-9 px-3 text-xs font-bold uppercase tracking-wider bg-rose-950/80 text-rose-300 border-rose-800 hover:bg-rose-900 shadow-[0_0_15px_rgba(225,29,72,0.3)]"
                      onClick={handleStopAllDownloads}
                      title="Stop & Terminate All Active Downloads"
                    >
                      <Square className="w-3.5 h-3.5 mr-1.5 fill-current" />
                      Stop Batch
                    </Button>
                  </div>
                ) : selectedJobIds.length > 0 ? (
                  <Button
                    variant="primary"
                    size="sm"
                    className="h-9 px-4 text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-violet-600 hover:to-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.4)] animate-pulse cursor-pointer"
                    onClick={triggerSelectedJobsOptions}
                  >
                    <Play className="w-4 h-4 mr-1.5 fill-current" />
                    Download Selected ({selectedJobIds.length})
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    className="h-9 px-4 text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-violet-600 to-pink-500 hover:from-pink-500 hover:to-violet-600 disabled:opacity-50 cursor-pointer"
                    onClick={triggerBatchJobOptions}
                    disabled={pendingJobsCount === 0 && downloadingJobsCount === 0}
                  >
                    <Play className="w-4 h-4 mr-1.5 fill-current" />
                    Download All ({pendingJobsCount})
                  </Button>
                )}
              </div>
            </div>

            {/* Quick URL Enqueue Card */}
            <Card className="p-4 bg-slate-950/40 backdrop-blur-md border-slate-900 shadow-xl">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-slate-900 text-pink-500 border border-slate-800 rounded">
                  <Link2 className="w-5 h-5" />
                </div>
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleManualEnqueue()}
                  placeholder="Paste YouTube, X/Twitter, TikTok, or Direct Media URL..."
                  className="flex-1 bg-slate-950 border border-slate-900 rounded-md px-4 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-pink-500 transition-all"
                />
                <Button variant="primary" className="py-2.5 px-4 font-bold text-xs" onClick={() => handleManualEnqueue()}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Enqueue
                </Button>
              </div>
            </Card>

            {/* Queue Filtering & Real-Time Search Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-lg border border-slate-900">
              {/* Search Input */}
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search queue by title or URL..."
                  className="w-full bg-slate-900/80 border border-slate-800 rounded-md pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-400"
                />
              </div>

              {/* Filter Pills */}
              <div className="flex items-center space-x-2 text-[10px] font-mono">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-300 focus:outline-none"
                >
                  <option value="all">Status: All</option>
                  <option value="pending">Pending</option>
                  <option value="downloading">Downloading</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>

                <select
                  value={platformFilter}
                  onChange={(e) => setPlatformFilter(e.target.value as any)}
                  className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-300 focus:outline-none"
                >
                  <option value="all">Platform: All</option>
                  <option value="youtube">YouTube</option>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="twitter">Twitter / X</option>
                </select>
              </div>
            </div>

            {/* Contextual Multi-Selection Action Bar */}
            {selectedJobIds.length > 0 && (
              <div className="relative z-40 p-3 bg-violet-950/80 border border-violet-500/50 rounded-lg backdrop-blur-md flex items-center justify-between shadow-[0_0_25px_rgba(139,92,246,0.25)] animate-fade-in">
                <div className="flex items-center space-x-3 text-xs font-mono text-violet-200">
                  <div className="flex items-center space-x-2">
                    <DarkCheckbox checked={isAllSelected} onChange={toggleSelectAll} title="Select All / Deselect All" />
                    <span className="font-bold">{selectedJobIds.length} Selected</span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="h-8 px-3 text-[11px] bg-gradient-to-r from-cyan-600 to-violet-600 hover:from-violet-600 hover:to-cyan-600 text-white font-bold cursor-pointer"
                    onClick={triggerSelectedJobsOptions}
                  >
                    <Play className="w-3 h-3 mr-1 fill-current" /> Download Selected ({selectedJobIds.length})
                  </Button>

                  {/* Selection Deletion Actions Menu */}
                  <div className="relative">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3 text-[11px] border-amber-900/50 text-amber-300 hover:bg-amber-950/40 cursor-pointer"
                      onClick={() => setShowSelectionStorageMenu((prev) => !prev)}
                    >
                      <Trash2 className="w-3 h-3 mr-1 text-amber-400" /> Delete ▾
                    </Button>

                    {showSelectionStorageMenu && (
                      <div className="absolute right-0 bottom-full mb-2 w-64 bg-slate-900 border border-slate-700 rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.8)] p-1.5 z-50 space-y-1 animate-fade-in">
                        <button
                          onClick={() => {
                            setShowSelectionStorageMenu(false);
                            handleBulkResetRemoveMedia();
                          }}
                          className="w-full flex items-center space-x-2 px-3 py-2 text-xs font-medium text-amber-300 hover:bg-amber-950/50 rounded-md transition-colors text-left cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <div>
                            <div className="font-bold">Delete Local Files Only</div>
                            <div className="text-[9px] text-slate-400">Frees up Mac storage; keeps link pending in DB</div>
                          </div>
                        </button>

                        <button
                          onClick={() => {
                            setShowSelectionStorageMenu(false);
                            handleBulkDeleteSelected();
                          }}
                          className="w-full flex items-center space-x-2 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-950/50 rounded-md transition-colors text-left cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <div>
                            <div className="font-bold">Delete Local Files & DB Record</div>
                            <div className="text-[9px] text-slate-400">Deletes disk file AND archives DB queue record</div>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-[11px] border-violet-500/40 text-violet-300 hover:bg-violet-950/40 cursor-pointer"
                    onClick={handleArchiveSelectedToVault}
                    title="Archive selected links into History Vault & remove from active workspace"
                  >
                    <Archive className="w-3 h-3 mr-1 text-violet-400" /> Archive to Vault
                  </Button>

                  <button
                    onClick={() => setSelectedJobIds([])}
                    className="p-1 rounded text-slate-500 hover:text-slate-200 transition-colors ml-2 cursor-pointer"
                    title="Clear Selection"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Jobs Queue Table */}
            <Card className="p-0 bg-slate-950/40 backdrop-blur-md border-slate-900 overflow-hidden shadow-2xl">
              <div className="p-4 border-b border-slate-900 flex items-center justify-between bg-slate-900/10">
                <div className="flex items-center space-x-3">
                  <DarkCheckbox checked={isAllSelected} onChange={toggleSelectAll} title={isAllSelected ? 'Deselect All' : 'Select All'} />
                  <div className="flex items-center space-x-2">
                    <Monitor className="w-4 h-4 text-violet-400" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">Live Media Queue</span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 bg-violet-950/40 text-violet-400 border border-violet-900/40 rounded">
                    {pendingJobsCount} Pending
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-400 rounded">
                    {filteredJobs.length} / {jobs.length} Total
                  </span>
                </div>
              </div>

              {filteredJobs.length === 0 ? (
                <div className="py-20 text-center space-y-3">
                  <Download className="w-10 h-10 mx-auto text-slate-800 stroke-[1.5] animate-bounce" />
                  <div className="space-y-1">
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">No matching media tasks</p>
                    <p className="text-[10px] text-slate-600 max-w-xs mx-auto">
                      Import batch files, push downloads from Mobile, send via the Web Extension, or paste a URL above.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="text-[9px] uppercase tracking-wider bg-slate-950/80 text-slate-500 border-b border-slate-900">
                      <tr>
                        <th className="py-3.5 px-4 w-10 text-center">
                          <DarkCheckbox checked={isAllSelected} onChange={toggleSelectAll} />
                        </th>
                        <th className="py-3.5 px-5 font-bold">Source Title</th>
                        <th className="py-3.5 px-5 font-bold">Origin</th>
                        <th className="py-3.5 px-5 font-bold">Client Node</th>
                        <th className="py-3.5 px-5 font-bold">Disk Status</th>
                        <th className="py-3.5 px-5 font-bold">State & Progress</th>
                        <th className="py-3.5 px-5 font-bold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-950">
                      {filteredJobs.map((job) => {
                        const isSelected = selectedJobIds.includes(job.id);
                        let nodeIcon = <Laptop className="w-3.5 h-3.5" />;
                        if (job.requestedByDeviceId.includes('mobile')) {
                          nodeIcon = <Cpu className="w-3.5 h-3.5 text-pink-500" />;
                        } else if (job.requestedByDeviceId.includes('extension')) {
                          nodeIcon = <Server className="w-3.5 h-3.5 text-cyan-400" />;
                        } else if (job.requestedByDeviceId.includes('bulk')) {
                          nodeIcon = <FileText className="w-3.5 h-3.5 text-amber-400" />;
                        }

                        return (
                          <tr
                            key={job.id}
                            className={`transition-all duration-200 ${
                              isSelected ? 'bg-violet-950/30' : 'hover:bg-slate-900/20'
                            }`}
                          >
                            <td className="py-4 px-4 text-center">
                              <DarkCheckbox checked={isSelected} onChange={() => toggleSelectJob(job.id)} />
                            </td>
                            <td className="py-4 px-5">
                              <div className="font-bold text-slate-200 truncate max-w-md lg:max-w-xl xl:max-w-2xl leading-normal">{job.title || job.url}</div>
                              <div className="text-[10px] text-slate-600 font-mono truncate max-w-md lg:max-w-xl xl:max-w-2xl mt-0.5 select-all">{job.url}</div>
                            </td>
                            <td className="py-4 px-5">
                              <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono font-bold text-slate-400 capitalize">
                                {job.platform}
                              </span>
                            </td>
                            <td className="py-4 px-5">
                              <div className="flex items-center space-x-1.5 text-slate-400">
                                {nodeIcon}
                                <span className="font-mono text-[10px] font-semibold">{job.requestedByDeviceId}</span>
                              </div>
                            </td>
                            <td className="py-4 px-5">
                              {job.status === 'completed' ? (
                                <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-900/60 text-[9px] font-mono font-bold flex items-center w-fit shadow-xs" title={`Saved on Mac disk: ${job.filePath || downloadConfig.downloadPath}`}>
                                  <FolderOpen className="w-3 h-3 mr-1 text-emerald-400 shrink-0" /> 💾 Saved on Mac
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded bg-slate-900/80 text-amber-400/90 border border-slate-800 text-[9px] font-mono font-bold flex items-center w-fit">
                                  <Link2 className="w-3 h-3 mr-1 text-amber-400 shrink-0" /> 🔗 Link Only
                                </span>
                              )}
                            </td>
                            <td className="py-4 px-5">
                              <div className="space-y-1.5">
                                <StatusBadge status={job.status} />
                                {job.status === 'downloading' && (
                                  <div className="w-28 bg-slate-900 h-1.5 rounded-full overflow-hidden border border-slate-800">
                                    <div
                                      className="bg-gradient-to-r from-cyan-400 to-pink-500 h-full transition-all duration-300"
                                      style={{ width: `${job.progress || 10}%` }}
                                    />
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="py-4 px-5 text-right">
                              <div className="flex items-center justify-end space-x-2">
                                {/* Terminal Logs Icon Button for any job */}
                                <button
                                  onClick={() => {
                                    userClosedConsoleRef.current = false;
                                    setActiveConsoleJob(job);
                                  }}
                                  className="p-1.5 rounded text-slate-500 hover:text-cyan-400 hover:bg-slate-900 transition-colors"
                                  title="View CLI Terminal Logs"
                                >
                                  <Terminal className="w-3.5 h-3.5" />
                                </button>

                                {job.status === 'pending' && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="px-2.5 py-1 text-[10px] border-slate-800 hover:border-pink-500 hover:text-pink-400"
                                    onClick={() => triggerSingleJobOptions(job)}
                                  >
                                    <Play className="w-3 h-3 mr-1 fill-current" /> Start
                                  </Button>
                                )}

                                {job.status === 'downloading' && (
                                  <>
                                    <span className="text-[10px] font-mono font-bold text-cyan-400 animate-pulse mr-1">
                                      {job.progress || 0}%
                                    </span>
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      className="px-2 py-1 text-[10px] bg-rose-950/60 text-rose-400 border-rose-900/60 hover:bg-rose-900"
                                      onClick={() => handleCancelJob(job.id)}
                                      title="Stop Download (Preserve Downloaded Content)"
                                    >
                                      <Square className="w-3 h-3 mr-1 fill-current" /> Stop
                                    </Button>
                                  </>
                                )}

                                {job.status === 'completed' && (
                                  <div className="flex items-center space-x-1.5">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="px-2 py-1 text-[10px] border-slate-800 hover:border-cyan-400 text-cyan-400"
                                      onClick={() => openFileInFinder(job, dbUrl, downloadConfig.downloadPath)}
                                      title="Open File Location in macOS Finder"
                                    >
                                      <FolderOpen className="w-3 h-3 mr-1" /> Finder
                                    </Button>

                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="px-2 py-1 text-[10px] border-violet-900/60 hover:border-violet-400 text-violet-300 hover:bg-violet-950/40 cursor-pointer"
                                      onClick={() => handleManualEagleSync(job)}
                                      title="Send file and exact Source URL to Eagle App"
                                    >
                                      🦅 Eagle
                                    </Button>

                                    <button
                                      onClick={() => handleSingleRemoveFile(job)}
                                      className="p-1.5 rounded text-amber-400 hover:bg-amber-950/50 border border-amber-900/40 transition-colors"
                                      title="Remove downloaded file from disk & reset status to pending (Keep DB link)"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                    </button>

                                    <button
                                      onClick={() => handleSingleDelete(job)}
                                      className="p-1.5 rounded text-rose-400 hover:bg-rose-950/50 border border-rose-900/40 transition-colors"
                                      title="Permanently delete from disk storage AND delete DB record"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}

                                {job.status === 'failed' && (
                                  <div className="flex items-center space-x-1.5">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="px-2 py-1 text-[10px] border-amber-900/60 text-amber-400 hover:bg-amber-950/40"
                                      onClick={() => triggerSingleJobOptions(job)}
                                    >
                                      <RotateCcw className="w-3 h-3 mr-1" /> Retry
                                    </Button>

                                    <button
                                      onClick={() => handleSingleDelete(job)}
                                      className="p-1.5 rounded text-rose-400 hover:bg-rose-950/50 border border-rose-900/40 transition-colors"
                                      title="Delete record from queue"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        ) : (
          /* DEDICATED ACTION-BASED HISTORY VAULT SCREEN */
          <div className="w-full space-y-6 animate-fade-in">
            {/* Top Bar Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black uppercase tracking-wider text-slate-100 flex items-center">
                  <History className="w-5 h-5 text-cyan-400 mr-2" /> Download History Vault
                </h2>
                <p className="text-xs text-slate-500">Action-based backup vault of all cleared, archived, and deleted download tasks.</p>
              </div>

              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 text-xs border-cyan-500/40 text-cyan-300 hover:bg-cyan-950/30"
                  onClick={handleExportHistoryTxt}
                  disabled={historyRecords.length === 0}
                  title="Export all archived links organized by action batch to formatted .txt file"
                >
                  <FileDown className="w-4 h-4 mr-1.5 text-cyan-400" /> Export History (.txt)
                </Button>

                <Button
                  variant="danger"
                  size="sm"
                  className="h-9 px-3 text-xs bg-rose-950/80 text-rose-300 border-rose-900 hover:bg-rose-900"
                  onClick={handleClearHistoryVault}
                  disabled={historyRecords.length === 0}
                  title="Permanently clear History Vault backup database"
                >
                  <Trash2 className="w-4 h-4 mr-1.5" /> Clear History Vault
                </Button>
              </div>
            </div>

            {/* History Search Bar */}
            <div className="relative w-full">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                value={historySearchQuery}
                onChange={(e) => setHistorySearchQuery(e.target.value)}
                placeholder="Search action cards by title, URL, platform, or action type..."
                className="w-full bg-slate-950/60 border border-slate-800 rounded-md pl-9 pr-4 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-400"
              />
            </div>

            {/* History Action Batch Cards */}
            {loadingHistory ? (
              <div className="py-20 text-center space-y-2">
                <RefreshCw className="w-8 h-8 mx-auto text-cyan-400 animate-spin" />
                <p className="text-xs text-slate-400 font-mono">Loading Action History Batches from Neon DB...</p>
              </div>
            ) : filteredActionBatches.length === 0 ? (
              <div className="py-20 text-center space-y-3">
                <History className="w-10 h-10 mx-auto text-slate-800 stroke-[1.5]" />
                <div className="space-y-1">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">No action history batches found</p>
                  <p className="text-[10px] text-slate-600 max-w-xs mx-auto">
                    Clearing workspace or removing links will automatically create action cards here with timestamps and single-click RESTORE ALL options.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredActionBatches.map((batch, idx) => {
                  const isExpanded = expandedBatchIds[batch.batchId] !== false; // Default expanded for great UX
                  const dateStr = new Date(batch.archivedAt).toLocaleString();

                  let actionBadge = {
                    label: 'CLEAR WORKSPACE',
                    badgeClass: 'bg-violet-950/80 text-violet-300 border-violet-700/60',
                    icon: <Trash2 className="w-3.5 h-3.5 mr-1.5 text-pink-400" />,
                  };

                  if (batch.actionType === 'CLEAR_COMPLETED') {
                    actionBadge = {
                      label: 'CLEAR COMPLETED',
                      badgeClass: 'bg-cyan-950/80 text-cyan-300 border-cyan-700/60',
                      icon: <Archive className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />,
                    };
                  } else if (batch.actionType === 'BULK_DELETE') {
                    actionBadge = {
                      label: 'BULK ACTION',
                      badgeClass: 'bg-pink-950/80 text-pink-300 border-pink-700/60',
                      icon: <FileText className="w-3.5 h-3.5 mr-1.5 text-pink-400" />,
                    };
                  } else if (batch.actionType === 'SINGLE_DELETE') {
                    actionBadge = {
                      label: 'SINGLE LINK ARCHIVE',
                      badgeClass: 'bg-slate-900 text-slate-300 border-slate-800',
                      icon: <Link2 className="w-3.5 h-3.5 mr-1.5 text-slate-400" />,
                    };
                  }

                  return (
                    <Card key={batch.batchId} className="p-0 bg-slate-950/50 backdrop-blur-md border-slate-900 overflow-hidden shadow-xl">
                      {/* Card Action Header */}
                      <div className="p-4 border-b border-slate-900 flex items-center justify-between bg-slate-900/30">
                        <div className="flex items-center space-x-3">
                          <button
                            onClick={() => toggleBatchExpand(batch.batchId)}
                            className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-900 transition-colors cursor-pointer"
                          >
                            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} />
                          </button>

                          <div className="flex items-center space-x-2">
                            <span className={`px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider border flex items-center shadow-sm ${actionBadge.badgeClass}`}>
                              {actionBadge.icon}
                              {actionBadge.label}
                            </span>

                            <span className="text-xs font-bold text-slate-200">
                              Action Batch #{filteredActionBatches.length - idx}
                            </span>

                            <span className="text-[11px] text-slate-500 font-mono ml-2">
                              {dateStr}
                            </span>
                          </div>
                        </div>

                        {/* Action Header Controls (RESTORE ALL LINKS Button) */}
                        <div className="flex items-center space-x-3">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 font-bold">
                            {batch.items.length} link{batch.items.length > 1 ? 's' : ''}
                          </span>

                          <Button
                            variant="primary"
                            size="sm"
                            className="h-8 px-3 text-xs font-bold bg-gradient-to-r from-violet-600 to-pink-500 hover:from-pink-500 hover:to-violet-600 shadow-[0_0_15px_rgba(139,92,246,0.3)] cursor-pointer"
                            onClick={() => handleRestoreBatch(batch.items)}
                            title="Bring ALL links from this action batch back to Live Workspace"
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                            RESTORE ALL LINKS ({batch.items.length})
                          </Button>
                        </div>
                      </div>

                      {/* Expandable Items List */}
                      {isExpanded && (
                        <div className="divide-y divide-slate-900/60 bg-slate-950/20">
                          {batch.items.map((item, itemIdx) => (
                            <div key={item.id || itemIdx} className="p-3 px-5 flex items-center justify-between hover:bg-slate-900/30 transition-colors">
                              <div className="flex items-center space-x-3 min-w-0 pr-4">
                                <span className="text-[10px] font-mono text-slate-600 font-bold w-5">#{itemIdx + 1}</span>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-slate-200 truncate max-w-md lg:max-w-2xl">
                                    {item.title || item.url}
                                  </div>
                                  <div className="text-[10px] text-slate-500 font-mono truncate max-w-md lg:max-w-2xl select-all">
                                    {item.url}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center space-x-3 shrink-0">
                                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-bold text-slate-400 capitalize">
                                  {item.platform}
                                </span>

                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2.5 text-[10px] border-slate-800 text-slate-300 hover:border-violet-500 hover:text-violet-300"
                                  onClick={() => handleRestoreBatch([item])}
                                  title="Restore single link back to Live Workspace"
                                >
                                  <Plus className="w-3 h-3 mr-1" /> Restore
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Live Command Console Terminal Modal */}
      <CommandConsoleModal
        isOpen={activeConsoleJob !== null}
        onClose={() => {
          userClosedConsoleRef.current = true;
          setActiveConsoleJob(null);
        }}
        job={jobs.find((j) => j.id === activeConsoleJob?.id) || activeConsoleJob}
        logs={activeConsoleJob ? jobLogs[activeConsoleJob.id] || [] : []}
        onClearLogs={() => {
          if (activeConsoleJob) {
            setJobLogs((prev) => ({ ...prev, [activeConsoleJob.id]: [] }));
          }
        }}
      />

      {/* Download Settings Modal */}
      <DownloadSettingsModal
        isOpen={showSettingsModal}
        onClose={() => {
          setShowSettingsModal(false);
          setTargetDownloadJobs([]);
        }}
        config={downloadConfig}
        onSaveConfig={handleSaveConfig}
        onStartDownload={handleConfirmedDownload}
        targetCount={targetDownloadJobs.length > 0 ? targetDownloadJobs.length : pendingJobsCount}
        title={targetDownloadJobs.length === 1 ? 'Configure Single Download' : 'Configure Batch Download'}
      />

      {/* Bulk Batch Import Modal */}
      <BatchImportModal
        isOpen={showBatchImportModal}
        onClose={() => setShowBatchImportModal(false)}
        onConfirmImport={handleConfirmBatchImport}
      />

      {/* QR Code & Pairing Modal */}
      {showPairingModal && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xs flex items-center justify-center p-6 z-50 animate-fade-in">
          <Card className="max-w-md w-full p-6 space-y-6 relative border-violet-500/55 bg-slate-950 shadow-[0_0_50px_rgba(139,92,246,0.15)]">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-200 flex items-center">
                <QrCode className="w-4 h-4 text-violet-400 mr-2" /> Pair Device Connection
              </h2>
              <button
                onClick={() => setShowPairingModal(false)}
                className="text-slate-500 hover:text-pink-500 text-xs font-bold transition-colors"
              >
                ✕ CLOSE
              </button>
            </div>

            <QRCodeView
              value={pairingPayloadBase64}
              title="Sync Mobile Node"
              subtitle="Scan with the ClipGrab Mobile app camera scanner to link this Neon instance database config."
            />

            <div className="space-y-2.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Browser Extension Payload</label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={pairingPayloadBase64}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded px-3 py-2.5 text-[10px] font-mono text-slate-400 truncate focus:outline-none"
                />
                <Button variant="outline" size="sm" className="h-9 px-3 border-slate-800 hover:border-cyan-400" onClick={copyPairingKeyToClipboard}>
                  {copiedPairingKey ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-500" />}
                </Button>
              </div>
              <p className="text-[9px] text-slate-600 leading-normal">
                Copy and paste this pairing payload directly in the Web Extension popup setting.
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
