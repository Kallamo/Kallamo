import React from 'react';
import { useApp } from '../context/AppContext';
import { Logotype } from '../logo';

export default function TitleBar() {
  const { electronAPI, setCurrentView } = useApp();

  return (
    <header className="absolute top-0 inset-x-0 flex justify-between items-center h-10 w-full px-2 select-none z-[60]">
      <div className="absolute inset-0 titlebar-drag z-0"></div>
      
      {/* Branding Area (Logotype Wordmark) */}
      <div 
        onClick={() => setCurrentView('dashboard')}
        className="z-10 flex items-center ml-2 titlebar-nodrag cursor-pointer group"
        title="Go to Dashboard"
      >
        <Logotype height={18} className="text-gray-300 group-hover:text-white transition-all duration-300 ease-out transform group-hover:scale-[1.03] group-hover:-translate-y-[1px]" />
      </div>

      <div className="z-10 flex space-x-1 items-center titlebar-nodrag pr-2">
        <button
          onClick={() => electronAPI.minimize()}
          className="p-1.5 hover:bg-gray-700/50 rounded-md transition-colors group cursor-pointer flex items-center justify-center"
          title="Minimize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 6H11" stroke="currentColor" className="text-accent group-hover:text-white transition-colors" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onClick={() => electronAPI.maximize()}
          className="p-1.5 hover:bg-gray-700/50 rounded-md transition-colors group cursor-pointer flex items-center justify-center"
          title="Maximize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1.5" y="1.5" width="9" height="9" stroke="currentColor" className="text-accent group-hover:text-white transition-colors" strokeWidth="1.5" />
          </svg>
        </button>
        <button
          onClick={() => electronAPI.close()}
          className="p-1.5 hover:bg-[#ff5f56] rounded-md transition-colors group cursor-pointer flex items-center justify-center"
          title="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" className="text-accent group-hover:text-white transition-colors" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
