import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  glass?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, glass = true, className, ...props }) => {
  return (
    <div
      className={twMerge(
        clsx(
          'rounded-xl border p-6 shadow-xl transition-all',
          glass
            ? 'bg-slate-900/60 backdrop-blur-xl border-slate-800/80 text-slate-100'
            : 'bg-slate-900 border-slate-800 text-slate-100',
          className
        )
      )}
      {...props}
    >
      {children}
    </div>
  );
};
