const STRUCTURED_FAILURE_LIMIT = 3;

function shouldStopEntityUpdates(consecutiveStructuredFailures) {
  return consecutiveStructuredFailures >= STRUCTURED_FAILURE_LIMIT;
}

module.exports = { STRUCTURED_FAILURE_LIMIT, shouldStopEntityUpdates };
