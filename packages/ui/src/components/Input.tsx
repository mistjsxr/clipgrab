import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, className, ...props }) => {
  return (
    <div className="flex flex-col space-y-1.5 w-full">
      {label && <label className="text-xs font-semibold text-slate-300">{label}</label>}
      <input
        className={twMerge(
          clsx(
            'w-full px-3.5 py-2.5 bg-slate-900 border rounded-lg text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 transition-all',
            error
              ? 'border-rose-600 focus:ring-rose-500'
              : 'border-slate-800 focus:border-indigo-500 focus:ring-indigo-500/30',
            className
          )
        )}
        {...props}
      />
      {error && <span className="text-xs text-rose-400">{error}</span>}
    </div>
  );
};
