import { portraitUrl } from './portraits';

/**
 * A portrait or scene image cropped by its saved focus and zoom. The image covers the box
 * whatever its shape and zooms around the focus, so a square photo fills a 3:4 frame too.
 * The box needs its own position (relative or absolute) and size.
 */
export default function FramedImage({ image, label, className = '', children }) {
  const url = portraitUrl(image);
  const focus = image?.focus || {};
  const x = focus.x ?? 50;
  const y = focus.y ?? 50;
  const zoom = Math.max(1, Number(focus.zoom) || 1);
  return (
    <span role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={`block overflow-hidden ${className}`}>
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full max-w-none select-none object-cover"
          style={{ objectPosition: `${x}% ${y}%`, transform: zoom > 1 ? `scale(${zoom})` : undefined, transformOrigin: `${x}% ${y}%` }}
        />
      )}
      {children}
    </span>
  );
}
