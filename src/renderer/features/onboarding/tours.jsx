import React from 'react';
import { beginStory } from './storyActions';

// Each step names its target by data-tour. `action` is what Next does for the user when the step
// asks for a click; `advanceWhen` moves on by itself once the user has done it.
const B = ({ children }) => <b className="font-semibold text-text-primary">{children}</b>;
const P = ({ children }) => <p>{children}</p>;
const Code = ({ children }) => <code className="font-mono text-[0.8125rem] text-text-primary">{children}</code>;
const List = ({ children }) => <ul className="flex list-disc flex-col gap-1.5 pl-4">{children}</ul>;

const later = (fn, ms = 150) => setTimeout(fn, ms);

const setup = {
  where: 'Setup',
  skipLabel: 'Skip the guide',
  steps: ({ app, context }) => {
    const unlinked = app.writingProfiles.find(profile => profile.name === context.profileName && profile.needsSetup);
    const openSetup = h => {
      const name = context.profileName;
      const item = name && [...document.querySelectorAll('[data-tour="library-rail"] button')].find(button => button.textContent.includes(name));
      item?.click();
      later(() => h.click('setup-action'));
    };
    return [
      {
        where: 'Welcome', width: '26.25rem', nextLabel: 'Start the guide',
        title: 'Set up Kallamo to write with AI',
        body: <>
          <P>Kallamo does not come with a model of its own. You connect one, then choose which parts of the app use it. There are three stops:</P>
          <List>
            <li><B>Connections</B>, in Settings: where the model comes from.</li>
            <li><B>AI roles</B>, in Settings: the model Kallamo's helpers use.</li>
            <li><B>AI profiles</B>, in the Library: the model each voice replies with.</li>
          </List>
          <P>It takes a few minutes. You can close the guide at any step and come back to it from the launch screen.</P>
        </>,
      },
      {
        where: 'Settings', target: 'settings-button', placement: 'bottom', hint: 'Click Settings',
        title: 'Open Settings',
        body: <P>Settings holds everything about how Kallamo talks to AI models. It is always here, at the top right of the window, wherever you are in the app.</P>,
        advanceWhen: h => h.exists('settings-nav-connections'),
        onNext: h => h.click('settings-button'),
      },
      {
        where: 'Connections', target: 'add-connection', placement: 'bottom', hint: 'Click Add connection',
        title: 'Add a connection',
        body: <>
          <P>A connection tells Kallamo where to send requests: a provider on the internet, or a model running on this computer.</P>
          <P>You can add more than one and use them for different jobs, like a strong model for writing and a cheaper one for the helpers.</P>
        </>,
        missing: 'Open Connections in the Settings menu on the left.',
        advanceWhen: h => h.exists('provider-grid'),
        onNext: h => h.click('add-connection'),
      },
      {
        where: 'New connection', target: 'provider-grid', placement: 'bottom', width: '26.25rem', hint: 'Pick one',
        title: 'Choose a provider',
        body: <List>
          <li><B>OpenRouter</B>: one key gives you models from many companies. The easiest place to start.</li>
          <li><B>Anthropic, OpenAI, Google AI</B>: each company's own service, with a key from its website.</li>
          <li><B>Vertex AI, AWS Bedrock</B>: for a Google Cloud or AWS account you already use.</li>
          <li><B>Local or compatible</B>: a model on this computer through LM Studio or Ollama. Private and free to run, but it needs a capable machine.</li>
        </List>,
        missing: 'Press Add connection on the Connections page to open the form.',
      },
      {
        where: 'New connection', target: 'connection-details', placement: 'top', width: '25rem',
        title: 'Name and base URL',
        body: <>
          <P><B>Name</B> is only a label: it is how this connection appears when you pick a model for a profile or a role. Type one you will recognise, like the provider's name.</P>
          <P><B>Base URL</B> is the address requests go to. For OpenRouter, Anthropic, OpenAI and Google, leave it as it is. Change it for a local server, like <Code>http://127.0.0.1:1234/v1</Code> for LM Studio, or for a proxy.</P>
        </>,
      },
      {
        where: 'New connection', target: ['api-key', 'connection-details'], placement: 'bottom',
        title: 'Paste your API key',
        body: <>
          <P>The API key works like a password to the provider. Create one on the provider's website, in the API keys section of your account, and paste it here.</P>
          <P>It is stored only on this computer and sent only to that provider. Local servers usually need none.</P>
        </>,
      },
      {
        where: 'New connection', target: 'connection-models', placement: 'top', width: '23.75rem', hint: 'Click Create connection',
        title: 'Add the models you want',
        body: <>
          <P>Type a model's ID exactly as the provider writes it and press Add. Repeat for each model you want to use.</P>
          <List>
            <li>OpenRouter: <Code>z-ai/glm-5.3</Code></li>
            <li>OpenAI: <Code>gpt-6-sol</Code></li>
            <li>Google AI: <Code>gemini-4-argon</Code></li>
          </List>
          <P>Profiles and roles choose from this list later. When you are done, press <B>Create connection</B> at the top.</P>
        </>,
        advanceWhen: h => h.seen && !h.exists('provider-grid') && h.exists('connection-row'),
        requires: () => document.querySelector('[data-tour="create-connection"]')?.disabled === false,
        requiresText: 'Give the connection a name and at least one model first.',
        stay: true,
        onNext: h => h.click('create-connection'),
      },
      {
        where: 'Settings', target: 'settings-nav-roles', placement: 'right', hint: 'Click AI roles',
        title: 'Your connection is ready',
        body: <>
          <P>It now appears under Your connections, with its models. "Used by" fills in once a profile or a role picks it.</P>
          <P>Next, choose the model Kallamo's own helpers use. Open <B>AI roles</B> in the menu.</P>
        </>,
        missing: 'Open Settings to continue.',
        advanceWhen: h => h.exists('system-ai'),
        onNext: h => h.click('settings-nav-roles'),
      },
      {
        where: 'AI roles', target: 'system-ai', placement: 'bottom',
        title: 'Choose the System AI model',
        body: <>
          <P>System AI is the default model for Kallamo's helpers. They work behind the scenes and never write your replies.</P>
          <P>Pick your connection on the left and a model on the right. A fast, inexpensive model works well here.</P>
        </>,
        missing: 'Open AI roles in the Settings menu.',
      },
      {
        where: 'AI roles', target: 'ai-roles', placement: 'left', width: '22.5rem',
        title: 'What each role does',
        body: <>
          <List>
            <li><B>Narrative State</B> keeps roleplay consistent: scenes, who knows what, relationships.</li>
            <li><B>Tagger</B> marks the Worldbuild names each passage mentions.</li>
            <li><B>Retrieval Planner</B> decides what to look up before a reply.</li>
            <li><B>Summarizer</B> titles and summarises archived conversations.</li>
          </List>
          <P>Each can share System AI, run its own model, or be turned off. Leaving them all on System AI is a good start.</P>
        </>,
        missing: 'Open AI roles in the Settings menu.',
      },
      {
        where: 'Launch screen', target: ['settings-back', 'library-button'], placement: 'bottom', hint: 'Click Library',
        title: 'Open the Library',
        body: <>
          <P>Settings is done. Leave it with <B>Back</B> at the top left.</P>
          <P>On the launch screen, the <B>Library</B> holds your AI profiles, the voices that reply to you in each workspace.</P>
        </>,
        advanceWhen: h => h.exists('library-rail'),
        onNext: h => { h.click('settings-back'); h.app.setCurrentView('library'); },
      },
      {
        where: 'Library', target: 'library-rail', placement: 'right', hint: 'Click Set up',
        title: 'AI profiles',
        body: <>
          <P>An AI profile is a voice: a model, a set of rules and a personality. It is what replies to you in a workspace, and one workspace can use several.</P>
          <P>Profiles marked <b className="font-semibold text-status-setup">Needs a model</b> cannot reply yet. Kallamo comes with a few, including the Narrator that runs the Evenwell story.</P>
          <P>Select a profile, then press <B>Set up</B>.</P>
        </>,
        missing: 'Open the Library from the launch screen.',
        advanceWhen: h => h.exists('profile-connection'),
        onNext: openSetup,
      },
      {
        where: 'Library', target: 'profile-connection', placement: 'right', hint: 'Click Save profile',
        title: 'Give the profile a model',
        body: <>
          <P>Under <B>Connection</B>, pick the connection you created and one of its models, then press <B>Save profile</B> at the bottom.</P>
          <P>Repeat this for every profile you want to use. Each one can have its own model: a stronger one for your main voice, a cheaper one for quick helpers.</P>
        </>,
        missing: 'Select a profile in the Library and press Set up.',
        advanceWhen: h => h.seen && !h.exists('profile-connection'),
        // Back from the last step finds the editor closed; reopen it so this step has its field.
        onEnter: h => { if (h.back && !h.exists('profile-connection')) openSetup(h); },
        stay: true,
        onNext: h => h.click('profile-save'),
      },
      unlinked ? {
        where: 'Library', width: '25rem', nextLabel: 'Finish',
        title: `${unlinked.name} can't reply yet`,
        body: <>
          <P>It needs a connection that has its API key, and one of that connection's models.</P>
          <P>Press <B>Back</B> to finish it now, or later from the Library: select the profile and press <B>Set up</B>. A missing key goes in Settings, under Connections.</P>
        </>,
        onNext: h => h.app.setCurrentView('dashboard'),
      } : {
        where: 'Done', width: '25rem', nextLabel: 'Finish', back: false,
        title: 'You are ready to write',
        body: <>
          <P>Every profile with a model can reply now. Open a workspace to write, chat or build a world with it, or press <B>Begin</B> on Evenwell to start the story.</P>
          <P>Added a new model later? It is all in the same places: Connections and AI roles in Settings, AI profiles in the Library.</P>
        </>,
        onNext: h => h.app.setCurrentView('dashboard'),
      },
    ];
  },
};

