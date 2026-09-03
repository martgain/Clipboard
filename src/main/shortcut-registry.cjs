"use strict";

const { normalizeGlobalShortcut } = require("../shared/contracts.cjs");

const DEFAULT_SHORTCUTS = Object.freeze({
  toggleVisibility: "CommandOrControl+Shift+Space"
});
const DEFAULT_SHORTCUT = DEFAULT_SHORTCUTS.toggleVisibility;

const MODIFIER_ORDER = new Map([
  ["ctrl", 0],
  ["alt", 1],
  ["shift", 2],
  ["super", 3]
]);

const SHORTCUT_ALIASES = new Map([
  ["control", "ctrl"],
  ["commandorcontrol", "ctrl"],
  ["command", "super"],
  ["cmd", "super"],
  ["option", "alt"]
]);

function cloneMapping(mapping) {
  return Object.freeze(Object.fromEntries(Object.entries(mapping)));
}

function normalizeShortcut(shortcut) {
  return normalizeGlobalShortcut(shortcut);
}

function canonicalShortcut(shortcut) {
  const parts = normalizeShortcut(shortcut)
    .split("+")
    .map((part) => part.toLocaleLowerCase());
  const normalizedParts = parts.map((part) => SHORTCUT_ALIASES.get(part) || part);
  const modifiers = normalizedParts
    .filter((part) => MODIFIER_ORDER.has(part))
    .sort((left, right) => MODIFIER_ORDER.get(left) - MODIFIER_ORDER.get(right));
  const keys = normalizedParts.filter((part) => !MODIFIER_ORDER.has(part));

  return [...modifiers, ...keys].join("+");
}

function isMapping(candidateMapping) {
  return candidateMapping !== null && typeof candidateMapping === "object" && !Array.isArray(candidateMapping);
}

function normalizeDefaults(defaults) {
  if (!isMapping(defaults)) {
    throw new TypeError("Shortcut defaults must be an object");
  }

  const normalized = {};
  Object.entries(defaults).forEach(([action, shortcut]) => {
    const normalizedShortcut = normalizeShortcut(shortcut);
    if (action && normalizedShortcut) {
      normalized[action] = normalizedShortcut;
    }
  });

  return cloneMapping(normalized);
}

function normalizeRequestedMapping(mapping) {
  if (!isMapping(mapping)) {
    throw new TypeError("Shortcut mapping must be an object");
  }

  return Object.entries(mapping).flatMap(([action, shortcut]) => {
    const normalized = normalizeShortcut(shortcut);
    return action && normalized ? [[action, normalized]] : [];
  });
}

function createConflictReport(entries) {
  const grouped = new Map();

  entries.forEach(([action, shortcut]) => {
    const key = canonicalShortcut(shortcut);
    const group = grouped.get(key) || { shortcut, owners: [] };
    group.owners.push(action);
    grouped.set(key, group);
  });

  return formatConflictGroups(grouped);
}

function formatConflictGroups(groupedShortcuts) {
  const conflicts = [];
  const conflictedActions = new Set();
  groupedShortcuts.forEach((shortcutGroup) => {
    if (shortcutGroup.owners.length < 2) {
      return;
    }
    conflicts.push({
      shortcut: shortcutGroup.shortcut,
      owners: [...shortcutGroup.owners]
    });
    shortcutGroup.owners.forEach((action) => conflictedActions.add(action));
  });
  return { conflicts, conflictedActions };
}

function unregisterSafely(unregisterShortcut, registeredShortcut) {
  try {
    unregisterShortcut(registeredShortcut);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
  }
}

function registerSafely(registerShortcut, shortcut, action) {
  try {
    return registerShortcut(shortcut, action) !== false;
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return false;
  }
}

class ShortcutRegistry {
  constructor(options, registerShortcut, unregisterShortcut) {
    const suppliedOptions = options === undefined ? { defaults: DEFAULT_SHORTCUTS } : options;
    const hasOptionsShape = isMapping(suppliedOptions)
      && (Object.hasOwn(suppliedOptions, "defaults")
        || Object.hasOwn(suppliedOptions, "register")
        || Object.hasOwn(suppliedOptions, "unregister"));
    const config = hasOptionsShape
      ? suppliedOptions
      : {
          defaults: suppliedOptions,
          register: registerShortcut,
          unregister: unregisterShortcut
        };

    this.defaults = normalizeDefaults(config.defaults === undefined ? DEFAULT_SHORTCUTS : config.defaults);
    this.registerShortcut = typeof config.register === "function" ? config.register : () => true;
    this.unregisterShortcut = typeof config.unregister === "function" ? config.unregister : () => true;
    this.mapping = {};
    this.registered = new Map();
  }

  apply(mapping) {
    const requestedEntries = normalizeRequestedMapping(mapping);
    const { conflicts, conflictedActions } = createConflictReport(requestedEntries);
    const desiredEntries = requestedEntries.filter(([action]) => !conflictedActions.has(action));

    const { applied, unavailable } = this.registerDesiredShortcuts(desiredEntries);
    const desiredActions = new Set(desiredEntries.map(([action]) => action));
    this.registered.forEach((registeredShortcut, action) => {
      if (!desiredActions.has(action)) {
        unregisterSafely(this.unregisterShortcut, registeredShortcut);
        this.registered.delete(action);
      }
    });

    this.mapping = { ...applied };
    return createApplicationReport(applied, conflicts, unavailable);
  }

  registerDesiredShortcuts(desiredEntries) {
    const applied = {};
    const unavailable = [];
    desiredEntries.forEach(([action, shortcut]) => {
      const currentShortcut = this.registered.get(action);
      if (currentShortcut === shortcut) {
        applied[action] = shortcut;
        return;
      }
      if (registerSafely(this.registerShortcut, shortcut, action)) {
        if (currentShortcut) {
          unregisterSafely(this.unregisterShortcut, currentShortcut);
        }
        applied[action] = shortcut;
        this.registered.set(action, shortcut);
      } else {
        unavailable.push({ action, shortcut });
        if (currentShortcut) {
          applied[action] = currentShortcut;
        }
      }
    });
    return { applied, unavailable };
  }

  restoreDefaults() {
    return this.apply(this.defaults);
  }

  restoreDefault() {
    return this.restoreDefaults();
  }

  reset() {
    return this.restoreDefaults();
  }

  getDefaults() {
    return cloneMapping(this.defaults);
  }

  getMapping() {
    return cloneMapping(this.mapping);
  }
}

function createApplicationReport(applied, conflicts, unavailable) {
  const applicationReport = {
    applied: cloneMapping(applied),
    conflicts
  };
  if (unavailable.length > 0) {
    applicationReport.unavailable = unavailable.map((unavailableShortcut) => Object.freeze({ ...unavailableShortcut }));
  }
  return Object.freeze(applicationReport);
}

function createShortcutRegistry(options) {
  return new ShortcutRegistry(options);
}

module.exports = Object.freeze({
  DEFAULT_SHORTCUT,
  DEFAULT_SHORTCUTS,
  ShortcutRegistry,
  canonicalShortcut,
  createShortcutRegistry,
  normalizeShortcut
});
