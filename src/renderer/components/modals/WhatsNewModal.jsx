import React from 'react';
import { X, Sparkles, PenLine, Globe2, Brain, Plus, RefreshCw, Wrench } from 'lucide-react';
import Modal from '../ui/Modal';
import { FALLBACK_PATCH_WHATS_NEW, GLOBAL_WHATS_NEW, PATCH_WHATS_NEW } from './whatsNew';
import heroBg from '../../../assets/onboarding-bg.svg';

const ICONS = { PenLine, Globe2, Brain, Sparkles };

const SECTION_META = {
  Added: { icon: Plus, color: 'text-emerald-400' },
  Changed: { icon: RefreshCw, color: 'text-sky-400' },
  Fixed: { icon: Wrench, color: 'text-amber-400' },
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
  const changelogLabel = isPatch ? 'Everything in this update' : 'Everything in 1.1 so far';

  return (
    <Modal onClose={onClose} size="xl" className="max-h-[86vh]">
      <div className="relative shrink-0 h-40 overflow-hidden">
        <img src={heroBg} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#011419] via-[#011419]/55 to-[#011419]/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#011419]/70 to-transparent" />

        <button
          onClick={onClose}
          className="absolute top-3.5 right-3.5 z-10 text-gray-300 hover:text-white bg-black/30 hover:bg-black/50 backdrop-blur-sm rounded-full p-1.5 cursor-pointer transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="absolute bottom-0 left-0 right-0 px-6 pb-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-accent">
              {isPatch ? 'Update notes' : 'What\'s New'} &middot; v{displayVersion}
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
            {content.title}
          </h2>
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="px-6 pt-4">
          <p className="text-sm leading-relaxed text-gray-300">{content.intro}</p>
        </div>

        {content.highlights.length > 0 && (
          <div className="px-6 pt-4 pb-5 grid grid-cols-1 gap-2.5">
            {content.highlights.map((highlight) => {
              const Icon = ICONS[highlight.icon] || Sparkles;
              return (
                <div
                  key={highlight.title}
                  className="group flex items-start gap-3.5 bg-gradient-to-br from-[#0a1c24] to-[#08161d] border border-gray-800/70 rounded-xl p-4 transition-colors hover:border-accent/40"
                >
                  <div className="relative flex items-center justify-center w-11 h-11 rounded-xl bg-accent/10 border border-accent/25 shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                    <div className="absolute inset-0 rounded-xl bg-accent/10 blur-md opacity-0 group-hover:opacity-100 transition-opacity" />
                    <Icon className="relative w-5 h-5 text-accent" />
                  </div>
                  <div className="flex flex-col gap-0.5 pt-0.5">
                    <span className="text-sm font-bold text-white">{highlight.title}</span>
                    <p className="text-[0.8125rem] leading-relaxed text-gray-400">{highlight.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="px-6 py-5 border-t border-gray-800/60 bg-[#020c11]/60">
          <div className="flex items-center gap-2 mb-4">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-gray-800" />
            <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-gray-500">
              {changelogLabel}
            </span>
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-gray-800" />
          </div>
          <div className="flex flex-col gap-3">
            {releases.map((release) => (
              <div key={release.version} className="rounded-xl border border-gray-800/60 bg-[#061219]/40 p-4">
                {!isPatch && (
                  <div className="flex items-baseline justify-between gap-3 mb-4">
                    <span className="text-sm font-bold text-white">{release.title}</span>
                    <span className="text-[0.6875rem] font-bold tracking-wider text-accent shrink-0">v{release.version}</span>
                  </div>
                )}
                <div className="flex flex-col gap-5">
                  {Object.entries(release.sections).map(([section, items]) => {
                    const meta = SECTION_META[section] || { icon: Sparkles, color: 'text-accent' };
                    const SectionIcon = meta.icon;
                    return (
                      <div key={section}>
                        <div className="flex items-center gap-2 mb-2">
                          <SectionIcon className={`w-3.5 h-3.5 ${meta.color}`} />
                          <span className="text-xs font-bold text-gray-200 uppercase tracking-wider">{section}</span>
                          <span className="text-[0.625rem] text-gray-600 font-semibold">{items.length}</span>
                        </div>
                        <ul className="flex flex-col gap-1.5 pl-1 border-l border-gray-800/70 ml-1">
                          {items.map((item) => (
                            <li key={item} className="flex gap-2.5 text-[0.8125rem] leading-relaxed text-gray-400 pl-3.5">
                              <span className={`${meta.color} opacity-50 mt-1.5 shrink-0 text-[0.5rem]`}>&#9679;</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="shrink-0 flex items-center justify-between gap-2 px-6 py-4 border-t border-gray-800/60 bg-[#0a161d]/40">
        <span className="text-[0.6875rem] text-gray-500 italic">Thanks for creating with Kallamo.</span>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 bg-accent text-[#0a1520] text-sm font-bold rounded-lg px-5 py-2 shadow-lg shadow-accent/20 hover:brightness-110 cursor-pointer"
        >
          <Sparkles className="w-4 h-4" /> Let's go
        </button>
      </div>
    </Modal>
  );
}