const ownCharacter = {
  where: 'Your character',
  skipLabel: 'Stop the guide',
  // A character made here already showed most of Worldbuild, so its overview tour is not offered after.
  onEnd: ({ app }) => app.dismissHint('worldbuildTourSeen'),
  steps: ({ context }) => {
    const sheet = document.querySelector('[data-tour="wb-sheet-head"]');
    const name = sheet?.dataset.entityName || '';
    const short = name.split(/\s+/)[0] || name;
    return [
      {
        width: '26.25rem', nextLabel: 'Start', skipLabel: "Skip, I'll do it myself",
        title: 'Make someone new',
        body: <>
          <P>You'll fill in a character sheet here in Worldbuild. The AI reads it whenever this person is in a scene, so a few honest lines do more than a long biography.</P>
          <P>It takes about five minutes. You can stop at any step and finish later.</P>
        </>,
      },
      {
        target: 'wb-create', placement: 'right', hint: 'Click Create',
        title: 'Every sheet starts at Create',
        body: <P>Press <B>Create</B>. People, places, factions and items all begin here.</P>,
        advanceWhen: h => h.exists('wb-create-Characters'),
        onNext: h => h.click('wb-create'),
      },
      {
        target: 'wb-create-Characters', placement: 'right', hint: 'Click Character',
        title: 'Choose Character',
        body: <P>A blank character sheet opens. Nothing is saved until you press Create character at the end.</P>,
        missing: 'Press Create in the sidebar to see the list.',
        advanceWhen: h => h.exists('wb-new-head'),
        onNext: h => { if (!h.exists('wb-create-Characters')) h.click('wb-create'); later(() => h.click('wb-create-Characters')); },
      },
      {
        target: 'wb-new-head', placement: 'bottom', width: '23.75rem',
        title: 'Name, and what others call them',
        body: <>
          <P><B>Name</B> is what the story calls them.</P>
          <P><B>Other names</B> catches nicknames and titles. Press Enter after each one: when the story uses any of them, it points to this sheet.</P>
        </>,
        missing: 'Choose Character under Create to open a new sheet.',
      },
      {
        target: 'wb-new-identity', placement: 'left',
        title: 'Identity',
        body: <>
          <P><B>Status</B>, <B>age</B> and <B>born</B>. The birth date uses this world's calendar; tick Show the birthday to see it there.</P>
          <P>The eye beside a field hides it from readers who open this sheet. The AI still reads it.</P>
        </>,
      },
      {
        target: 'wb-new-appearance', placement: 'left',
        title: 'How they look, how they act',
        body: <>
          <P><B>Appearance</B> is what someone would notice in the room. <B>Personality</B>, just below, is how they talk and react.</P>
          <P>Write it plainly, in a few sentences. The AI keeps their voice from this.</P>
        </>,
      },
      {
        target: 'wb-new-lore', placement: 'left',
        title: 'Their story so far',
        body: <>
          <P><B>Lore</B> is where they come from and what they carry with them.</P>
          <P>Wrap a secret <Code>||like this||</Code> or select it and press Hide selected text. It stays closed on the sheet until clicked, and the narrator still knows it.</P>
        </>,
      },
      {
        target: 'wb-new-footer', placement: 'top', hint: 'Click Create character',
        title: 'Create the character',
        body: <P>Press <B>Create character</B>. Race, inventory, connections and knowledge open once the sheet exists.</P>,
        advanceWhen: h => h.seen && h.exists('wb-sheet-head') && !h.exists('wb-new-head'),
        onNext: h => h.click('wb-create-entity'),
      },
      {
        target: ['wb-add-portrait', 'wb-sheet-actions'], placement: 'left', hint: 'Open the menu',
        title: 'Give them a face',
        body: <>
          <P>Open the <B>⋯</B> menu by the name and choose <B>Add portrait</B>. Hovering the round icon beside the name does the same.</P>
          <P>The portrait also shows beside them in roleplay.</P>
        </>,
        missing: 'Create the character first: the portrait opens once the sheet exists.',
        advanceWhen: h => h.exists('wb-image-dialog'),
        onNext: h => { if (!h.exists('wb-add-portrait')) h.click('wb-sheet-actions'); later(() => h.click('wb-add-portrait')); },
      },
      {
        target: 'wb-image-dialog', placement: 'right', hint: 'Save or cancel to go on', nextLabel: 'Skip the portrait',
        title: 'Choose and frame the picture',
        body: <>
          <P><B>Choose an image</B> from your computer (PNG, JPEG, WebP or GIF).</P>
          <P>Drag to frame the face and use the slider to zoom. The same crop is used everywhere. Then <B>Save portrait</B>.</P>
        </>,
        advanceWhen: h => h.seen && !h.exists('wb-image-dialog'),
        onNext: h => h.click('wb-image-cancel'),
      },
      {
        target: 'wb-sheet-body', placement: 'left', width: '22.5rem',
        title: 'Where they belong',
        body: <List>
          <li><B>Factions</B>: groups they are part of.</li>
          <li><B>Local to</B>: where they come from. They know what the locals there know.</li>
          <li><B>Relationships</B>: who they know, and how close they are.</li>
        </List>,
        onEnter: h => h.click('wb-tab-connections'),
      },
      {
        target: 'wb-sheet-body', placement: 'left', width: '25rem',
        title: 'What they carry and what they know',
        body: <>
          <P><B>Inventory</B> holds what they carry. <B>Knowledge</B> lists who and what they know about, including secrets.</P>
          <P>You can leave both empty. As you play, the AI suggests additions and you accept or reject each one.</P>
        </>,
        onEnter: h => h.click('wb-tab-knowledge'),
      },
      sheet?.dataset.entityId && sheet.dataset.entityType === 'Characters' ? {
        width: '26.25rem', back: false, nextLabel: `Play as ${short}`, skipLabel: 'Keep editing',
        title: `${short} is ready`,
        body: <>
          <P>You can change anything on this sheet later.</P>
          <P><B>Play as {short}</B> makes them your character and opens the scene at the Last Lantern.</P>
        </>,
        onNext: h => beginStory(h.app, context.workspaceId, sheet.dataset.entityId),
      } : {
        width: '26.25rem', nextLabel: 'Close the guide',
        title: 'Create your character first',
        body: <P>The story starts once their sheet exists. Press Create, choose Character and fill in the sheet, then choose them in the Workspace tab.</P>,
      },
    ];
  },
};

