const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildManifest } = require("../scripts/build-manifest.cjs");
const { verifyAsar, verifyExtraResources } = require("../scripts/verify-asar.cjs");
const asar = require("@electron/asar");

test("electron-builder packages every main runtime module imported by the shortcut path", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

  assert.match(mainSource, /require\("\.\/src\/main\/shortcut-registry\.cjs"\)/);
  assert.ok(packageJson.build.files.includes("src/main/shortcut-registry.cjs"));
});

test("build manifest hashes the configured packaging surface", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-manifest-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "app.js"), "console.log('local');", "utf8");
  fs.writeFileSync(path.join(root, "src", "asset.txt"), "asset", "utf8");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "test-app",
    version: "1.0.0",
    build: { files: ["app.js", "src"] }
  }), "utf8");

  try {
    const result = buildManifest({ root, output: "manifest.json" });
    assert.equal(result.manifest.files.length, 2);
    assert.equal(result.manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)), true);
    assert.equal(fs.existsSync(path.join(root, "manifest.json")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ASAR verifier reports a missing archive explicitly", () => {
  assert.throws(() => verifyAsar({ asarPath: "missing.asar", root: process.cwd() }));
});

test("ASAR verifier accepts the leading separators returned by Electron ASAR", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-asar-"));
  const sourceDirectory = path.join(root, "source");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.writeFileSync(path.join(sourceDirectory, "app.js"), "console.log('local');", "utf8");
  fs.writeFileSync(path.join(sourceDirectory, "asset.txt"), "asset", "utf8");
  fs.writeFileSync(path.join(sourceDirectory, "package.json"), JSON.stringify({
    name: "test-app",
    version: "1.0.0",
    build: { files: ["app.js", "asset.txt"] }
  }), "utf8");

  try {
    await asar.createPackage(sourceDirectory, path.join(root, "app.asar"));
    const result = verifyAsar({ asarPath: "../app.asar", root: sourceDirectory });
    assert.equal(result.valid, true);
    assert.equal(result.missing.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("package.json packages the keyboard lock helper as an extraResources entry outside the ASAR archive", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const extraResources = packageJson.build?.extraResources || [];
  const helperResource = extraResources.find((entry) => (
    typeof entry === "object" && entry !== null ? entry.to === "keyboard-locker.ps1" : entry === "keyboard-locker.ps1"
  ));

  assert.ok(helperResource, "package.json must declare keyboard-locker.ps1 as an extraResources entry");
  assert.equal(helperResource.from, "native/windows-bridge/keyboard-locker.ps1");
  assert.ok(!(packageJson.build.files || []).includes(helperResource.from), "the helper must stay outside the ASAR files list");
});

test("the ASAR verifier confirms the keyboard lock helper resource exists on disk and in a packaged resources directory", () => {
  const projectRoot = path.join(__dirname, "..");
  const sourceOnly = verifyExtraResources({ root: projectRoot });
  assert.equal(sourceOnly.valid, true);
  assert.deepEqual(sourceOnly.missing, []);

  const packagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-resources-"));
  try {
    const missingPackaged = verifyExtraResources({ root: projectRoot, resourcesDir: packagedRoot });
    assert.equal(missingPackaged.valid, false);
    assert.ok(missingPackaged.missing.includes("keyboard-locker.ps1"));

    fs.copyFileSync(
      path.join(projectRoot, "native", "windows-bridge", "keyboard-locker.ps1"),
      path.join(packagedRoot, "keyboard-locker.ps1")
    );
    const presentPackaged = verifyExtraResources({ root: projectRoot, resourcesDir: packagedRoot });
    assert.equal(presentPackaged.valid, true);
    assert.deepEqual(presentPackaged.missing, []);
  } finally {
    fs.rmSync(packagedRoot, { recursive: true, force: true });
  }
});

test("the keyboard lock live smoke script defines every required check stage and fails closed", () => {
  const smokePath = path.join(__dirname, "..", "scripts", "keyboard-lock-live-smoke.ps1");
  assert.ok(fs.existsSync(smokePath), "scripts/keyboard-lock-live-smoke.ps1 must exist");

  const source = fs.readFileSync(smokePath, "utf8");
  assert.match(source, /pre-lock/i);
  assert.match(source, /\blocked\b/i);
  assert.match(source, /mouse-unlock/i);
  assert.match(source, /emergency/i);
  assert.match(source, /post-unlock/i);
  assert.match(source, /notepad/i);
  assert.match(source, /exit 1/);
  assert.match(source, /SendInput/);
  assert.match(source, /KEYEVENTF_KEYUP/);
  assert.doesNotMatch(source, /SendKeys/);
  assert.doesNotMatch(source, /BlockInput/);
});
