import React from 'react';
import { X, Sparkles, PenLine, Globe2, Brain, Plus, RefreshCw, Wrench, Drama } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { ToneTile } from './ModalParts';
import { FALLBACK_PATCH_WHATS_NEW, GLOBAL_WHATS_NEW, PATCH_WHATS_NEW } from './whatsNew';
import heroBg from '../../../assets/whats-new-banner.jpg';

const ICONS = { PenLine, Globe2, Brain, Sparkles, Drama };

const SECTION_META = {
  Added: { icon: Plus, color: 'var(--theme-status-success)' },
  Changed: { icon: RefreshCw, color: 'var(--theme-status-info)' },
  Fixed: { icon: Wrench, color: 'var(--theme-status-warning)' },
};

export default function WhatsNewModal({ onClose, type = 'global', version }) {
  const isPatch = type === 'patch';
  const content = isPatch
    ? PATCH_WHATS_NEW[version] || FALLBACK_PATCH_WHATS_NEW
    : GLOBAL_WHATS_NEW;
  const displayVersion = isPatch ? version : content.version;
  const releases = isPatch
    ? [{ version, title: content.title, sections: content.sections }]
    : content.releases;
  const changelogLabel = isPatch ? 'Everything in this update' : `Everything in ${content.version}`;

  return (
    <Modal onClose={onClose} size="xl" className="max-h-[86vh] !max-w-[50rem]">
      <div className="relative h-56 shrink-0 overflow-hidden">
        {/* The well sits near the top right; anchoring high keeps its crossbeam in frame. */}
        <img src={heroBg} alt="" className="absolute inset-0 h-full w-full object-cover object-[center_15%]" />
        <div aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--theme-surface-canvas) 0%, color-mix(in srgb, var(--theme-surface-canvas) 55%, transparent) 55%, color-mix(in srgb, var(--theme-surface-canvas) 10%, transparent) 100%)' }} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3.5 top-3.5 z-10 inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-text-secondary backdrop-blur-sm transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          style={{ background: 'color-mix(in srgb, var(--theme-shade) 30%, transparent)' }}
        >
          <X className="h-4 w-4" />
        </button>
        <div className="absolute inset-x-0 bottom-0 px-6 pb-4">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-accent/[0.13] px-2.5 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/35">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {isPatch ? 'Update notes' : "What's new"} · Kallamo v{displayVersion}
          </span>
          <h2 className="mt-2 text-2xl font-bold leading-tight text-text-primary">{content.title}</h2>
        </div>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6 pt-1">
        <p className="text-sm leading-relaxed text-text-secondary">{content.intro}</p>

        {content.highlights.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-tint/[0.08] surface-card">
            {content.highlights.map((highlight, index) => {
              const Icon = ICONS[highlight.icon] || Sparkles;
              return (
                <div key={highlight.title} className={`flex items-start gap-3.5 px-4 py-3.5 ${index ? 'border-t border-border-subtle' : ''}`}>
                  <ToneTile icon={Icon} color="var(--app-accent)" />
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-text-primary">{highlight.title}</span>
                    <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-text-muted">{highlight.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div>
          <div className="mb-4 mt-2 flex items-center gap-3">
            <span aria-hidden="true" className="h-px flex-1 bg-border-default" />
            <p className="text-sm font-semibold text-text-secondary">{changelogLabel}</p>
            <span aria-hidden="true" className="h-px flex-1 bg-border-default" />
          </div>
          <div className="flex flex-col gap-5">
            {releases.map((release) => (
              <div key={release.version}>
                <div className="flex flex-col gap-6">
                  {Object.entries(release.sections).map(([section, items]) => {
                    const meta = SECTION_META[section] || { icon: Sparkles, color: 'var(--app-accent)' };
                    const SectionIcon = meta.icon;
                    const groups = Array.isArray(items) ? [[null, items]] : Object.entries(items);
                    const count = groups.reduce((total, [, list]) => total + list.length, 0);
                    return (
                      <div key={section}>
                        <div className="mb-2.5 flex items-center gap-2">
                          <SectionIcon className="h-3.5 w-3.5" style={{ color: meta.color }} aria-hidden="true" />
                          <span className="text-xs font-bold text-text-subtle">{section}</span>
                          <span className="text-xs tabular-nums text-text-subtle">{count}</span>
                        </div>
                        <div className="flex flex-col gap-5 pl-[1.375rem]">
                          {groups.map(([group, list]) => (
                            <div key={group || section}>
                              {group && <h3 className="mb-2 text-[0.9375rem] font-semibold text-text-primary">{group}</h3>}
                              <ul className="space-y-2">
                                {list.map((item) => (
                                  <li key={item} className="relative pl-3.5 text-[0.8125rem] leading-relaxed text-text-secondary before:absolute before:left-0 before:top-[0.5625rem] before:h-1 before:w-1 before:rounded-full before:bg-tint/30">
                                    {item}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-5 py-3.5">
        <span className="caption mr-auto">Thanks for creating with Kallamo.</span>
        <Button icon={Sparkles} onClick={onClose}>Let's go</Button>
      </div>
    </Modal>
  );
}
