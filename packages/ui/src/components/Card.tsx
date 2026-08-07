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
          'rounded-lg border p-6 shadow-2xl transition-all duration-300',
          glass
            ? 'bg-slate-950/50 backdrop-blur-md border-cyber-purple/25 shadow-cyber-purple/5 text-slate-100'
            : 'bg-slate-950 border-slate-900 text-slate-100',
          className
        )
      )}
      {...props}
    >
      {children}
    </div>
  );
};
