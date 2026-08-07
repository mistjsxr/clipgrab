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
      {label && <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">{label}</label>}
      <input
        className={twMerge(
          clsx(
            'w-full px-3.5 py-2.5 bg-slate-900/60 border rounded-md text-slate-100 placeholder-slate-600 text-sm focus:outline-none focus:ring-1 transition-all duration-300',
            error
              ? 'border-cyber-pink/50 focus:ring-cyber-pink/30'
              : 'border-slate-800 focus:border-cyber-cyan focus:ring-cyber-cyan/30',
            className
          )
        )}
        {...props}
      />
      {error && <span className="text-xs text-cyber-pink">{error}</span>}
    </div>
  );
};
