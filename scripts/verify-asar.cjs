const fs = require("node:fs");
const path = require("node:path");

const { collectFiles } = require("./build-manifest.cjs");
const asar = require("@electron/asar");

function normalizeArchiveEntry(entry) {
  return entry.replace(/\\/g, "/").replace(/^\/+/, "");
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) {
      continue;
    }
    const key = argv[index].slice(2);
    options[key] = argv[index + 1]?.startsWith("--") ? true : (argv[index + 1] || true);
    if (options[key] !== true) {
      index += 1;
    }
  }
  return options;
}

function verifyAsar({ asarPath, root = process.cwd() } = {}) {
  if (typeof asarPath !== "string" || !asarPath) {
    throw new TypeError("ASAR path is required");
  }
  const projectRoot = path.resolve(root);
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const archivePath = path.resolve(projectRoot, asarPath);
  const archiveEntries = new Set(asar.listPackage(archivePath).map(normalizeArchiveEntry));
  const requiredEntries = [...new Set((packageJson.build?.files || []).flatMap((entry) => (
    collectFiles(projectRoot, entry).map((filePath) => path.relative(projectRoot, filePath).split(path.sep).join("/"))
  )))];
  const missing = requiredEntries.filter((entry) => !archiveEntries.has(entry));

  return {
    valid: missing.length === 0,
    archivePath,
    fileCount: archiveEntries.size,
    requiredCount: requiredEntries.length,
    missing
  };
}

function resourceEntryFromTo(entry) {
  if (typeof entry === "string") {
    return { from: entry, to: path.basename(entry) };
  }
  if (entry && typeof entry === "object" && typeof entry.from === "string") {
    return { from: entry.from, to: typeof entry.to === "string" ? entry.to : path.basename(entry.from) };
  }
  return null;
}

function verifyExtraResources({ root = process.cwd(), resourcesDir = null } = {}) {
  const projectRoot = path.resolve(root);
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const entries = (packageJson.build?.extraResources || []).map(resourceEntryFromTo).filter(Boolean);
  const missing = [];

  for (const { from, to } of entries) {
    const sourcePath = path.join(projectRoot, from);
    if (!fs.existsSync(sourcePath)) {
      missing.push(from);
      continue;
    }

    if (resourcesDir) {
      const packagedPath = path.join(path.resolve(resourcesDir), to);
      if (!fs.existsSync(packagedPath)) {
        missing.push(to);
      }
    }
  }

  return { valid: missing.length === 0, missing, entries };
}

if (require.main === module) {
  const options = parseArguments(process.argv.slice(2));
  const result = verifyAsar({
    asarPath: options.asar,
    root: options.root || process.cwd()
  });
  const extraResourcesResult = verifyExtraResources({
    root: options.root || process.cwd(),
    resourcesDir: typeof options.resources === "string" ? options.resources : null
  });
  console.log(JSON.stringify({ ...result, extraResources: extraResourcesResult }, null, 2));
  if (!result.valid || !extraResourcesResult.valid) {
    process.exitCode = 1;
  }
}

module.exports = { verifyAsar, verifyExtraResources };
