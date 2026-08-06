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
  size = 200,
  title = 'Scan with ClipGrab Mobile App',
  subtitle = 'Connects your phone directly to this Neon Postgres instance',
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl space-y-4 text-center">
      {title && <h3 className="text-lg font-bold text-slate-100">{title}</h3>}
      <div className="p-4 bg-white rounded-xl shadow-inner inline-block">
        <QRCode value={value} size={size} />
      </div>
      {subtitle && <p className="text-xs text-slate-400 max-w-xs">{subtitle}</p>}
    </div>
  );
};
