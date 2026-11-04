// Each new copy counts up from the highest one still there: Evenwell, Evenwell 2, Evenwell 3.
function nextStoryTitle(base, titles) {
  const root = String(base || '').trim().replace(/ \d+$/, '') || 'Untitled';
  const pattern = new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: (\\d+))?$`);
  let highest = 0;
  for (const title of titles) {
    const match = pattern.exec(String(title || '').trim());
    if (match) highest = Math.max(highest, match[1] ? Number(match[1]) : 1);
  }
  return highest ? `${root} ${highest + 1}` : root;
}

module.exports = { nextStoryTitle };
