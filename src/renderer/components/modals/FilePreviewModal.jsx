import React, { useState, useEffect } from 'react';
import { X, FileText, Download } from 'lucide-react';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css'; // dark code theme

export default function FilePreviewModal({ file, onClose }) {
  const [textContent, setTextContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fileUrl = file?.path ? `app-file:///${encodeURI(file.path.replace(/\\/g, '/'))}` : '';
  const ext = file?.name ? file.name.split('.').pop().toLowerCase() : '';

  const isImg = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext);
  const isVid = ['mp4', 'webm', 'ogg'].includes(ext);
  const isAud = ['mp3', 'wav', 'ogg'].includes(ext);
  const isPdf = ext === 'pdf';
  const isTxt = ['txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'py', 'rs', 'go', 'sh', 'bat', 'yml', 'yaml', 'sql', 'xml'].includes(ext);

  useEffect(() => {
    if (file && isTxt) {
      loadTextFile();
    }
  }, [file]);

  const loadTextFile = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('Failed to read file contents');
      const text = await response.text();
      setTextContent(text);
    } catch (err) {
      console.error('Error reading file for preview:', err);
      setError('Could not load file text content.');
    } finally {
      setLoading(false);
    }
  };

  if (!file) return null;

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-12 space-y-3">
          <svg className="animate-spin h-6 w-6 text-accent" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Reading file...</span>
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-center p-6 bg-red-950/20 border border-red-900/40 rounded-xl max-w-sm">
          <p className="text-xs text-red-400 font-semibold">{error}</p>
        </div>
      );
    }

    if (isImg) {
      return (
        <div className="flex items-center justify-center p-2 select-none w-full h-full max-h-[70vh]">
          <img
            src={fileUrl}
            alt={file.name}
            className="max-w-full max-h-[65vh] object-contain rounded-lg shadow-lg"
          />
        </div>
      );
    }

    if (isVid) {
      return (
        <div className="flex items-center justify-center w-full h-full select-none max-h-[70vh]">
          <video
            src={fileUrl}
            controls
            autoPlay
            className="max-w-full max-h-[65vh] rounded-lg shadow-lg"
          />
        </div>
      );
    }

    if (isAud) {
      return (
        <div className="flex flex-col items-center justify-center py-10 w-full max-w-md select-none">
          <div className="w-16 h-16 rounded-full bg-[#1a2d32]/50 border border-[#FBCB2D]/15 flex items-center justify-center mb-6">
            <svg className="w-6 h-6 text-accent animate-pulse" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
          <audio
            src={fileUrl}
            controls
            autoPlay
            className="w-full"
          />
        </div>
      );
    }

    if (isPdf) {
      return (
        <embed
          src={fileUrl}
          type="application/pdf"
          className="w-full h-[70vh] border border-gray-800 rounded-lg"
        />
      );
    }

    if (isTxt) {
      const highlighted = hljs.highlightAuto(textContent).value;
      return (
        <pre className="w-full max-h-[65vh] overflow-auto text-left rounded-xl p-4 bg-[#01070a] border border-gray-900 custom-scrollbar text-xs font-mono leading-relaxed whitespace-pre-wrap select-text">
          <code
            className="hljs"
            dangerouslySetInnerHTML={{ __html: highlighted || textContent }}
          />
        </pre>
      );
    }

    // Default fallback
    return (
      <div className="text-center py-10 max-w-sm flex flex-col items-center">
        <FileText className="w-12 h-12 text-gray-700 mb-3" />
        <p className="text-xs text-gray-400 font-bold mb-2">No preview available for this format.</p>
        <span className="text-[10px] text-gray-500 font-mono">.{ext} File</span>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm select-none p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-4xl max-h-[85vh] bg-[#020d12] border border-gray-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800/80 bg-[#011419]/50 shrink-0">
          <div className="flex flex-col min-w-0 mr-4 select-text">
            <span className="text-xs font-bold text-white truncate font-sans">{file.name}</span>
            <span className="text-[9px] text-gray-500 font-mono mt-0.5">{Math.round(file.size / 1024)} KB</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-white hover:bg-white/5 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body content */}
        <div className="flex-1 overflow-auto p-5 flex items-center justify-center bg-[#000508]/40">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
