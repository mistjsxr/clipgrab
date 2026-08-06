import React, { useState, useEffect } from 'react';
import { Button, Card, Input, QRCodeView, StatusBadge } from '@clipgrab/ui';
import { createNeonClient, verifyNeonConnection, initializeDatabaseTables, mediaQueue, clipboards } from '@clipgrab/db';
import { isValidMediaUrl, createMediaJobPayload } from '@clipgrab/core-downloader';
import { MediaJob, PairingPayload } from '@clipgrab/types';
import { Download, QrCode, Database, RefreshCw, Copy, Check, Plus, Monitor, ShieldCheck, Link2 } from 'lucide-react';

const LOCAL_STORAGE_DB_KEY = 'clipgrab_db_url';
const LOCAL_STORAGE_PASS_KEY = 'clipgrab_pass_id';

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
  const [pairingPayloadBase64, setPairingPayloadBase64] = useState('');
  const [copiedPairingKey, setCopiedPairingKey] = useState(false);

  // Load existing credentials on startup
  useEffect(() => {
    const savedUrl = localStorage.getItem(LOCAL_STORAGE_DB_KEY);
    const savedPass = localStorage.getItem(LOCAL_STORAGE_PASS_KEY);
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
        // Map Drizzle query result to MediaJob type
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

  const copyPairingKeyToClipboard = () => {
    navigator.clipboard.writeText(pairingPayloadBase64);
    setCopiedPairingKey(true);
    setTimeout(() => setCopiedPairingKey(false), 2000);
  };

  // Render ONBOARDING WIZARD if DB is not configured
  if (!isConfigured) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <Card className="max-w-xl w-full border-slate-800 bg-slate-900/80 backdrop-blur-2xl p-8 space-y-6">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-indigo-600/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <Database className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                ClipGrab Onboarding Wizard
              </h1>
              <p className="text-sm text-slate-400">Bring Your Own Database (BYOD Serverless Neon Postgres)</p>
            </div>
          </div>

          <form onSubmit={handleSetupDatabase} className="space-y-4">
            <Input
              label="Neon HTTP Database Connection String"
              placeholder="postgresql://user:password@ep-cool-db.us-east-2.aws.neon.tech/neondb?sslmode=require"
              value={dbUrl}
              onChange={(e) => setDbUrl(e.target.value)}
              error={errorMessage}
            />

            <div className="p-4 bg-slate-950/60 rounded-lg border border-slate-800/80 text-xs text-slate-400 space-y-2">
              <div className="flex items-center text-slate-300 font-semibold space-x-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Zero Third-Party Servers</span>
              </div>
              <p>
                ClipGrab stores no credentials on external servers. All operations execute directly between your device and your Neon HTTP API endpoint.
              </p>
            </div>

            <Button variant="primary" size="lg" className="w-full" disabled={loading}>
              {loading ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : <Database className="w-5 h-5 mr-2" />}
              {loading ? 'Initializing Database & Schema...' : 'Initialize Neon Database'}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  // Render MASTER COMMAND CENTER DASHBOARD
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-800/80 pb-6">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-indigo-600/20 text-indigo-400 rounded-2xl border border-indigo-500/30 shadow-lg shadow-indigo-500/10">
            <Download className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold bg-gradient-to-r from-indigo-400 via-cyan-300 to-teal-400 bg-clip-text text-transparent">
              ClipGrab Master Command Center
            </h1>
            <p className="text-xs text-slate-400 flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block"></span>
              <span>Connected to Serverless Neon DB</span>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <Button variant="secondary" size="md" onClick={() => setShowPairingModal(true)}>
            <QrCode className="w-4 h-4 mr-2 text-indigo-400" /> Pair Mobile & Extension
          </Button>
        </div>
      </header>

      {/* Quick URL Enqueue Bar */}
      <Card className="p-4 bg-slate-900/90 border-slate-800">
        <div className="flex items-center space-x-3">
          <Link2 className="w-5 h-5 text-indigo-400" />
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleManualEnqueue()}
            placeholder="Paste YouTube, X/Twitter, TikTok, or Direct Media URL..."
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          <Button variant="primary" onClick={handleManualEnqueue}>
            <Plus className="w-4 h-4 mr-1.5" /> Enqueue
          </Button>
        </div>
      </Card>

      {/* Main Jobs Queue Table */}
      <Card className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Monitor className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-slate-100">Live Media Queue</h2>
          </div>
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-slate-800 text-slate-300">
            {jobs.length} Jobs
          </span>
        </div>

        {jobs.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm space-y-2">
            <Download className="w-10 h-10 mx-auto text-slate-700 stroke-1" />
            <p>No media tasks in queue.</p>
            <p className="text-xs text-slate-600">
              Enqueue links manually above, share from Mobile, or right-click in WebExtension!
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-xs uppercase bg-slate-950/80 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Title / URL</th>
                  <th className="py-3 px-4">Platform</th>
                  <th className="py-3 px-4">Requested By</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-100 truncate max-w-xs">{job.title || job.url}</div>
                      <div className="text-xs text-slate-500 truncate max-w-xs">{job.url}</div>
                    </td>
                    <td className="py-3 px-4 capitalize font-medium text-slate-300">{job.platform}</td>
                    <td className="py-3 px-4 text-xs text-slate-400">{job.requestedByDeviceId}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500">
                      {new Date(job.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* QR Code & Pairing Modal */}
      {showPairingModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 z-50">
          <Card className="max-w-md w-full p-6 space-y-6 relative border-indigo-500/40">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-100 flex items-center">
                <QrCode className="w-5 h-5 text-indigo-400 mr-2" /> Pair Device
              </h2>
              <button
                onClick={() => setShowPairingModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <QRCodeView
              value={pairingPayloadBase64}
              title="Mobile Camera QR Code"
              subtitle="Scan with ClipGrab Expo Mobile App to pair instantly."
            />

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400">WebExtension Base64 Pairing Key</label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={pairingPayloadBase64}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-400 truncate focus:outline-none"
                />
                <Button variant="outline" size="sm" onClick={copyPairingKeyToClipboard}>
                  {copiedPairingKey ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
