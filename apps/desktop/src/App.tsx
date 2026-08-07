import React, { useState, useEffect } from 'react';
import { Button, Card, Input, QRCodeView, StatusBadge } from '@clipgrab/ui';
import { createNeonClient, verifyNeonConnection, initializeDatabaseTables, mediaQueue, eq } from '@clipgrab/db';
import { isValidMediaUrl, createMediaJobPayload, cleanMediaUrl } from '@clipgrab/core-downloader';
import { MediaJob, PairingPayload } from '@clipgrab/types';
import { Download, QrCode, Database, RefreshCw, Copy, Check, Plus, Monitor, ShieldCheck, Link2, Server, Trash2, Cpu, Laptop, Play, Settings2, FolderOpen, Ban, RotateCcw, Terminal, Sparkles } from 'lucide-react';
import { DownloadSettingsModal } from './components/DownloadSettingsModal';
import { CommandConsoleModal } from './components/CommandConsoleModal';
import { DownloadConfig, DEFAULT_DOWNLOAD_CONFIG, executeJobDownload, cancelJobDownload, deleteJobFromQueue } from './downloaderEngine';

const LOCAL_STORAGE_DB_KEY = 'clipgrab_db_url';
const LOCAL_STORAGE_PASS_KEY = 'clipgrab_pass_id';
const LOCAL_STORAGE_CONFIG_KEY = 'clipgrab_download_config';

