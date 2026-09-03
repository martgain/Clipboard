const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { writeAtomicTextFile } = require("../src/main/storage/replace-safe.cjs");

test("safe text replacement never deletes the current target before installing new contents", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-replace-"));
  const target = path.join(root, "library.md");
  const removed = [];
  const fileSystem = new Proxy(fs, {
    get(targetObject, property) {
      if (property === "rmSync") {
        return (filePath, ...args) => {
          removed.push(filePath);
          return targetObject.rmSync(filePath, ...args);
        };
      }
      const value = targetObject[property];
      return typeof value === "function" ? value.bind(targetObject) : value;
    }
  });

  try {
    fs.writeFileSync(target, "old", "utf8");
    writeAtomicTextFile(target, "new", { fsModule: fileSystem, token: "safe-test" });
    assert.equal(fs.readFileSync(target, "utf8"), "new");
    assert.equal(removed.includes(target), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("safe replacement restores the previous target when the second rename fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-replace-"));
  const target = path.join(root, "library.md");
  const temporary = path.join(root, "incoming");
  const previous = `${target}.previous-restore-test`;
  let attemptedInstall = false;
  const fileSystem = new Proxy(fs, {
    get(targetObject, property) {
      if (property === "renameSync") {
        return (from, to) => {
          if (from === temporary && to === target) {
            if (!attemptedInstall) {
              attemptedInstall = true;
              const error = new Error("target exists");
              error.code = "EEXIST";
              throw error;
            }
            const error = new Error("simulated write failure");
            error.code = "EACCES";
            throw error;
          }
          return targetObject.renameSync(from, to);
        };
      }
      const value = targetObject[property];
      return typeof value === "function" ? value.bind(targetObject) : value;
    }
  });

  try {
    fs.writeFileSync(target, "old", "utf8");
    fs.writeFileSync(temporary, "new", "utf8");
    assert.throws(
      () => require("../src/main/storage/replace-safe.cjs").replaceFile(temporary, target, { fsModule: fileSystem, token: "restore-test" }),
      /simulated write failure/
    );
    assert.equal(fs.readFileSync(target, "utf8"), "old");
    assert.equal(fs.existsSync(previous), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
