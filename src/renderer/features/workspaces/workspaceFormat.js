export const coverUrl = (path) => (path && path.trim() ? `app-file:///${path.replace(/\\/g, '/')}` : null);

// A roleplay leads with the place its scene is in; anything else, or a place without a picture, with its cover.
export function leadImage(chat, { skipScene = false } = {}) {
  const scene = chat?.experienceMode === 'roleplay' && !skipScene ? chat.roleplayScene : null;
  if (scene?.background?.path) {
    const focus = scene.background.focus;
    return { src: coverUrl(scene.background.path), position: focus ? `${focus.x}% ${focus.y}%` : 'center' };
  }
  const cover = coverUrl(chat?.backgroundImage);
  return cover ? { src: cover, position: 'center 40%' } : null;
}

export function timeAgo(timestamp, now = Date.now()) {
  if (!timestamp) return '';
  const minutes = Math.round((now - timestamp) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.round(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// The seeded example workspace marks itself in its description; the home screen labels it instead.
const EXAMPLE_PREFIX = '(Example)';
export const isExampleWorkspace = (chat) => (chat?.description || '').startsWith(EXAMPLE_PREFIX);
export const displayDescription = (chat) => (chat?.description || '').replace(EXAMPLE_PREFIX, '').trim();