export default function App() {
  const [dbUrl, setDbUrl] = useState('');
  const [passId, setPassId] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Dashboard state
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [showPairingModal, setShowPairingModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [pairingPayloadBase64, setPairingPayloadBase64] = useState('');
  const [copiedPairingKey, setCopiedPairingKey] = useState(false);

  // Download Engine & Terminal Console state
  const [downloadConfig, setDownloadConfig] = useState<DownloadConfig>(DEFAULT_DOWNLOAD_CONFIG);
  const [targetDownloadJobs, setTargetDownloadJobs] = useState<MediaJob[]>([]);
  const [isDownloadingBatch, setIsDownloadingBatch] = useState(false);
  const [jobLogs, setJobLogs] = useState<Record<string, string[]>>({});
  const [activeConsoleJob, setActiveConsoleJob] = useState<MediaJob | null>(null);

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

  const handleManualEnqueue = async () => {
    if (!urlInput.trim()) return;
    if (!isValidMediaUrl(urlInput)) {
      alert('Please enter a valid supported media URL (YouTube, Twitter/X, TikTok, Instagram, Direct MP4/MP3).');
      return;
    }

    try {
      const client = createNeonClient(dbUrl);
      const payload = createMediaJobPayload(urlInput, 'desktop_master');
      
      await client.insert(mediaQueue).values({
        id: payload.id,
        url: payload.url,
        title: payload.title,
        platform: payload.platform,
        status: payload.status,
        requestedByDeviceId: payload.requestedByDeviceId,
        progress: 0,
      });

      setUrlInput('');
    } catch (err: any) {
      alert('Failed to enqueue task: ' + err?.message);
    }
  };

  const appendJobLog = (jobId: string, text: string) => {
    setJobLogs((prev) => ({
      ...prev,
      [jobId]: [...(prev[jobId] || []), text],
    }));
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

    // Open terminal console for the first target job
    setActiveConsoleJob(targetDownloadJobs[0]);
    setIsDownloadingBatch(true);

    for (const job of targetDownloadJobs) {
      await executeJobDownload(
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
    }

    setIsDownloadingBatch(false);
    setTargetDownloadJobs([]);
  };

  const handleCancelJob = async (jobId: string) => {
    appendJobLog(jobId, '[SYSTEM] User requested process cancellation...');
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: 'failed', error: 'Cancelled' } : j)));
    await cancelJobDownload(jobId, dbUrl);
  };

  const handleDeleteJob = async (jobId: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    await deleteJobFromQueue(jobId, dbUrl);
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
      <aside className="w-80 bg-slate-950/60 backdrop-blur-md border-r border-slate-900 p-6 flex flex-col justify-between z-10 shrink-0">
        <div className="space-y-8">
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

          <div className="border-t border-slate-900" />

          {/* Database Info Widget */}
          <div className="space-y-3">
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
          <div className="space-y-3">
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

          {/* Pairing Controls */}
          <div className="space-y-3">
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
        <div className="space-y-4">
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
      <main className="flex-1 p-8 overflow-y-auto z-10">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Top Bar / Queue Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black uppercase tracking-wider text-slate-100">Live Workspace</h2>
              <p className="text-xs text-slate-500">Monitor active download queue and capture direct media sources.</p>
            </div>
            
            {/* Top Right Controls */}
            <div className="flex items-center space-x-3">
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 text-xs border-amber-500/30 text-amber-300 hover:bg-amber-950/20 disabled:opacity-40"
                onClick={handleOptimizeQueueUrls}
                disabled={unoptimizedCount === 0}
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
                Optimize URLs ({unoptimizedCount})
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 text-xs border-slate-800 text-slate-400 hover:text-slate-200"
                onClick={() => {
                  setTargetDownloadJobs([]);
                  setShowSettingsModal(true);
                }}
              >
                <Settings2 className="w-4 h-4 mr-1.5" /> Engine Options
              </Button>

              <Button
                variant="primary"
                size="sm"
                className="h-9 px-4 text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-violet-600 to-pink-500 hover:from-pink-500 hover:to-violet-600 disabled:opacity-50"
                onClick={triggerBatchJobOptions}
                disabled={isDownloadingBatch || (pendingJobsCount === 0 && downloadingJobsCount === 0)}
              >
                {isDownloadingBatch ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-1.5" />
                ) : (
                  <Play className="w-4 h-4 mr-1.5 fill-current" />
                )}
                {isDownloadingBatch
                  ? `Downloading...`
                  : `Download All (${pendingJobsCount})`}
              </Button>
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
              <Button variant="primary" className="py-2.5 px-4 font-bold text-xs" onClick={handleManualEnqueue}>
                <Plus className="w-3.5 h-3.5 mr-1.5" /> Enqueue
              </Button>
            </div>
          </Card>

          {/* Jobs Queue Table */}
          <Card className="p-0 bg-slate-950/40 backdrop-blur-md border-slate-900 overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-slate-900 flex items-center justify-between bg-slate-900/10">
              <div className="flex items-center space-x-2">
                <Monitor className="w-4 h-4 text-violet-400" />
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">Live Media Queue</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 bg-violet-950/40 text-violet-400 border border-violet-900/40 rounded">
                  {pendingJobsCount} Pending
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-400 rounded">
                  {jobs.length} Total
                </span>
              </div>
            </div>

            {jobs.length === 0 ? (
              <div className="py-20 text-center space-y-3">
                <Download className="w-10 h-10 mx-auto text-slate-800 stroke-[1.5] animate-bounce" />
                <div className="space-y-1">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">No active media tasks</p>
                  <p className="text-[10px] text-slate-600 max-w-xs mx-auto">
                    Push downloads from Mobile, send via the Web Extension, or paste a URL above.
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="text-[9px] uppercase tracking-wider bg-slate-950/80 text-slate-500 border-b border-slate-900">
                    <tr>
                      <th className="py-3.5 px-5 font-bold">Source Title</th>
                      <th className="py-3.5 px-5 font-bold">Origin</th>
                      <th className="py-3.5 px-5 font-bold">Client Node</th>
                      <th className="py-3.5 px-5 font-bold">State & Progress</th>
                      <th className="py-3.5 px-5 font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-950">
                    {jobs.map((job) => {
                      let nodeIcon = <Laptop className="w-3.5 h-3.5" />;
                      if (job.requestedByDeviceId.includes('mobile')) {
                        nodeIcon = <Cpu className="w-3.5 h-3.5 text-pink-500" />;
                      } else if (job.requestedByDeviceId.includes('extension')) {
                        nodeIcon = <Server className="w-3.5 h-3.5 text-cyan-400" />;
                      }

                      return (
                        <tr key={job.id} className="hover:bg-slate-900/20 transition-all duration-200">
                          <td className="py-4 px-5">
                            <div className="font-bold text-slate-200 truncate max-w-xs leading-normal">{job.title || job.url}</div>
                            <div className="text-[10px] text-slate-600 font-mono truncate max-w-xs mt-0.5 select-all">{job.url}</div>
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
                                onClick={() => setActiveConsoleJob(job)}
                                className="p-1.5 rounded text-slate-500 hover:text-cyan-400 hover:bg-slate-900 transition-colors"
                                title="View CLI Terminal Logs"
                              >
                                <Terminal className="w-3.5 h-3.5" />
                              </button>

                              {job.status === 'pending' && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="px-2.5 py-1 text-[10px] border-slate-800 hover:border-pink-500 hover:text-pink-400"
                                    onClick={() => triggerSingleJobOptions(job)}
                                  >
                                    <Play className="w-3 h-3 mr-1 fill-current" /> Start
                                  </Button>
                                  <button
                                    onClick={() => handleDeleteJob(job.id)}
                                    className="p-1.5 rounded text-slate-600 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
                                    title="Remove from queue"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
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
                                    title="Cancel Active Download"
                                  >
                                    <Ban className="w-3 h-3 mr-1" /> Cancel
                                  </Button>
                                </>
                              )}

                              {job.status === 'completed' && (
                                <>
                                  <span className="text-[10px] font-mono font-bold text-emerald-400 flex items-center mr-1">
                                    <Check className="w-3 h-3 mr-1" /> Saved
                                  </span>
                                  <button
                                    onClick={() => handleDeleteJob(job.id)}
                                    className="p-1.5 rounded text-slate-600 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
                                    title="Remove job record"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}

                              {job.status === 'failed' && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="px-2 py-1 text-[10px] border-amber-900/60 text-amber-400 hover:bg-amber-950/40"
                                    onClick={() => triggerSingleJobOptions(job)}
                                  >
                                    <RotateCcw className="w-3 h-3 mr-1" /> Retry
                                  </Button>
                                  <button
                                    onClick={() => handleDeleteJob(job.id)}
                                    className="p-1.5 rounded text-slate-600 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
                                    title="Remove job record"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
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
      </main>

      {/* Live Command Console Terminal Modal */}
      <CommandConsoleModal
        isOpen={activeConsoleJob !== null}
        onClose={() => setActiveConsoleJob(null)}
        job={activeConsoleJob}
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

      {/* QR Code & Pairing Modal */}
      {showPairingModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6 z-50 animate-fade-in">
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
