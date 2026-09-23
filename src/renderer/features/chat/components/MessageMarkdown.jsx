import { memo } from 'react';
import { parseMarkdownCached } from '../../../utils/markdown';

export default memo(function MessageMarkdown({ content, className }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: parseMarkdownCached(content) }} />;
});
