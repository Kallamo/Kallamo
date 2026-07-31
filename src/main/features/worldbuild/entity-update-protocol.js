function isEntityUpdateShape(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.data && typeof value.data === 'object' && !Array.isArray(value.data)
    && value.links && typeof value.links === 'object' && !Array.isArray(value.links);
}

function decodeEntityUpdate(value) {
  return { data: value.data || {}, links: value.links || {} };
}

module.exports = { decodeEntityUpdate, isEntityUpdateShape };
