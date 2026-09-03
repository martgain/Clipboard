const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      continue;
    }
    const key = argument.slice(2);
    options[key] = argv[index + 1]?.startsWith("--") ? true : (argv[index + 1] || true);
    if (options[key] !== true) {
      index += 1;
    }
  }
  return options;
}

function assertInside(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError("Manifest path escapes the project root");
  }
}

function collectFiles(root, relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  assertInside(root, absolutePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Manifest file is missing: ${relativePath}`);
  }

  const stats = fs.statSync(absolutePath);
  if (stats.isFile()) {
    return [absolutePath];
  }
  if (!stats.isDirectory()) {
    throw new Error(`Manifest entry is not a file or directory: ${relativePath}`);
  }

  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => (
    collectFiles(root, path.join(relativePath, entry.name))
  ));
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function buildManifest({ root = process.cwd(), output = path.join("audit-output", "build-manifest.json"), artifact = null } = {}) {
  const projectRoot = path.resolve(root);
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const relativeFiles = [...new Set((packageJson.build?.files || []).flatMap((entry) => collectFiles(projectRoot, entry)))]
    .map((filePath) => path.relative(projectRoot, filePath).split(path.sep).join("/"))
    .sort();
  const files = relativeFiles.map((relativePath) => {
    const filePath = path.join(projectRoot, ...relativePath.split("/"));
    const stats = fs.statSync(filePath);
    return { path: relativePath, bytes: stats.size, sha256: hashFile(filePath) };
  });
  const manifest = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    package: { name: packageJson.name, version: packageJson.version },
    files
  };

  if (artifact) {
    const artifactPath = path.resolve(projectRoot, artifact);
    if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
      throw new Error(`Artifact is missing: ${artifact}`);
    }
    manifest.artifact = {
      path: path.relative(projectRoot, artifactPath).split(path.sep).join("/"),
      bytes: fs.statSync(artifactPath).size,
      sha256: hashFile(artifactPath)
    };
  }

  const outputPath = path.resolve(projectRoot, output);
  const outputDirectory = path.dirname(outputPath);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, outputPath);
  return { outputPath, manifest };
}

if (require.main === module) {
  const options = parseArguments(process.argv.slice(2));
  const result = buildManifest({
    root: options.root || process.cwd(),
    output: options.output || path.join("audit-output", "build-manifest.json"),
    artifact: typeof options.artifact === "string" ? options.artifact : null
  });
  console.log(`Build manifest written: ${result.outputPath}`);
}

module.exports = { buildManifest, collectFiles, hashFile };
