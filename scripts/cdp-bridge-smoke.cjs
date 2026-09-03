const assert = require("node:assert/strict");

const websocketUrl = process.argv[2];

if (!websocketUrl) {
  throw new TypeError("A CDP websocket URL is required");
}

const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const socket = new WebSocket(websocketUrl);
let nextId = 1;
const pendingCommands = new Map();

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const resolveCommand = pendingCommands.get(message.id);

  if (!resolveCommand) {
    return;
  }

  pendingCommands.delete(message.id);
  resolveCommand(message);
};

function sendCdpCommand(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pendingCommands.set(id, (message) => {
      if (message.error) {
        reject(new Error(message.error.message));
        return;
      }

      resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const evaluation = await sendCdpCommand("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });

  if (evaluation.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.text || "CDP evaluation failed");
  }

  return evaluation.result.value;
}

(async () => {
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  await sendCdpCommand("Runtime.enable");

  const smokeResult = await evaluate(`(async () => {
    const dataUrl = ${JSON.stringify(ONE_PIXEL_PNG)};
    const clipboardText = "bridge clipboard smoke  سطر ثانٍ";
    await window.desktopBridge.writeText(clipboardText);
    const clipboardRead = await window.desktopBridge.readClipboard();
    const stored = await window.desktopBridge.writeLibraryImage("task3-smoke", dataUrl);
    const read = await window.desktopBridge.readLibraryImage(stored.mediaKey);
    const library = {
      schemaVersion: 2,
      settings: {
        theme: "dark",
        duplicatePolicy: "dedupe-move-to-top",
        normalLimit: 150,
        autoCapture: true,
        batchSeparator: "<<<CLIPBOARD-ITEM>>>",
        globalShortcutEnabled: false,
        searchQuery: "",
        privacyMode: false,
        retentionDays: 0
      },
      pinned: [],
      normal: [
        { id: "task4-text", type: "text", text: "Task 4 smoke", tags: [], createdAt: 1, updatedAt: 1 },
        {
          id: "task4-image",
          type: "image",
          image: {
            blobKey: stored.mediaKey,
            mimeType: stored.mimeType,
            size: stored.size,
            hash: stored.sha256
          },
          tags: [],
          createdAt: 2,
          updatedAt: 2
        }
      ],
      linkGroups: []
    };
    await window.desktopBridge.saveLibrary(library);
    const snapshot = await window.desktopBridge.createLibrarySnapshot(library);
    const snapshots = await window.desktopBridge.listLibrarySnapshots();
    const verification = await window.desktopBridge.verifyLibrarySnapshot(snapshots[0]);
    const restored = await window.desktopBridge.restoreLibrarySnapshot(snapshots[0], "replace");
    const health = await window.desktopBridge.getLibraryHealth(library);
    return {
      bridge: typeof window.desktopBridge,
      clipboardReadMatches: clipboardRead?.kind === "text" && clipboardRead.text === clipboardText,
      mediaKey: stored.mediaKey,
      sha256: stored.sha256,
      readMatches: read === dataUrl,
      snapshotPath: snapshot.path,
      snapshotVerified: verification.valid,
      restoredItems: restored.restoredItems,
      healthBrokenReferences: health.brokenReferences
    };
  })()`);

  assert.equal(smokeResult.bridge, "object");
  assert.equal(smokeResult.clipboardReadMatches, true);
  assert.match(smokeResult.mediaKey, /^[a-f0-9]{64}$/);
  assert.equal(smokeResult.mediaKey, smokeResult.sha256);
  assert.equal(smokeResult.readMatches, true);
  assert.match(smokeResult.snapshotPath, /\.backup$/);
  assert.equal(smokeResult.snapshotVerified, true);
  assert.equal(smokeResult.restoredItems, 2);
  assert.equal(smokeResult.healthBrokenReferences, 0);
  console.log(JSON.stringify(smokeResult));
  socket.close();
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
