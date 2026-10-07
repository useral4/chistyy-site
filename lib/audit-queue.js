class QueueError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

class AuditQueue {
  constructor({concurrency = 1, maxWaiting = 20, waitMs = 120000} = {}) {
    this.concurrency = concurrency;
    this.maxWaiting = maxWaiting;
    this.waitMs = waitMs;
    this.active = 0;
    this.waiting = [];
    this.closed = false;
  }

  acquire({signal, onPosition = () => {}} = {}) {
    if (this.closed) return Promise.reject(new QueueError('QUEUE_CLOSED', 'Проверки временно недоступны'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.active < this.concurrency) { this.active++; return Promise.resolve(this.releaseHandle()); }
    if (this.waiting.length >= this.maxWaiting) return Promise.reject(new QueueError('QUEUE_FULL', 'Очередь проверок заполнена. Попробуйте чуть позже.'));
    return new Promise((resolve, reject) => {
      const entry = {resolve, reject, onPosition, signal};
      const remove = error => {
        const index = this.waiting.indexOf(entry);
        if (index === -1) return;
        this.waiting.splice(index, 1);
        entry.cleanup();
        reject(error);
        this.positions();
      };
      const abort = () => remove(signal.reason);
      const timer = setTimeout(() => remove(new QueueError('QUEUE_TIMEOUT', 'Очередь заняла слишком много времени. Попробуйте ещё раз.')), this.waitMs);
      entry.cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      signal?.addEventListener('abort', abort, {once: true});
      this.waiting.push(entry);
      this.positions();
    });
  }

  positions() { this.waiting.forEach((entry, index) => entry.onPosition(index + 1)); }

  releaseHandle() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const next = this.waiting.shift();
      if (next) { next.cleanup(); this.active++; next.resolve(this.releaseHandle()); }
      this.positions();
    };
  }

  close() {
    this.closed = true;
    for (const entry of this.waiting.splice(0)) {
      entry.cleanup();
      entry.reject(new QueueError('QUEUE_CLOSED', 'Сервер обновляется. Запустите проверку ещё раз.'));
    }
  }

  snapshot() { return {active: this.active, waiting: this.waiting.length, capacity: this.concurrency, limit: this.maxWaiting, closed: this.closed}; }
}

module.exports = {AuditQueue, QueueError};
