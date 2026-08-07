import React from 'react';
import QRCode from 'react-qr-code';

export interface QRCodeViewProps {
  value: string;
  size?: number;
  title?: string;
  subtitle?: string;
}

export const QRCodeView: React.FC<QRCodeViewProps> = ({
  value,
  size = 180,
  title = 'Scan with ClipGrab Mobile App',
  subtitle = 'Connects your phone directly to this Neon Postgres instance',
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-6 bg-slate-950 border border-cyber-purple/40 rounded-lg shadow-[0_0_20px_rgba(139,92,246,0.1)] space-y-4 text-center">
      {title && <h3 className="text-sm font-bold text-cyber-cyan uppercase tracking-wider">{title}</h3>}
      <div className="p-3 bg-white rounded-md inline-block shadow-[0_0_15px_rgba(255,255,255,0.1)]">
        <QRCode value={value} size={size} />
      </div>
      {subtitle && <p className="text-xs text-slate-400 max-w-xs leading-relaxed">{subtitle}</p>}
    </div>
  );
};
