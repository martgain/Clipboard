const MAX_RETENTION_DAYS = 3650;

class RetentionService {
  constructor({ maxDays = MAX_RETENTION_DAYS } = {}) {
    this.maxDays = Number.isInteger(maxDays) ? Math.max(1, maxDays) : MAX_RETENTION_DAYS;
  }

  expire(state, now = Date.now()) {
    if (!state || typeof state !== "object" || !Number.isFinite(now)) {
      throw new TypeError("State and time are required for retention");
    }

    const retentionDays = Number.isInteger(state.settings?.retentionDays)
      ? Math.min(Math.max(0, state.settings.retentionDays), this.maxDays)
      : 0;
    const cloneState = () => ({
      ...state,
      settings: { ...(state.settings || {}) },
      pinned: Array.isArray(state.pinned) ? [...state.pinned] : [],
      normal: Array.isArray(state.normal) ? [...state.normal] : [],
      linkGroups: Array.isArray(state.linkGroups) ? [...state.linkGroups] : []
    });

    if (retentionDays === 0) {
      return { state: cloneState(), removed: [] };
    }

    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    const removed = [];
    const nextState = cloneState();
    nextState.normal = nextState.normal.filter((entry) => {
      const expired = entry && typeof entry.updatedAt === "number" && entry.updatedAt < cutoff;
      if (expired) {
        removed.push(entry);
      }
      return !expired;
    });

    return { state: nextState, removed };
  }
}

module.exports = { RetentionService, MAX_RETENTION_DAYS };
