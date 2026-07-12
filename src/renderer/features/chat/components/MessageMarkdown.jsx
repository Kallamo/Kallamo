import { memo } from 'react';
import { parseMarkdown } from '../../../utils/markdown';

export default memo(function MessageMarkdown({ content, className }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }} />;
});
