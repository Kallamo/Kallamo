const $ = id => document.getElementById(id);
const megabytes = bytes => Math.max(1, Math.round(bytes / 1e6));

function render(state) {
  const stage = state?.stage || 'opening';
  const updating = stage === 'updating';
  const percent = Math.max(0, Math.min(100, Math.round(state?.percent || 0)));

  $('status').textContent = {
    checking: 'Checking for updates',
    updating: state?.version ? `Updating to ${state.version}` : 'Updating',
    restarting: 'Restarting to finish the update',
    migrating: 'Updating your data',
    opening: 'Opening your workspaces',
  }[stage] || 'Opening your workspaces';

  const showTrack = updating || stage === 'restarting' || stage === 'migrating';
  $('track').hidden = !showTrack;
  $('track').classList.toggle('busy', stage === 'migrating');
  $('fill').style.width = stage === 'restarting' ? '100%' : stage === 'migrating' ? '' : `${percent}%`;

  $('detail').hidden = !(updating && state?.total);
  if (updating && state?.total) {
    $('detail-left').textContent = `${megabytes(state.transferred || 0)} of ${megabytes(state.total)} MB`;
    $('detail-right').textContent = `${percent}%`;
  }

  const caption = { restarting: 'Kallamo opens again in a moment.', migrating: 'This happens once after an update.' }[stage];
  $('caption').hidden = !caption;
  $('caption').textContent = caption || '';
  $('later').hidden = !updating;
}

render({ stage: 'opening' });
window.splash.onStatus(render);
$('later').addEventListener('click', () => {
  $('later').disabled = true;
  window.splash.skipUpdate();
});
