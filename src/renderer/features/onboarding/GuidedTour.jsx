import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lightbulb, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TOURS } from './tours';

const TourContext = createContext({ tour: null, startTour: () => {}, endTour: () => {} });
export const useTour = () => useContext(TourContext);

const GAP = 18;
const EDGE = 12;
const PAD = 6;

// Targets are named in the markup with data-tour, so a guide never depends on layout.
const elementOf = name => document.querySelector(`[data-tour="${name}"]`);
const isShown = el => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
function findTarget(target) {
  for (const name of [].concat(target || [])) {
    const el = elementOf(name);
    if (isShown(el)) return el;
  }
  return null;
}

export function TourProvider({ children }) {
  const [tour, setTour] = useState(null);
  const startTour = useCallback((id, context = {}) => { if (TOURS[id]) setTour({ id, index: 0, context, startedAt: Date.now() }); }, []);
  const endTour = useCallback(() => setTour(null), []);
  const value = useMemo(() => ({ tour, startTour, endTour }), [tour, startTour, endTour]);
  return (
    <TourContext.Provider value={value}>
      {children}
      {tour && <TourOverlay key={`${tour.id}-${tour.startedAt}`} tour={tour} setTour={setTour} />}
    </TourContext.Provider>
  );
}

function TourOverlay({ tour, setTour }) {
  const app = useApp();
  const definition = TOURS[tour.id];
  const [rect, setRect] = useState(null);
  const [ready, setReady] = useState(true);
  const seenRef = useRef(false);
  const cardRef = useRef(null);
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 });

  const go = useCallback((index, back = false) => setTour(current => current && { ...current, index, back }), [setTour]);
  const finish = useCallback(completed => {
    definition.onEnd?.({ app, context: tour.context }, completed);
    setTour(null);
  }, [app, definition, setTour, tour.context]);

  const helpers = {
    app,
    context: tour.context,
    exists: name => isShown(elementOf(name)),
    // A wrapper names the area; the click goes to the control inside it.
    click: name => {
      const el = elementOf(name);
      const control = el && (el.matches('button, a, [role="menuitem"], [role="tab"]') ? el : el.querySelector('button'));
      control?.click();
    },
    get seen() { return seenRef.current; },
    back: Boolean(tour.back),
    next: () => go(tour.index + 1),
    end: finish,
  };

  const steps = definition.steps(helpers);
  const index = Math.min(tour.index, steps.length - 1);
  const step = steps[index];
  const last = index === steps.length - 1;

  // The target can move, mount late or scroll; following it every frame keeps the spotlight on it.
  useEffect(() => {
    seenRef.current = false;
    setReady(true);
    let frame = 0;
    let lastCheck = 0;
    let scrolled = false;
    // Back lands on a step whose action is already done; it moves on only once that is undone and done again.
    let armed = !tour.back;
    const tick = time => {
      const el = step.target ? findTarget(step.target) : null;
      if (el) {
        seenRef.current = true;
        if (!scrolled) { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); scrolled = true; }
        const r = el.getBoundingClientRect();
        setRect(prev => (prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height)
          ? prev : { left: r.left, top: r.top, width: r.width, height: r.height });
      } else {
        setRect(prev => (prev ? null : prev));
      }
      if (time - lastCheck > 200) {
        lastCheck = time;
        const met = step.advanceWhen?.(helpers);
        if (met && armed) { go(index + 1); return; }
        if (!met) armed = true;
        if (step.requires) setReady(Boolean(step.requires(helpers)));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const timer = step.onEnter ? setTimeout(() => step.onEnter(helpers), 60) : null;
    return () => { cancelAnimationFrame(frame); if (timer) clearTimeout(timer); };
    // One run per step: the step object is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.id, index]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const { offsetWidth: width, offsetHeight: height } = el;
    setCardSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
  });

  const next = () => {
    if (step.onNext) step.onNext(helpers);
    if (step.stay) return;
    if (last) finish(true);
    else go(index + 1);
  };

  const placement = rect ? placeCard(rect, cardSize, step.placement) : null;
  // Step widths are given for body text at the base size; the card's text is larger, so they scale with it.
  const width = `calc(${step.width || '21.25rem'} * 1.12)`;

  // The dim stays under menus and dropdowns so they read clearly; the ring and card sit above them.
  return createPortal(
    <>
      <div className="pointer-events-none fixed inset-0 z-[95] titlebar-nodrag">
        {rect ? (
          <div aria-hidden="true" className="fixed rounded-control transition-[left,top,width,height] duration-200 ease-out"
            style={{ ...spotlightBox(rect), boxShadow: '0 0 0 9999px color-mix(in srgb, var(--theme-scrim) 62%, transparent)' }} />
        ) : (
          <div aria-hidden="true" className="fixed inset-0 bg-scrim/60" />
        )}
      </div>
      <div className="pointer-events-none fixed inset-0 z-[10000] titlebar-nodrag">
        {rect && (
          <div aria-hidden="true" className="fixed rounded-control border-2 border-accent transition-[left,top,width,height] duration-200 ease-out"
            style={{ ...spotlightBox(rect), boxShadow: '0 0 1.125rem color-mix(in srgb, var(--app-accent) 45%, transparent)' }} />
        )}
        <div
          ref={cardRef}
          role="dialog"
          aria-label={`${step.where || definition.where}, step ${index + 1} of ${steps.length}`}
          className="pointer-events-auto fixed flex flex-col gap-3 rounded-card border border-accent/40 bg-surface-panel-muted p-5 shadow-overlay"
          style={placement
            ? { left: placement.left, top: placement.top, width, maxWidth: `calc(100vw - ${EDGE * 2}px)` }
            : { left: '50%', top: '50%', width, maxWidth: `calc(100vw - ${EDGE * 2}px)`, transform: 'translate(-50%, -50%)' }}
        >
          {placement?.arrow && (
            <span aria-hidden="true" className="absolute h-3 w-3 rotate-45 border-accent/40 bg-surface-panel-muted" style={placement.arrow} />
          )}
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-muted">{step.where || definition.where} · {index + 1} of {steps.length}</span>
            <button type="button" onClick={() => finish(false)} aria-label="Close the guide"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <h3 className="text-base font-bold text-text-primary">{step.title}</h3>
          <div className="flex flex-col gap-2.5 text-[0.9375rem] leading-relaxed text-text-secondary">
            {step.body}
            {step.target && !rect && step.missing && <p className="text-text-muted">{step.missing}</p>}
            {step.requires && !ready && <p className="text-text-muted">{step.requiresText}</p>}
            {step.hint && rect && <p className="text-sm font-medium text-accent">{step.hint}</p>}
          </div>
          <div aria-hidden="true" className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
            {steps.map((_, i) => <span key={i} className={`h-[3px] rounded-full ${i < index ? 'bg-status-success' : i === index ? 'bg-accent' : 'bg-tint/15'}`} />)}
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            {(step.skip !== false && !last) || step.skipLabel ? (
              <button type="button" onClick={() => (step.onSkip ? step.onSkip(helpers) : finish(false))}
                className="inline-flex min-h-9 items-center whitespace-nowrap rounded-md px-1 text-sm font-medium text-text-subtle transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                {step.skipLabel || definition.skipLabel || 'Skip the guide'}
              </button>
            ) : null}
            <span className="flex-1" />
            {index > 0 && step.back !== false && (
              <button type="button" onClick={() => go(index - 1, true)}
                className="inline-flex min-h-9 items-center whitespace-nowrap rounded-md px-2 text-sm font-semibold text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                Back
              </button>
            )}
            <button type="button" onClick={next} disabled={!ready}
              className="inline-flex min-h-9 items-center whitespace-nowrap rounded-control bg-accent/90 px-3.5 text-sm font-semibold tracking-wide text-on-accent transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50">
              {step.nextLabel || (last ? 'Finish' : 'Next')}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

// The ring sits just outside the target, kept inside the window so an edge control stays framed.
function spotlightBox(rect) {
  const left = Math.max(2, rect.left - PAD);
  const top = Math.max(2, rect.top - PAD);
  const right = Math.min(window.innerWidth - 2, rect.left + rect.width + PAD);
  const bottom = Math.min(window.innerHeight - 2, rect.top + rect.height + PAD);
  return { left, top, width: right - left, height: bottom - top };
}

// Beside the target, on the first side with room; the arrow points at the target's middle.
function placeCard(rect, size, preferred = 'right') {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = size.width || 340;
  const h = size.height || 200;
  const box = { left: rect.left - PAD, top: rect.top - PAD, right: rect.left + rect.width + PAD, bottom: rect.top + rect.height + PAD };
  const fits = {
    right: box.right + GAP + w <= vw - EDGE,
    left: box.left - GAP - w >= EDGE,
    bottom: box.bottom + GAP + h <= vh - EDGE,
    top: box.top - GAP - h >= EDGE,
  };
  const order = [preferred, 'right', 'left', 'bottom', 'top'];
  const side = order.find(candidate => fits[candidate]) || 'center';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const midX = (box.left + box.right) / 2;
  const midY = (box.top + box.bottom) / 2;
  if (side === 'right' || side === 'left') {
    const top = clamp(midY - 40, EDGE, vh - h - EDGE);
    const left = side === 'right' ? box.right + GAP : box.left - GAP - w;
    const arrowTop = clamp(midY - top - 6, 14, h - 26);
    return {
      left, top,
      arrow: side === 'right'
        ? { left: -7, top: arrowTop, borderLeftWidth: 1, borderBottomWidth: 1 }
        : { right: -7, top: arrowTop, borderRightWidth: 1, borderTopWidth: 1 },
    };
  }
  if (side === 'bottom' || side === 'top') {
    const left = clamp(midX - w / 2, EDGE, vw - w - EDGE);
    const top = side === 'bottom' ? box.bottom + GAP : box.top - GAP - h;
    const arrowLeft = clamp(midX - left - 6, 14, w - 26);
    return {
      left, top,
      arrow: side === 'bottom'
        ? { top: -7, left: arrowLeft, borderLeftWidth: 1, borderTopWidth: 1 }
        : { bottom: -7, left: arrowLeft, borderRightWidth: 1, borderBottomWidth: 1 },
    };
  }
  // No side has room (a target filling the window): the card sits inside it, bottom right.
  return { left: vw - w - EDGE * 2, top: vh - h - EDGE * 2, arrow: null };
}
