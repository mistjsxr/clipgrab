import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { Button } from '@clipgrab/ui';
import { Link2, KeyRound, CheckCircle2 } from 'lucide-react';
import { PairingPayload } from '@clipgrab/types';
import './popup.css';

function Popup() {
  const [paired, setPaired] = useState(false);
  const [pairingPayload, setPairingPayload] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get('clipgrab_pairing_key', (result) => {
        if (result.clipgrab_pairing_key) {
          setPaired(true);
        }
      });
    }
  }, []);

  const handleSavePairingKey = () => {
    setErrorMsg('');
    try {
      const jsonStr = atob(pairingPayload.trim());
      const parsed: PairingPayload = JSON.parse(jsonStr);
      if (!parsed.databaseUrl || !parsed.passId) {
        throw new Error('Invalid payload fields');
      }

      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ clipgrab_pairing_key: pairingPayload.trim() }, () => {
          setPaired(true);
        });
      } else {
        setPaired(true);
      }
    } catch (err: any) {
      setErrorMsg('Invalid key. Copy it from Desktop Command Center.');
    }
  };

  return (
    <div className="w-80 min-h-[220px] bg-slate-950 text-slate-100 p-5 flex flex-col justify-between border border-cyber-purple/30 rounded-lg shadow-[0_0_30px_rgba(139,92,246,0.15)] relative overflow-hidden">
      {/* Background neon glows */}
      <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-cyber-pink/10 blur-xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-20 h-20 rounded-full bg-cyber-purple/10 blur-xl pointer-events-none" />

      <div className="space-y-4 z-10">
        {/* Branding header */}
        <div className="flex items-center space-x-2.5 pb-3 border-b border-slate-900">
          <div className="p-1.5 bg-gradient-to-br from-cyber-purple to-cyber-pink text-white rounded">
            <Link2 className="w-4 h-4" />
          </div>
          <div>
            <h1 className="font-black uppercase tracking-wider text-xs text-slate-100">
              Clip<span className="text-cyber-pink">Grab</span> Extension
            </h1>
            <p className="text-[8px] uppercase tracking-widest font-bold text-slate-500">Device Node Config</p>
          </div>
        </div>

        {!paired ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Pairing Key</label>
              <p className="text-[10px] text-slate-500 leading-normal">
                Paste the Base64 pairing payload from your Master Dashboard:
              </p>
            </div>
            <textarea
              value={pairingPayload}
              onChange={(e) => setPairingPayload(e.target.value)}
              placeholder="eyJkYXRhYmFzZVVybCI6..."
              rows={2}
              className="w-full text-[10px] font-mono p-2 bg-slate-900 border border-slate-800 rounded-md focus:outline-none focus:border-cyber-cyan text-slate-300 placeholder-slate-700 resize-none"
            />
            {errorMsg && <p className="text-[10px] font-bold text-cyber-pink">{errorMsg}</p>}
            <Button variant="primary" size="sm" className="w-full text-[10px] font-bold uppercase tracking-wider h-9" onClick={handleSavePairingKey}>
              <KeyRound className="w-3.5 h-3.5 mr-1.5" /> Save Pairing Key
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 rounded border border-cyber-cyan/35 bg-cyber-cyan/5 text-cyber-cyan text-xs flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-cyber-cyan flex-shrink-0" />
              <span className="font-bold uppercase text-[9px] tracking-wider">Paired to Neon Database</span>
            </div>
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Context Workflow</span>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Right-click links or media player elements on YouTube, Twitter/X, TikTok, or Instagram to push media directly to your Mac downloader queue.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 pt-2 border-t border-slate-900 flex justify-between items-center text-[9px] text-slate-600 font-mono z-10">
        <span>WebExtension v2.0</span>
        <span>Node: Browser</span>
      </div>
    </div>
  );
}

const rootEl = document.getElementById('popup-root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>
  );
}
