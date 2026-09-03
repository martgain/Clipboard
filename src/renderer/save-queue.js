export class SerializedSaveQueue {
  constructor(save, onError = null) {
    if (typeof save !== "function") {
      throw new TypeError("A save callback is required");
    }
    if (onError !== null && typeof onError !== "function") {
      throw new TypeError("The save error callback must be a function");
    }

    this.save = save;
    this.onError = onError;
    this.tail = Promise.resolve();
  }

  enqueue(value) {
    const operation = this.tail.then(() => this.save(value));
    this.tail = operation.catch((error) => {
      this.onError?.(error);
    });
    return this.tail;
  }

  flush() {
    return this.tail;
  }
}
