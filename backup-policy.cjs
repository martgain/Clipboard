const BACKUP_NAME_PATTERN = /^library-\d{8}-\d{6}(?:-\d{3})?\.(?:json|md)$/;

function createBackupPlan(names, retention) {
  if (!Array.isArray(names) || !Number.isInteger(retention) || retention < 1) {
    return [];
  }

  return names
    .filter((name) => typeof name === "string" && BACKUP_NAME_PATTERN.test(name))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, retention);
}

module.exports = {
  BACKUP_NAME_PATTERN,
  createBackupPlan
};
