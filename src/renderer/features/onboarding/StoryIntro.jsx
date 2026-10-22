import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight, BookOpen, ChevronLeft, ChevronRight, Clock, Coins, Eye, Guitar, MapPin, Route, Shapes, Shield, Slice, Sword, User, UserPlus, Users,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import ContourCover from '../workspaces/ContourCover';
import { useTour } from './GuidedTour';
import { beginStory, setStoryStage } from './storyActions';

const ICONS = { knife: Slice, coins: Coins, book: BookOpen, shield: Shield, guitar: Guitar, sword: Sword, shapes: Shapes, user: User, 'user-plus': UserPlus, eye: Eye, clock: Clock, users: Users };
const PAGES = ['intro', 'world', 'pick'];

// The first visit to a seeded story: what the Narrative State does, the world, then who to play.
export default function StoryIntro({ workspaceId, workspaceTitle, visible }) {
  const app = useApp();
  const { electronAPI, setActiveWorkspaceView } = app;
  const { startTour } = useTour();
  const [story, setStory] = useState(null);
  const [page, setPage] = useState(null);
  const [pick, setPick] = useState(0);
  const [starting, setStarting] = useState(false);

  const apply = useCallback(next => {
    setStory(next);
    if (!next || next.stage === 'playing') { setPage(null); return; }
    setPage(next.stage === 'own-character' ? 'pick' : 'intro');
    const featured = next.cast.findIndex(member => member.featured);
    setPick(featured >= 0 ? featured : 0);
  }, []);

  useEffect(() => {
    let active = true;
    electronAPI.getOnboardingStory?.(workspaceId).then(result => { if (active && result?.success) apply(result.story); });
    const onChange = event => { if (event.detail?.workspaceId === workspaceId) apply(event.detail.story); };
    window.addEventListener('onboarding-story-change', onChange);
    return () => { active = false; window.removeEventListener('onboarding-story-change', onChange); };
  }, [workspaceId, electronAPI, apply]);

  if (!story || story.stage === 'playing' || !visible) return null;

  const options = [...story.cast, { ...story.newcomer, newcomer: true }];
  const current = options[Math.min(pick, options.length - 1)];

  const choose = async () => {
    if (starting) return;
    if (current.newcomer) {
      await setStoryStage(app, workspaceId, 'own-character');
      setPage(null);
      setActiveWorkspaceView('worldbuild');
      // After the switch, so the guide finds Worldbuild on screen.
      setTimeout(() => startTour('own-character', { workspaceId }), 350);
      return;
    }
    setStarting(true);
    try {
      if (await beginStory(app, workspaceId, current.entityId)) setPage(null);
    } finally {
      setStarting(false);
    }
  };

  if (!page) {
    return (
      <button
        type="button"
        onClick={() => setPage(story.stage === 'own-character' ? 'pick' : 'intro')}
        className="absolute left-1/2 top-28 z-20 inline-flex h-10 -translate-x-1/2 items-center gap-2 rounded-xl bg-accent/90 px-4 text-sm font-semibold text-on-accent shadow-[0_0.375rem_1.125rem_-0.5rem] shadow-accent/50 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Users className="h-4 w-4" aria-hidden="true" />
        Choose who you play
      </button>
    );
  }

  const step = PAGES.indexOf(page);
  const close = () => setPage(null);

  return (
    <Modal size="xl" onClose={close}>
      {page === 'intro' && (
        <>
          <div className="flex flex-col gap-5 px-8 pb-6 pt-7">
            <DialogHeading icon={Route} eyebrow={`Before the story · 1 of ${PAGES.length}`} title={story.intro.title} />
            <p className="text-sm leading-relaxed text-text-secondary">{story.intro.text}</p>
            <ul className="flex flex-col gap-2.5">
              {story.intro.points.map(point => {
                const Icon = ICONS[point.icon] || Eye;
                return (
                  <li key={point.title} className="flex items-start gap-3 rounded-card border border-tint/[0.09] bg-tint/[0.03] px-4 py-3.5">
                    <Icon className="mt-px h-[1.125rem] w-[1.125rem] shrink-0 text-accent" aria-hidden="true" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-text-primary">{point.title}</span>
                      <span className="text-xs leading-relaxed text-text-muted">{point.text}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <Footer step={step} left={<Button variant="subtle" onClick={() => setPage('pick')}>Skip introduction</Button>}>
            <Button autoFocus onClick={() => setPage('world')}>Continue<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Button>
          </Footer>
        </>
      )}

      {page === 'world' && (
        <>
          <div className="relative h-[7.5rem] overflow-hidden">
            <ContourCover title={workspaceTitle} />
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-scrim/85 via-scrim/45 to-scrim/10" />
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-surface-canvas" />
            <div className="absolute bottom-3.5 left-8 flex flex-wrap gap-2">
              <Pill><MapPin className="h-[0.9375rem] w-[0.9375rem] text-entity-location" aria-hidden="true" />{story.world.place}</Pill>
              <Pill><Clock className="h-[0.9375rem] w-[0.9375rem] text-text-secondary" aria-hidden="true" />{story.world.time}<span className="font-medium text-text-muted">· {story.world.date}</span></Pill>
            </div>
          </div>
          <div className="flex flex-col gap-3.5 px-8 pb-6 pt-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-text-muted">The world · 2 of {PAGES.length}</span>
              <h2 className="text-xl font-extrabold tracking-[-0.015em] text-text-primary">{story.world.title}</h2>
            </div>
            {story.world.paragraphs.map(text => <p key={text.slice(0, 24)} className="text-sm leading-relaxed text-text-secondary">{text}</p>)}
            <div className="flex flex-col gap-2 pt-1">
              <span className="text-xs font-semibold text-text-muted">{story.world.placesLabel}</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {story.world.places.map(place => (
                  <div key={place.name} className="flex items-start gap-2.5 rounded-card border border-tint/[0.09] bg-tint/[0.03] px-3.5 py-3">
                    <MapPin className="mt-0.5 h-[0.9375rem] w-[0.9375rem] shrink-0 text-entity-location" aria-hidden="true" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[0.8125rem] font-semibold text-text-primary">{place.name}</span>
                      <span className="text-xs leading-relaxed text-text-muted">{place.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <Footer step={step} left={<Button variant="ghost" onClick={() => setPage('intro')}>Back</Button>}>
            <Button onClick={() => setPage('pick')}>Pick a character<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Button>
          </Footer>
        </>
      )}

      {page === 'pick' && (
        <>
          <div className="flex flex-col gap-5 px-8 pb-7 pt-7">
            <DialogHeading icon={Users} eyebrow={`Your character · 3 of ${PAGES.length}`} title="Who do you want to be?" />
            <div className="flex items-center gap-2">
              <StepButton label="Previous character" icon={ChevronLeft} onClick={() => setPick((pick - 1 + options.length) % options.length)} />
              <div role="radiogroup" aria-label="Characters" className="flex min-w-0 flex-1 gap-1 rounded-control border border-border-default bg-surface-inset p-1">
                {options.map((option, index) => {
                  const Icon = ICONS[option.icon] || User;
                  const on = index === pick;
                  return (
                    <button key={option.entityId || 'new'} type="button" role="radio" aria-checked={on} aria-label={option.short || option.name} data-tooltip={option.short || option.name} onClick={() => setPick(index)}
                      className={`inline-flex min-h-8 min-w-0 flex-1 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${on ? 'bg-accent/[0.13] text-accent shadow-[inset_0_0_0_1px] shadow-accent/45' : 'text-text-muted hover:text-text-primary'}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              <StepButton label="Next character" icon={ChevronRight} onClick={() => setPick((pick + 1) % options.length)} />
            </div>

            <div className="flex flex-col gap-4 rounded-surface border border-tint/[0.08] surface-card p-[1.375rem]">
              <div className="flex items-center gap-4">
                <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-accent/35 bg-accent/10 text-accent">
                  {React.createElement(ICONS[current.icon] || User, { className: 'h-[1.875rem] w-[1.875rem]', strokeWidth: 1.75, 'aria-hidden': true })}
                </span>
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex items-baseline gap-2.5">
                    <span className="truncate text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em] text-text-primary">{current.name}</span>
                    {current.age && <span className="text-lg font-bold text-accent">{current.age}</span>}
                  </div>
                  <span className="inline-flex h-6 self-start items-center rounded-full border border-tint/10 bg-tint/[0.04] px-2.5 text-xs font-medium text-text-secondary">{current.role}</span>
                </div>
                <span className="ml-auto self-start text-xs font-semibold tabular-nums text-text-subtle">{pick + 1} of {options.length}</span>
              </div>
              {current.intro && <p className="text-sm leading-relaxed text-text-secondary">{current.intro}</p>}
              <div className="flex flex-col gap-1 border-t border-tint/[0.08] pt-3.5">
                <span className="text-xs font-semibold text-text-muted">At the start</span>
                <span className="text-[0.8125rem] leading-relaxed text-text-secondary">{current.start}</span>
              </div>
            </div>
          </div>
          <Footer step={step} left={<Button variant="ghost" onClick={() => setPage('world')}>Back</Button>}>
            <Button loading={starting} onClick={choose}>{current.newcomer ? 'Create my character' : `Play as ${current.short || current.name}`}</Button>
          </Footer>
        </>
      )}
    </Modal>
  );
}

function DialogHeading({ icon: Icon, eyebrow, title }) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex rounded-control bg-accent/10 p-2 text-accent"><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold text-text-muted">{eyebrow}</span>
        <h2 className="text-xl font-extrabold tracking-[-0.015em] text-text-primary">{title}</h2>
      </div>
    </div>
  );
}

function Footer({ step, left, children }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-tint/[0.08] bg-surface-panel/60 px-8 py-3.5">
      {left}
      <div className="flex items-center gap-3">
        <div role="img" aria-label={`Step ${step + 1} of ${PAGES.length}`} className="mr-1.5 flex gap-1.5">
          {PAGES.map((page, index) => <span key={page} className={`h-1.5 rounded-full ${index === step ? 'w-[1.125rem] bg-accent' : 'w-1.5 bg-tint/20'}`} />)}
        </div>
        {children}
      </div>
    </div>
  );
}

function Pill({ children }) {
  return <span className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-control border border-tint/[0.14] bg-scrim/55 px-3 text-[0.8125rem] font-semibold text-text-primary backdrop-blur-md">{children}</span>;
}

function StepButton({ label, icon: Icon, onClick }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-border-default bg-surface-panel/70 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
