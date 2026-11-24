// An equipment-only change that restates the item's current state is not a change.
function isUnchangedEquipment(patch, currentInventoryState) {
    if (!patch?.holderId || typeof patch.equipped !== 'boolean') return false;
    if (patch.fromHolderId || patch.toHolderId || patch.fromLocationId || patch.locationId) return false;
    const held = (currentInventoryState || []).filter(item =>
        item.itemId === patch.itemId && item.holderId === patch.holderId
    );
    return held.length > 0 && held.some(item => Boolean(item.equipped) === patch.equipped);
}

module.exports = { isUnchangedEquipment };
