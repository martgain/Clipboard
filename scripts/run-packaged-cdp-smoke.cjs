const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 9225;
const projectRoot = path.resolve(__dirname, "..");
const executablePath = path.join(projectRoot, "dist", "win-unpacked", "Clipboard Shelf.exe");

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForProcess(processHandle) {
  return new Promise((resolve) => processHandle.once("close", resolve));
}

async function waitForCdpEndpoint() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json`);
      if (response.ok) {
        const targets = await response.json();
        const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
        if (pageTarget) return pageTarget.webSocketDebuggerUrl;
      }
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
    }
    await wait(1000);
  }
  throw new Error("Packaged app did not expose a CDP endpoint");
}

async function runSmoke() {
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Packaged executable is missing: ${executablePath}`);
  }

  const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-smoke-"));
  const applicationProcess = spawn(executablePath, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profilePath}`
  ], { stdio: "ignore", windowsHide: true });

  try {
    const websocketUrl = await waitForCdpEndpoint();
    const smokeProcess = spawn(process.execPath, [path.join(__dirname, "cdp-bridge-smoke.cjs"), websocketUrl], {
      stdio: "inherit",
      windowsHide: true
    });
    const exitCode = await Promise.race([
      waitForProcess(smokeProcess),
      wait(60000).then(() => {
        smokeProcess.kill();
        throw new Error("Packaged CDP smoke exceeded 60 seconds");
      })
    ]);
    if (exitCode !== 0) {
      throw new Error(`Packaged CDP smoke failed with exit code ${exitCode}`);
    }
  } finally {
    applicationProcess.kill();
    await wait(1000);
    fs.rmSync(profilePath, { recursive: true, force: true });
  }
}

runSmoke().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
