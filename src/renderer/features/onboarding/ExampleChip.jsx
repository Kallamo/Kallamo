import React from 'react';

// Marks content a tour shows for a moment: it is not the person's and is never saved.
export default function ExampleChip({ className = '' }) {
  return (
    <span className={`inline-flex h-5 shrink-0 items-center rounded-full border border-dashed border-border-strong px-2 text-[0.6875rem] font-medium text-text-subtle ${className}`}>
      Example
    </span>
  );
}
