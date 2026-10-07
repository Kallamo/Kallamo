import React from 'react';
import { Settings } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Logotype } from '../logo';

export default function TitleBar({ onOpenSettings, onPreloadSettings }) {
  const { electronAPI, setCurrentView } = useApp();

  return (
    <header className="absolute top-0 inset-x-0 flex justify-between items-center h-10 w-full px-2 select-none z-[60]">
      {/* No band of its own: each screen paints up to the window top, this only deepens it a little. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-titlebar-shade via-titlebar-shade/30 via-70% to-transparent"></div>
      <div className="absolute inset-0 titlebar-drag z-0"></div>
      
      {/* Branding Area (Logotype Wordmark) */}
      <div 
        onClick={() => setCurrentView('dashboard')}
        className="z-10 flex items-center ml-2 titlebar-nodrag cursor-pointer group"
        aria-label="Go to Dashboard"
        data-tooltip="Go to Dashboard"
      >
        <Logotype height={20} className="text-gray-300 group-hover:text-text-primary transition-all duration-300 ease-out transform group-hover:scale-[1.03] group-hover:-translate-y-[1px]" />
      </div>

      <div className="z-10 flex space-x-1 items-center titlebar-nodrag pr-2">
        {onOpenSettings && (
          <>
            <button
              type="button"
              onClick={onOpenSettings}
              onMouseEnter={onPreloadSettings}
              onFocus={onPreloadSettings}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-text-secondary transition-colors hover:bg-tint/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer"
            >
              <Settings aria-hidden="true" className="h-3.5 w-3.5" />
              Settings
            </button>
            <span aria-hidden="true" className="mx-1.5 h-4 w-px bg-tint/10" />
          </>
        )}
        <button
          onClick={() => electronAPI.minimize()}
          className="p-1.5 hover:bg-gray-700/50 rounded-md transition-colors group cursor-pointer flex items-center justify-center"
          aria-label="Minimize"
          data-tooltip="Minimize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 6H11" stroke="currentColor" className="text-accent group-hover:text-text-primary transition-colors" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onClick={() => electronAPI.maximize()}
          className="p-1.5 hover:bg-gray-700/50 rounded-md transition-colors group cursor-pointer flex items-center justify-center"
          aria-label="Maximize"
          data-tooltip="Maximize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1.5" y="1.5" width="9" height="9" stroke="currentColor" className="text-accent group-hover:text-text-primary transition-colors" strokeWidth="1.5" />
          </svg>
        </button>
        <button
          onClick={() => electronAPI.close()}
          className="p-1.5 hover:bg-danger-solid rounded-md transition-colors group cursor-pointer flex items-center justify-center"
          aria-label="Close"
          data-tooltip="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" className="text-accent group-hover:text-text-primary transition-colors" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
