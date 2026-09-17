const { Gemini } = require('gemini-web-sdk');

class GuestPool {
  /**
   * @param {number} poolSize Number of guest sessions
   * @param {number} maxRequestsPerWorker Recycle worker after this many turns
   */
  constructor(poolSize = 5, maxRequestsPerWorker = 10) {
    this.poolSize = poolSize;
    this.maxRequestsPerWorker = maxRequestsPerWorker;
    this.workers = [];
    this.currentIndex = 0;
  }

  async initialize() {
    for (let i = 0; i < this.poolSize; i++) {
      this.workers.push(this._createNewWorker(i + 1));
    }
  }

  _createNewWorker(id) {
    return {
      id,
      client: new Gemini(),
      requestCount: 0,
      cooldownUntil: 0,
      isBusy: false
    };
  }

  /**
   * Completely destroys the worker's internal Gemini client and spawns a fresh one
   * to guarantee zero Google-side memory bleed across turns.
   */
  purgeWorker(worker, reason = 'Session cleanup') {
    try {
      worker.client = new Gemini();
      worker.requestCount = 0;
      worker.cooldownUntil = 0;
      worker.isBusy = false;
    } catch (err) {
      worker.cooldownUntil = Date.now() + 60000;
    }
  }

  async acquireWorker() {
    const now = Date.now();
    let attempts = 0;

    while (attempts < this.workers.length * 2) {
      const worker = this.workers[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.workers.length;

      if (!worker.isBusy && worker.cooldownUntil <= now) {
        worker.isBusy = true;
        return worker;
      }
      attempts++;
    }

    // Emergency fallback: return an isolated zero-state worker
    return {
      id: 999,
      client: new Gemini(),
      requestCount: 0,
      cooldownUntil: 0,
      isBusy: true,
      temporary: true
    };
  }

  releaseWorker(worker, hadError = false, errorMsg = '') {
    if (worker.temporary) return;

    worker.isBusy = false;

    if (hadError) {
      const isRateLimit = errorMsg.includes('429') || errorMsg.toLowerCase().includes('quota');
      worker.cooldownUntil = Date.now() + (isRateLimit ? 90000 : 20000);
      this.purgeWorker(worker, 'Error recovery');
      return;
    }

    worker.requestCount++;

    // Purge every worker periodically or on threshold to prevent any tracking
    if (worker.requestCount >= this.maxRequestsPerWorker) {
      this.purgeWorker(worker, 'Rotation threshold');
    }
  }
}

module.exports = GuestPool;
