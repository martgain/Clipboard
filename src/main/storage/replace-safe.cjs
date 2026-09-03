const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPLACE_ERROR_CODES = new Set(["EEXIST", "EPERM", "ENOTEMPTY"]);

function dependencyFileSystem(fsModule) {
  if (!fsModule || typeof fsModule !== "object") {
    throw new TypeError("A filesystem module is required");
  }
  return fsModule;
}

function makeToken({ token, processId = process.pid, now = Date.now } = {}) {
  if (typeof token === "string" && token.length > 0) {
    return token;
  }
  return `${processId}-${now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function flushFile(fsModule, filePath) {
  if (typeof fsModule.openSync !== "function" || typeof fsModule.fsyncSync !== "function") {
    return;
  }

  const handle = fsModule.openSync(filePath, "r+");
  try {
    fsModule.fsyncSync(handle);
  } finally {
    fsModule.closeSync(handle);
  }
}

function flushDirectory(fsModule, directoryPath) {
  if (typeof fsModule.openSync !== "function" || typeof fsModule.fsyncSync !== "function") {
    return;
  }

  let handle;
  try {
    handle = fsModule.openSync(directoryPath, "r");
    fsModule.fsyncSync(handle);
  } catch (error) {
    if (!new Set(["EINVAL", "EISDIR", "ENOTSUP", "EPERM"]).has(error.code)) {
      throw error;
    }
  } finally {
    if (handle !== undefined && typeof fsModule.closeSync === "function") {
      fsModule.closeSync(handle);
    }
  }
}

function replaceFile(sourcePath, targetPath, { fsModule = fs, token } = {}) {
  const fileSystem = dependencyFileSystem(fsModule);

  try {
    fileSystem.renameSync(sourcePath, targetPath);
    return;
  } catch (error) {
    if (!REPLACE_ERROR_CODES.has(error.code)) {
      throw error;
    }
  }

  const previousPath = `${targetPath}.previous-${makeToken({ token })}`;
  let movedPrevious = false;
  let replaced = false;

  try {
    fileSystem.renameSync(targetPath, previousPath);
    movedPrevious = true;
    fileSystem.renameSync(sourcePath, targetPath);
    replaced = true;
  } catch (error) {
    if (movedPrevious) {
      try {
        if (!fileSystem.existsSync(targetPath)) {
          fileSystem.renameSync(previousPath, targetPath);
          movedPrevious = false;
        }
      } catch (restoreError) {
        error.restoreError = restoreError;
      }
    }
    throw error;
  } finally {
    if (replaced && movedPrevious) {
      try {
        fileSystem.rmSync(previousPath, { force: true });
      } catch {
        // Keep the previous copy as a recoverable artifact if cleanup is denied.
      }
    }
  }
}

function writeAtomicTextFile(targetPath, contents, options = {}) {
  if (typeof targetPath !== "string" || targetPath.length === 0) {
    throw new TypeError("Atomic file target is required");
  }
  if (typeof contents !== "string") {
    throw new TypeError("Atomic file contents must be text");
  }

  const fileSystem = dependencyFileSystem(options.fsModule || fs);
  const temporaryPath = `${targetPath}.tmp-${makeToken(options)}`;
  fileSystem.mkdirSync(path.dirname(targetPath), { recursive: true });

  try {
    fileSystem.writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
    flushFile(fileSystem, temporaryPath);
    replaceFile(temporaryPath, targetPath, options);
    flushDirectory(fileSystem, path.dirname(targetPath));
  } finally {
    fileSystem.rmSync(temporaryPath, { force: true });
  }
}

module.exports = Object.freeze({
  REPLACE_ERROR_CODES,
  flushDirectory,
  flushFile,
  replaceFile,
  writeAtomicTextFile
});
