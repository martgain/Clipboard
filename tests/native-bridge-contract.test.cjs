const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const nativeRoot = path.join(projectRoot, "native", "windows-bridge");

function readNativeFile(name) {
  return fs.readFileSync(path.join(nativeRoot, name), "utf8");
}

test("Windows clipboard helper is a Win32 JSONL listener with no public pipe or network", () => {
  const cmake = readNativeFile("CMakeLists.txt");
  const mainSource = readNativeFile("main.cpp");
  const listenerSource = readNativeFile("clipboard_listener.cpp");
  const nativeSource = [cmake, mainSource, listenerSource].join("\n");

  assert.match(cmake, /add_executable\s*\(\s*clipboard-listener/i);
  assert.match(cmake, /user32/i);
  assert.match(mainSource, /runClipboardListener/);
  assert.match(listenerSource, /AddClipboardFormatListener/);
  assert.match(listenerSource, /WM_CLIPBOARDUPDATE/);
  assert.match(listenerSource, /HWND_MESSAGE/);
  assert.match(listenerSource, /GetWindowThreadProcessId/);
  assert.match(listenerSource, /formats/);
  assert.match(listenerSource, /sequence/);
  assert.match(listenerSource, /std::cout/);
  assert.doesNotMatch(nativeSource, /CreateNamedPipe|ConnectNamedPipe|socket\s*\(|WinHTTP|wininet/i);
});

test("native helper emits metadata only and leaves clipboard bytes to the main-process adapter", () => {
  const listenerSource = readNativeFile("clipboard_listener.cpp");

  assert.doesNotMatch(listenerSource, /CF_UNICODETEXT[\s\S]{0,500}(GetClipboardData|GlobalLock)/i);
  assert.doesNotMatch(listenerSource, /CF_DIB[\s\S]{0,500}(GetClipboardData|GlobalLock)/i);
  assert.match(listenerSource, /IsClipboardFormatAvailable/);
  assert.match(listenerSource, /sourceApp|executable/);
  assert.match(listenerSource, /flush|std::endl/);
});
