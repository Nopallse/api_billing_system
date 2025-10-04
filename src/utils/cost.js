// Utility for consistent cost calculation across endpoints
// category.cost = cost per category.periode (minutes)
// durationSeconds = total duration in seconds
// Returns integer (rounded) cost >= 0
function calculateCost(durationSeconds, category) {
  if (!category || typeof category.cost !== 'number' || typeof category.periode !== 'number') {
    throw new Error('Invalid category data for cost calculation');
  }
  const seconds = Number(durationSeconds);
  if (isNaN(seconds) || seconds < 0) {
    throw new Error('Invalid durationSeconds');
  }
  // Normalize seconds to number of periods (durationSeconds / (periodeMinutes * 60))
  const cost = Math.round(category.cost * (seconds / (category.periode * 60)));
  return cost < 0 ? 0 : cost; // safeguard
}

module.exports = { calculateCost };
