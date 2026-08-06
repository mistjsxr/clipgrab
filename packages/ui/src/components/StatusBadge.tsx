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
    pending: 'bg-amber-950/60 text-amber-400 border-amber-800/60',
    downloading: 'bg-indigo-950/60 text-indigo-400 border-indigo-800/60 animate-pulse',
    completed: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60',
    failed: 'bg-rose-950/60 text-rose-400 border-rose-800/60',
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
          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border',
          styles[status],
          className
        )
      )}
    >
      {labels[status]}
    </span>
  );
};