const worldbuild = {
  where: 'Worldbuild',
  skipLabel: 'Skip tour',
  onEnd: ({ app }) => app.dismissHint('worldbuildTourSeen'),
  steps: () => [
    {
      width: '26.25rem', nextLabel: 'Show me around',
      title: 'This is your world',
      body: <>
        <P>Worldbuild keeps the people, places, factions and items of your story, and the rules that hold them together. The AI looks things up here while it writes.</P>
        <P>A quick look around takes about a minute.</P>
      </>,
    },
    {
      target: 'wb-list', placement: 'right',
      title: 'Everything, in one list',
      body: <P>Every sheet in the world, grouped by type. The row of icons above filters the list to one type.</P>,
    },
    {
      target: 'wb-search-create', placement: 'right',
      title: 'Find it, or make it',
      body: <P><B>Search</B> finds a sheet by any of its names (Ctrl K). <B>Create</B> starts a new one.</P>,
    },
    {
      target: 'wb-world-tools', placement: 'right',
      title: 'Rules for the whole world',
      body: <List>
        <li><B>Calendar</B>: months, eras and the story day.</li>
        <li><B>Facts</B>: what is true in this world, whoever believes otherwise.</li>
        <li><B>Rules</B>: skills, levels and other mechanics.</li>
        <li><B>Entity types</B>: the fields each kind of sheet has.</li>
      </List>,
    },
    {
      target: 'wb-review', placement: 'bottom',
      title: 'Suggestions wait here',
      body: <P>As the story moves, the AI proposes new sheets and changes to existing ones. They land in <B>Waiting for review</B> until you accept or reject them.</P>,
      missing: 'It is on the world overview, shown when no sheet is open.',
    },
    {
      target: 'wb-update', placement: 'bottom',
      title: 'Catch up with the story',
      body: <P><B>Update entities</B> reads the latest chapters or messages again and suggests what changed. Locked sheets are skipped.</P>,
    },
    {
      target: 'wb-sheet-head', placement: 'left',
      title: 'Inside a sheet',
      body: <List>
        <li><B>Data</B>: who they are, their skills and story.</li>
        <li><B>Inventory</B>: what they carry.</li>
        <li><B>Connections</B>: factions, places and relationships.</li>
        <li><B>Knowledge</B>: what they know, and what they only believe.</li>
      </List>,
      missing: 'Open any sheet from the list to see inside it.',
    },
    {
      target: 'wb-policy', placement: 'left',
      title: 'How far the AI may go',
      body: <>
        <P>Each sheet sets what the AI may do with it: <B>Open</B> writes changes straight in, <B>Review</B> asks you first, <B>Locked</B> never changes it.</P>
        <P>Review is the default.</P>
      </>,
      missing: 'Open any sheet from the list: the control sits beside its name.',
    },
    {
      width: '25rem', nextLabel: 'Done', back: false,
      title: "That's the tour",
      body: <P>Open any sheet to read or edit it. You can take this tour again from the <B>⋯</B> menu at the top of Worldbuild.</P>,
    },
  ],
};

export const TOURS = { setup, 'own-character': ownCharacter, worldbuild };
