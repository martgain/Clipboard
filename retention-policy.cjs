const MAX_RETENTION_DAYS = 3650;

function removeExpiredEntries(entries, now, retentionDays) {
  if (!Array.isArray(entries) || !Number.isFinite(now) || !Number.isInteger(retentionDays)
    || retentionDays <= 0) {
    return { kept: Array.isArray(entries) ? [...entries] : [], removed: [] };
  }

  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const kept = [];
  const removed = [];

  entries.forEach((entry) => {
    if (entry && typeof entry.updatedAt === "number" && entry.updatedAt < cutoff) {
      removed.push(entry);
    } else {
      kept.push(entry);
    }
  });

  return { kept, removed };
}

module.exports = {
  MAX_RETENTION_DAYS,
  removeExpiredEntries
};
