import { describeSkillChange } from '../roleplay/changeKinds';
import { fieldLabel, meta } from './worldbuildConfig';

const PART_LABELS = { canonicalName: 'Name', aliases: 'Other names', lore: 'Lore' };

const humanize = key => {
  const words = String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const partLabel = part => {
  if (PART_LABELS[part]) return PART_LABELS[part];
  if (part.startsWith('customFields.')) return humanize(part.slice('customFields.'.length));
  const label = fieldLabel(part);
  return label === part ? humanize(part) : label;
};

// "Description", "Description and Age", "Description, Age and 2 more".
const joinParts = labels => {
  if (labels.length <= 1) return labels[0] || '';
  if (labels.length <= 3) return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `${labels.slice(0, 2).join(', ')} and ${labels.length - 2} more`;
};

function describeInventory(patch, nameOf, item) {
  const name = nameOf(patch.itemId) || 'Item';
  const count = Number(patch.quantity) > 1 ? `${patch.quantity} × ` : '';
  const moves = patch.toHolderId || patch.locationId || patch.fromHolderId || patch.fromLocationId;
  if (!moves && patch.equipped !== undefined) {
    return { label: patch.equipped ? 'Equipped' : 'Unequipped', text: `${name} ${patch.equipped ? 'equipped' : 'unequipped'} by ${nameOf(patch.holderId) || 'a character'}.` };
  }
  const from = nameOf(patch.fromHolderId || patch.fromLocationId);
  const fromText = from ? ` from ${from}` : '';
  if (patch.toHolderId) {
    const to = nameOf(patch.toHolderId) || 'a character';
    if (patch.fromLocationId) return { label: 'Picked up', text: `${count}${name} moved${fromText} to ${to}.` };
    if (patch.fromHolderId) return { label: 'Handed over', text: `${count}${name} moved${fromText} to ${to}.` };
    return { label: 'Received', text: `${count}${name} given to ${to}.` };
  }
  if (patch.locationId) {
    return { label: patch.fromLocationId ? 'Moved' : 'Dropped', text: `${count}${name} moved${fromText} to ${nameOf(patch.locationId) || 'a location'}.` };
  }
  // Nothing records why an item left without a destination; a consumable is the one safe guess.
  const consumable = item?.data?.itemType === 'Consumable';
  return { label: consumable ? 'Used up' : 'Lost', text: `${count}${name} removed from ${from || 'its holder'}.` };
}

function describeProgress(detail, who) {
  if (detail.progressKind === 'xp') return `${who}: XP ${detail.delta > 0 ? '+' : '−'}${Math.abs(detail.delta)}`;
  if (detail.progressKind === 'level') return `${who} reached level ${detail.nextValue}`;
  return `${who}: ${detail.traitName || 'Attribute'} ${detail.previousValue} → ${detail.nextValue}`;
}

function describeEntity(detail, nameOf, entityId) {
  const identity = detail.identityUpdate;
  if (identity?.canonicalName) return { label: 'Renamed', text: `Name: ${identity.previousCanonicalName} → ${identity.canonicalName}.` };
  if (identity) return { label: 'New alias', text: `Aliases added to ${identity.previousCanonicalName || nameOf(entityId)}: ${(identity.aliases || []).join(', ')}.` };
  const type = meta(detail.type).label;
  return { label: `New ${type.toLowerCase()}`, text: `${type} created: ${detail.name || nameOf(entityId)}` };
}

/**
 * The overview's rows: { key, entity, kind, label, text, source, sourceLabel, pending, createdAt }.
 * Rows for entities that are gone, and matches that changed nothing, are left out.
 */
export function describeWorldChanges(changes, entities) {
  const byId = new Map(entities.map(entity => [entity.id, entity]));
  const nameOf = id => (id ? byId.get(id)?.canonicalName : null);
  return changes.flatMap(change => {
    const entity = byId.get(change.entityId);
    if (!entity || entity.status === 'proposed') return [];
    if (change.kind === 'entity' && change.status === 'applied' && !change.detail.createdEntity && !change.detail.identityUpdate) return [];
    let described;
    if (change.kind === 'inventory') described = describeInventory(change.detail.patch || {}, nameOf, entity);
    else if (change.kind === 'skill') described = { label: 'Skill', text: describeSkillChange(change.detail, entity.canonicalName) };
    else if (change.kind === 'progress') described = { label: 'Progress', text: describeProgress(change.detail, entity.canonicalName) };
    else if (change.kind === 'entity') described = describeEntity(change.detail, nameOf, change.entityId);
    else {
      const labels = (change.detail.parts || []).map(partLabel);
      const links = Number(change.detail.links) || 0;
      if (links) labels.push(`${links} ${links === 1 ? 'connection' : 'connections'}`);
      if (!labels.length) return [];
      described = change.kind === 'edit'
        ? { label: 'Edited', text: `${joinParts(labels)} edited.` }
        : { label: 'Updated', text: `${joinParts(labels)} updated.` };
    }
    const sourceLabel = change.source === 'you' ? 'You' : change.source === 'ai' ? 'Update entities' : change.turnNumber ? `Turn ${change.turnNumber}` : 'Story';
    return [{ key: `${change.kind}:${change.id}`, entity, kind: change.kind, ...described, source: change.source, sourceLabel, pending: change.status === 'pending', createdAt: change.createdAt }];
  });
}
