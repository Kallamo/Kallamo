import React, { useState, useEffect } from 'react';
import { FileCode, FileText, Film, Image as ImageIcon, Loader2, Music } from 'lucide-react';
import Modal from '../ui/Modal';
import { ToneTile, megabytes } from './ModalParts';
import hljs from '../../utils/highlight';
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
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
          <span className="caption">Reading the file…</span>
        </div>
      );
    }

    if (error) {
      return (
        <div className="max-w-sm rounded-control border px-5 py-4 text-center" style={{ background: 'color-mix(in srgb, var(--theme-status-danger) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--theme-status-danger) 24%, transparent)' }}>
          <p className="text-sm text-status-danger">{error}</p>
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
          <span className="mb-6"><ToneTile icon={Music} color="var(--app-accent)" /></span>
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
          className="h-[70vh] w-full rounded-control border border-border-subtle"
        />
      );
    }

    if (isTxt) {
      const highlighted = hljs.highlightAuto(textContent).value;
      return (
        <pre className="custom-scrollbar max-h-[65vh] w-full select-text overflow-auto whitespace-pre-wrap rounded-control border p-5 text-left font-mono text-xs leading-relaxed" style={{ background: 'var(--theme-surface-well)', borderColor: 'var(--theme-border-well)' }}>
          <code
            className="hljs !bg-transparent !p-0"
            dangerouslySetInnerHTML={{ __html: highlighted || textContent }}
          />
        </pre>
      );
    }

    return (
      <div className="flex max-w-sm flex-col items-center gap-3 py-10 text-center">
        <ToneTile icon={FileText} color="var(--theme-text-muted)" />
        <p className="text-sm text-text-secondary">There is no preview for .{ext} files.</p>
      </div>
    );
  };

  const kind = isImg ? ['Image', ImageIcon, 'var(--theme-mode-history)'] : isVid ? ['Video', Film, 'var(--theme-mode-always)'] : isAud ? ['Audio', Music, 'var(--theme-mode-always)'] : isPdf ? ['PDF', FileText, 'var(--theme-status-danger)'] : isTxt ? [ext === 'md' ? 'Markdown' : ext === 'txt' ? 'Text' : 'Code', ext === 'md' || ext === 'txt' ? FileText : FileCode, 'var(--theme-mode-searchable)'] : [`.${ext} file`, FileText, 'var(--theme-text-muted)'];

  return (
    <Modal onClose={onClose} size="2xl" title={file.name} subtitle={[kind[0], file.size ? megabytes(file.size) : null].filter(Boolean).join(' · ')} leading={<ToneTile icon={kind[1]} color={kind[2]} />} className="max-h-[85vh]">
      <div className="custom-scrollbar flex min-h-0 flex-1 items-center justify-center overflow-auto p-5">
        {renderContent()}
      </div>
    </Modal>
  );
}
