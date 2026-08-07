import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type StatusType = 'pending' | 'downloading' | 'completed' | 'failed';

export interface StatusBadgeProps {
  status: StatusType;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className }) => {
  const styles: Record<StatusType, string> = {
    pending: 'bg-amber-950/30 text-amber-400 border-amber-500/30',
    downloading: 'bg-cyber-cyan/10 text-cyber-cyan border-cyber-cyan/30 animate-pulse shadow-[0_0_10px_rgba(0,240,255,0.15)]',
    completed: 'bg-emerald-950/30 text-emerald-400 border-emerald-500/30',
    failed: 'bg-cyber-pink/10 text-cyber-pink border-cyber-pink/30',
  };

  const labels: Record<StatusType, string> = {
    pending: 'Pending',
    downloading: 'Downloading',
    completed: 'Completed',
    failed: 'Failed',
  };

  return (
    <span
      className={twMerge(
        clsx(
          'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border',
          styles[status],
          className
        )
      )}
    >
      {labels[status]}
    </span>
  );
};
