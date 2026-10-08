import React from 'react';
import { Check, ChevronRight, CircleAlert, FileDown, Lock, Package, X } from 'lucide-react';
import Checkbox from '../ui/Checkbox';
import { ProfileAvatar } from './ProfileModal';
import { TYPES } from '../../features/worldbuild/worldbuildConfig';

// Shared pieces of the small modals: what a file carries, options, workflow chains, errors.

export function ToneTile({ icon: Icon, color, size = 'md' }) {
  const box = size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl';
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center ${box}`}
      style={{ color, background: `color-mix(in srgb, ${color} 13%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 26%, transparent)` }}
    >
      <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} />
    </span>
  );
}

// A profile's pen with a small status mark in its corner.
export function MarkedAvatar({ color, size = 40, mark = null, dim = false }) {
  const marks = {
    done: { icon: Check, color: 'var(--theme-status-success)' },
    failed: { icon: X, color: 'var(--theme-status-danger)' },
    warning: { icon: CircleAlert, color: 'var(--theme-status-warning)' },
  };
  const m = mark ? marks[mark] : null;
  return (
    <span className="relative inline-flex shrink-0" style={dim ? { opacity: 0.45 } : undefined}>
      <ProfileAvatar color={color || '#94a3b8'} size={size} />
      {m && (
        <span aria-hidden="true" className="absolute -bottom-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-surface-canvas" style={{ background: m.color, boxShadow: '0 0 0 2px var(--theme-surface-canvas)' }}>
          <m.icon className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
    </span>
  );
}

function Column({ title, icon: Icon, color, items }) {
  return (
    <div className="min-w-0 flex-1 rounded-control border px-4 py-3.5" style={{ background: 'var(--theme-surface-well)', borderColor: 'var(--theme-border-well)' }}>
      <p className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-text-primary"><span style={{ color }}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>{title}</p>
      <ul className="space-y-1.5">
        {items.map(item => (
          <li key={item.key || String(item.label)} className="flex items-center gap-2 text-[0.8125rem] leading-relaxed text-text-secondary">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
            <span className="min-w-0">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// What a file carries and what stays on this computer. Optional parts move between the two as they are chosen.
export function PackageColumns({ inside, stays }) {
  return (
    <div className="flex gap-3">
      <Column title="In the file" icon={Package} color="var(--theme-status-success)" items={inside} />
      <Column title="Stays here" icon={Lock} color="var(--theme-text-muted)" items={stays} />
    </div>
  );
}

export function OptionRow({ checked, onChange, title, description, disabled = false }) {
  return (
    <div className="flex items-center gap-3 rounded-control border border-border-subtle px-3.5 py-3">
      <Checkbox checked={checked} onChange={onChange} ariaLabel={title} disabled={disabled} />
      <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className="min-w-0 text-left focus-visible:outline-none">
        <span className="block text-sm text-text-secondary">{title}</span>
        {description && <span className="block text-xs leading-relaxed text-text-subtle">{description}</span>}
      </button>
    </div>
  );
}

export function FileName({ name }) {
  if (!name) return <span className="mr-auto" />;
  return (
    <span className="mr-auto inline-flex min-w-0 items-center gap-2 text-xs text-text-subtle">
      <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate font-mono">{name}</span>
    </span>
  );
}

export const fileSlug = (name, extension) => `${String(name || 'untitled').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled'}.${extension}`;

export const megabytes = bytes => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`);

// A workflow's steps as pens. Up to four read as named cards; longer chains become a numbered strip with the names below.
export function StepChain({ steps, failedIndex = null }) {
  const markOf = index => (failedIndex == null ? null : index < failedIndex ? 'done' : index === failedIndex ? 'failed' : null);
  const dimOf = index => failedIndex != null && index > failedIndex;
  if (steps.length <= 4) {
    return (
      <div className="flex items-start gap-2 rounded-control border px-4 py-3.5" style={{ background: 'var(--theme-surface-well)', borderColor: 'var(--theme-border-well)' }}>
        {steps.map((step, index) => (
          <React.Fragment key={`${step.name}-${index}`}>
            <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center" style={dimOf(index) ? { opacity: 0.45 } : undefined}>
              <MarkedAvatar color={step.color} size={36} mark={markOf(index)} />
              <span className="max-w-full truncate text-xs font-semibold text-text-secondary">{step.name}</span>
              <span className="text-xs text-text-subtle">Step {index + 1}</span>
            </div>
            {index < steps.length - 1 && <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-text-disabled" aria-hidden="true" />}
          </React.Fragment>
        ))}
      </div>
    );
  }
  return (
    <div className="rounded-control border px-4 pb-3 pt-3.5" style={{ background: 'var(--theme-surface-well)', borderColor: 'var(--theme-border-well)' }}>
      <div className="relative flex items-start justify-between">
        <span aria-hidden="true" className="absolute inset-x-4 top-4 h-px bg-border-default" />
        {steps.map((step, index) => (
          <div key={`${step.name}-${index}`} data-tooltip={`Step ${index + 1} · ${step.name}`} className="relative flex flex-col items-center gap-1" style={dimOf(index) ? { opacity: 0.4 } : undefined}>
            <span className="rounded-[0.625rem]" style={index === failedIndex ? { boxShadow: '0 0 0 2px var(--theme-status-danger)' } : undefined}>
              <MarkedAvatar color={step.color} size={32} mark={markOf(index)} />
            </span>
            <span className="text-xs tabular-nums text-text-subtle">{index + 1}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1 border-t border-border-subtle pt-2.5">
        {steps.map((step, index) => (
          <span key={`${step.name}-${index}`} className={`inline-flex items-center gap-1.5 text-xs ${index === failedIndex ? 'font-semibold text-text-primary' : 'text-text-muted'}`} style={dimOf(index) ? { opacity: 0.45 } : undefined}>
            <span className="tabular-nums text-text-subtle">{index + 1}</span>{step.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ProviderError({ source, message }) {
  return (
    <div className="overflow-hidden rounded-control border" style={{ background: 'color-mix(in srgb, var(--theme-status-danger) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--theme-status-danger) 24%, transparent)' }}>
      <p className="flex items-center gap-2 border-b px-4 py-2 text-xs font-semibold text-status-danger" style={{ borderColor: 'color-mix(in srgb, var(--theme-status-danger) 18%, transparent)' }}>
        <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />{source ? `${source} said` : 'The provider said'}
      </p>
      <p className="custom-scrollbar max-h-48 select-text overflow-y-auto whitespace-pre-wrap px-4 py-3 font-mono text-xs leading-relaxed text-text-secondary">{message}</p>
    </div>
  );
}

// A world's make-up: each entity type in its own icon and colour, as in Worldbuild.
const TYPE_ORDER = ['Characters', 'Locations', 'Factions', 'Items', 'Races', 'Creatures', 'Events', 'System'];
export function TypeStrip({ counts }) {
  const shown = TYPE_ORDER.filter(type => counts?.[type]);
  if (!shown.length) return null;
  return (
    <div className="flex gap-1 rounded-control border px-2 py-2.5" style={{ background: 'var(--theme-surface-well)', borderColor: 'var(--theme-border-well)' }}>
      {shown.map(type => {
        const meta = TYPES[type];
        const Icon = meta.icon;
        return (
          <div key={type} className="flex min-w-0 flex-1 flex-col items-center gap-1 py-1">
            <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md border ${meta.medallion}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
            <span className="text-sm font-semibold tabular-nums text-text-primary">{counts[type]}</span>
            <span className="max-w-full truncate text-xs text-text-subtle">{meta.plural}</span>
          </div>
        );
      })}
    </div>
  );
}

export function RadioCard({ selected, onSelect, title, description, aside = null, children = null, name }) {
  return (
    <label
      className="block cursor-pointer rounded-control border px-3.5 py-3 transition-colors"
      style={selected ? { borderColor: 'color-mix(in srgb, var(--app-accent) 45%, transparent)', background: 'color-mix(in srgb, var(--app-accent) 7%, transparent)' } : { borderColor: 'var(--theme-border-subtle)' }}
    >
      <span className="flex items-center gap-3">
        <input type="radio" name={name} checked={selected} onChange={onSelect} className="peer sr-only" />
        <span aria-hidden="true" className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40 ${selected ? 'border-accent' : 'border-border-strong'}`}>
          {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text-primary">{title}</span>
          {description && <span className="block text-xs leading-relaxed text-text-subtle">{description}</span>}
        </span>
        {aside}
      </span>
      {children}
    </label>
  );
}
