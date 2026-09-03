const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { replaceFile: replaceFileSafe } = require("./replace-safe.cjs");

const TRANSACTION_VERSION = 1;
const GENERATION_PATTERN = /^gen-\d{13}-[a-f0-9]{12}$/;

function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function asBuffer(contents) {
  if (Buffer.isBuffer(contents)) {
    return contents;
  }

  if (typeof contents === "string") {
    return Buffer.from(contents, "utf8");
  }

  throw new TypeError("Serialized transaction state must be text or bytes");
}

function flushFile(filePath) {
  const fileHandle = fs.openSync(filePath, "r+");

  try {
    fs.fsyncSync(fileHandle);
  } finally {
    fs.closeSync(fileHandle);
  }
}

function flushDirectory(directoryPath) {
  let directoryHandle;

  try {
    directoryHandle = fs.openSync(directoryPath, "r");
    fs.fsyncSync(directoryHandle);
  } catch (error) {
    if (!["EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(error.code)) {
      throw error;
    }
  } finally {
    if (directoryHandle !== undefined) {
      fs.closeSync(directoryHandle);
    }
  }
}

function writeAtomicText(targetPath, contents) {
  const temporaryPath = targetPath + ".tmp-" + process.pid + "-" + Date.now();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
    flushFile(temporaryPath);
    replaceFileSafe(temporaryPath, targetPath);
    flushDirectory(path.dirname(targetPath));
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function createGenerationName() {
  return "gen-" + String(Date.now()).padStart(13, "0") + "-" + crypto.randomBytes(6).toString("hex");
}

function createManifest(generation, serializedState) {
  return {
    version: TRANSACTION_VERSION,
    generation,
    stateFile: "state.json",
    stateHash: hashBytes(serializedState),
    stateSize: serializedState.length,
    createdAt: new Date().toISOString()
  };
}

function assertManifest(manifest, manifestText, generation, expectedManifestHash) {
  const manifestHash = hashBytes(Buffer.from(manifestText, "utf8"));

  if (manifest.version !== TRANSACTION_VERSION
    || manifest.generation !== generation
    || manifest.stateFile !== "state.json"
    || (expectedManifestHash !== null && manifestHash !== expectedManifestHash)) {
    throw new TypeError("Transaction manifest is invalid");
  }

  return manifestHash;
}

function assertStateIntegrity(stateBytes, manifest) {
  if (stateBytes.length !== manifest.stateSize || hashBytes(stateBytes) !== manifest.stateHash) {
    throw new TypeError("Transaction state integrity check failed");
  }
}

function diagnostic(code, severity, message, extra = {}) {
  return { code, severity, message, ...extra };
}

class TransactionStore {
  constructor({
    rootDirectory,
    serializeState = (state) => JSON.stringify(state),
    deserializeState = (contents) => JSON.parse(contents),
    validateState = () => {},
    failureInjector = null
  } = {}) {
    if (typeof rootDirectory !== "string" || rootDirectory.trim().length === 0) {
      throw new TypeError("Transaction root directory is required");
    }

    if (typeof serializeState !== "function" || typeof deserializeState !== "function" || typeof validateState !== "function") {
      throw new TypeError("Transaction serializers and validator must be functions");
    }

    if (failureInjector !== null && typeof failureInjector !== "function") {
      throw new TypeError("Transaction failure injector must be a function");
    }

    this.rootDirectory = path.resolve(rootDirectory);
    this.generationsDirectory = path.join(this.rootDirectory, "generations");
    this.currentPath = path.join(this.rootDirectory, "current.json");
    this.pendingPath = path.join(this.rootDirectory, "pending.json");
    this.serializeState = serializeState;
    this.deserializeState = deserializeState;
    this.validateState = validateState;
    this.failureInjector = failureInjector;
  }

  invokeFailureInjector(point, context) {
    if (this.failureInjector) {
      this.failureInjector(point, context);
    }
  }

  stageState(state) {
    const serializedState = asBuffer(this.serializeState(state));
    const generation = createGenerationName();
    const generationDirectory = this.generationPath(generation);
    const statePath = path.join(generationDirectory, "state.json");
    const manifestPath = path.join(generationDirectory, "manifest.json");

    fs.mkdirSync(generationDirectory, { recursive: true });
    writeAtomicText(statePath, serializedState.toString("utf8"));

    const manifestText = JSON.stringify(createManifest(generation, serializedState), null, 2);
    writeAtomicText(manifestPath, manifestText);
    return { generation, generationDirectory, serializedState, manifestText };
  }

  writePendingTransaction(generation, manifestHash) {
    writeAtomicText(this.pendingPath, JSON.stringify({
      version: TRANSACTION_VERSION,
      generation,
      manifestHash
    }, null, 2));
  }

  generationPath(generation) {
    if (typeof generation !== "string" || !GENERATION_PATTERN.test(generation)) {
      throw new TypeError("Transaction generation is invalid");
    }

    const root = path.resolve(this.generationsDirectory);
    const target = path.resolve(root, generation);
    const relative = path.relative(root, target);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new TypeError("Transaction generation escapes its directory");
    }

    return target;
  }

  commitSync(state) {
    this.validateState(state);
    const staged = this.stageState(state);
    const { generation, generationDirectory, manifestText } = staged;
    this.invokeFailureInjector("after-stage", { generation, generationDirectory });

    const manifestHash = hashBytes(Buffer.from(manifestText, "utf8"));
    this.writePendingTransaction(generation, manifestHash);
    this.invokeFailureInjector("after-journal", { generation, generationDirectory, manifestHash });

    this.promote(generation, manifestHash);
    this.invokeFailureInjector("after-promote", { generation, generationDirectory, manifestHash });
    fs.rmSync(this.pendingPath, { force: true });
    flushDirectory(this.rootDirectory);

    return { generation, manifestHash };
  }

  async commit(state) {
    return this.commitSync(state);
  }

  promote(generation, manifestHash) {
    writeAtomicText(this.currentPath, JSON.stringify({
      version: TRANSACTION_VERSION,
      generation,
      manifestHash
    }, null, 2));
  }

  readPointer() {
    return JSON.parse(fs.readFileSync(this.currentPath, "utf8"));
  }

  readGeneration(generation, expectedManifestHash = null) {
    const generationDirectory = this.generationPath(generation);
    const manifestPath = path.join(generationDirectory, "manifest.json");
    const manifestText = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(manifestText);
    const manifestHash = assertManifest(manifest, manifestText, generation, expectedManifestHash);

    const statePath = path.join(generationDirectory, manifest.stateFile);
    const stateBytes = fs.readFileSync(statePath);
    assertStateIntegrity(stateBytes, manifest);

    const state = this.deserializeState(stateBytes.toString("utf8"));
    this.validateState(state);
    return { state, generation, manifestHash };
  }

  recoverSync() {
    if (!fs.existsSync(this.pendingPath)) {
      return { recovered: false, diagnostics: [] };
    }

    try {
      const pending = JSON.parse(fs.readFileSync(this.pendingPath, "utf8"));
      const candidate = this.readGeneration(pending.generation, pending.manifestHash);
      this.promote(candidate.generation, candidate.manifestHash);
      fs.rmSync(this.pendingPath, { force: true });
      return {
        recovered: true,
        generation: candidate.generation,
        diagnostics: [diagnostic("TRANSACTION_RECOVERED", "info", "Recovered a pending transaction generation.")]
      };
    } catch (error) {
      const recoveryPath = this.pendingPath + ".recovery-" + Date.now();
      try {
        fs.renameSync(this.pendingPath, recoveryPath);
      } catch {
        fs.rmSync(this.pendingPath, { force: true });
      }
      return {
        recovered: false,
        diagnostics: [diagnostic("TRANSACTION_PENDING_INVALID", "warning", "Ignored an invalid pending transaction journal.", { path: recoveryPath })]
      };
    }
  }

  async recover() {
    return this.recoverSync();
  }

  generationNames() {
    if (!fs.existsSync(this.generationsDirectory)) {
      return [];
    }

    return fs.readdirSync(this.generationsDirectory)
      .filter((name) => GENERATION_PATTERN.test(name))
      .sort()
      .reverse();
  }

  readCurrentGeneration(diagnostics) {
    if (!fs.existsSync(this.currentPath)) {
      return null;
    }

    try {
      const currentPointer = this.readPointer();
      const currentGeneration = this.readGeneration(currentPointer.generation, currentPointer.manifestHash);
      return { pointer: currentPointer, loaded: currentGeneration };
    } catch {
      diagnostics.push(diagnostic("TRANSACTION_CURRENT_INVALID", "warning", "Current transaction pointer or generation is invalid."));
      return null;
    }
  }

  readFallbackGeneration(currentPointer, diagnostics) {
    for (const generation of this.generationNames()) {
      try {
        const candidate = this.readGeneration(generation);
        if (!currentPointer || currentPointer.generation !== candidate.generation) {
          this.promote(candidate.generation, candidate.manifestHash);
        }
        return candidate;
      } catch {
        diagnostics.push(diagnostic("TRANSACTION_GENERATION_INVALID", "warning", "Skipped an invalid transaction generation.", {
          path: this.generationPath(generation)
        }));
      }
    }

    return null;
  }

  loadSync() {
    const recovery = this.recoverSync();
    const diagnostics = [...recovery.diagnostics];
    const current = this.readCurrentGeneration(diagnostics);

    if (current) {
      return { state: current.loaded.state, generation: current.loaded.generation, diagnostics };
    }

    const fallback = this.readFallbackGeneration(current?.pointer, diagnostics);
    if (fallback) {
      return { state: fallback.state, generation: fallback.generation, diagnostics };
    }

    throw new Error("No valid transaction generation is available");
  }

  async load() {
    return this.loadSync();
  }
}

module.exports = { GENERATION_PATTERN, TransactionStore };
