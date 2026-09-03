const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");

async function importModule() {
  const source = fs.readFileSync(path.join(projectRoot, "src", "renderer", "save-queue.js"), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("serialized save queue commits in order and recovers after one failed save", async () => {
  const { SerializedSaveQueue } = await importModule();
  const values = [];
  const errors = [];
  const queue = new SerializedSaveQueue(async (value) => {
    values.push(value);
    if (value === 2) {
      throw new Error("temporary save failure");
    }
  }, (error) => errors.push(error.message));

  await Promise.all([queue.enqueue(1), queue.enqueue(2), queue.enqueue(3)]);
  await queue.flush();

  assert.deepEqual(values, [1, 2, 3]);
  assert.deepEqual(errors, ["temporary save failure"]);
});
