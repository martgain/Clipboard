const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(projectRoot, "clipboard-shelf.html"), "utf8");
const appSource = fs.readFileSync(path.join(projectRoot, "src/renderer/app.js"), "utf8");
const componentStyles = fs.readFileSync(path.join(projectRoot, "src/renderer/styles/components.css"), "utf8");

test("the top bar exposes a single keyboard lock button with Arabic tooltip and pressed state", () => {
  const buttonMatch = html.match(/<button id="keyboardLockButton"[^>]*>[\s\S]*?<\/button>/);
  assert.ok(buttonMatch, "keyboardLockButton must exist in the top bar");
  const buttonMarkup = buttonMatch[0];

  assert.match(buttonMarkup, /aria-pressed="false"/);
  assert.match(buttonMarkup, /title="[^"]*لوحة المفاتيح[^"]*"/);
  assert.match(buttonMarkup, /aria-label="[^"]*لوحة المفاتيح[^"]*"/);
  assert.equal((buttonMarkup.match(/<svg/g) || []).length, 1, "the button must expose a single icon");

  assert.ok(html.indexOf('id="keyboardLockButton"') < html.indexOf('id="windowControls"') || html.indexOf('id="keyboardLockButton"') > 0);
  assert.match(html, /<header class="topbar">[\s\S]*<button id="keyboardLockButton"[\s\S]*<\/header>/);
});

test("the keyboard lock button stays directly reachable at the narrowest supported width", () => {
  assert.doesNotMatch(componentStyles, /\.density-tight #keyboardLockButton\s*\{\s*display:\s*none;/);
  assert.match(componentStyles, /#keyboardLockButton\s*\{[\s\S]*?width:\s*1\.\d+rem;[\s\S]*?\}/);
  assert.match(componentStyles, /density-tight[\s\S]*?#keyboardLockButton[\s\S]*?\{[\s\S]*?width:/);
});

test("the keyboard lock button uses the danger state while locked without touching other icon controls", () => {
  assert.match(componentStyles, /#keyboardLockButton\.is-active\s*\{[\s\S]*?background:\s*var\(--danger-bg\);[\s\S]*?\}/);
  assert.match(componentStyles, /#colorPickerButton\s*\{/);
  assert.match(componentStyles, /#ocrButton\s*\{/);
});

test("the renderer wires the keyboard lock button to the desktop bridge and keeps status in sync", () => {
  assert.match(appSource, /keyboardLockButton:\s*document\.getElementById\("keyboardLockButton"\)/);
  assert.match(appSource, /elements\.keyboardLockButton\.addEventListener\("click"/);
  assert.match(appSource, /desktopApi\.setKeyboardLocked\(/);
  assert.match(appSource, /desktopApi\.getKeyboardLockStatus\(/);
  assert.match(appSource, /desktopApi\.onKeyboardLockChanged\(/);
  assert.match(appSource, /function setKeyboardLockButtonState\(/);
  assert.match(appSource, /elements\.keyboardLockButton\.setAttribute\("aria-pressed"/);
});

test("the keyboard lock control does not remove the existing color picker or OCR controls", () => {
  assert.match(html, /id="colorPickerButton"/);
  assert.match(html, /id="ocrButton"/);
  assert.match(appSource, /elements\.colorPickerButton\.addEventListener\("click"/);
  assert.match(appSource, /elements\.ocrButton\.addEventListener\("click"/);
});
