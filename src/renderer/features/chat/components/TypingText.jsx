import { useEffect, useState } from 'react';
import { parseMarkdown } from '../../../utils/markdown';

export default function TypingText({ text, onComplete, onClick }) {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    if (!text) {
      setDisplayedText('');
      if (onComplete) onComplete();
      return;
    }

    const words = text.split(/(\s+)/);
    const wordsPerTick = Math.max(1, Math.ceil(words.length / (500 / 16)));
    let currentIndex = 0;
    setDisplayedText('');

    const interval = setInterval(() => {
      if (currentIndex < words.length) {
        currentIndex = Math.min(words.length, currentIndex + wordsPerTick);
        setDisplayedText(words.slice(0, currentIndex).join(''));
      } else {
        clearInterval(interval);
        if (onComplete) onComplete();
      }
    }, 16);

    return () => clearInterval(interval);
  }, [text]);

  return (
    <div onClick={onClick} className="cursor-pointer select-text" title="Click to skip typing effect">
      <div className="leading-relaxed markdown-content" dangerouslySetInnerHTML={{ __html: parseMarkdown(displayedText) }} />
    </div>
  );
}
