import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  className,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center justify-center font-semibold rounded-md border tracking-wide transition-all duration-300 focus:outline-none focus:ring-1 disabled:opacity-40 disabled:cursor-not-allowed';
  
  const variants = {
    primary: 'bg-gradient-to-r from-cyber-purple to-cyber-pink hover:from-cyber-pink hover:to-cyber-purple text-white border-transparent shadow-[0_0_15px_rgba(255,0,127,0.35)] hover:shadow-[0_0_25px_rgba(255,0,127,0.6)] focus:ring-cyber-pink',
    secondary: 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-800 hover:border-cyber-cyan focus:ring-cyber-cyan shadow-sm',
    danger: 'bg-red-950/40 hover:bg-red-900/60 text-red-400 border-red-900/80 hover:border-red-500 focus:ring-red-500 shadow-sm',
    outline: 'bg-transparent hover:bg-cyber-purple/10 text-cyber-purple border-cyber-purple/50 hover:border-cyber-purple focus:ring-cyber-purple',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      className={twMerge(clsx(baseStyles, variants[variant], sizes[size], className))}
      {...props}
    >
      {children}
    </button>
  );
};
