const { Gemini } = require('gemini-web-sdk');

class GuestPool {
  /**
   * @param {number} poolSize Number of guest accounts to keep active concurrently
   * @param {number} maxRequestsPerSession Rotate account after this many requests
   */
  constructor(poolSize = 5, maxRequestsPerSession = 25) {
    this.poolSize = poolSize;
    this.maxRequestsPerSession = maxRequestsPerSession;
    this.workers = [];
    this.currentIndex = 0;
  }

  async initialize() {
    console.log(`[GuestPool] Initializing pool with ${this.poolSize} guest sessions...`);
    for (let i = 0; i < this.poolSize; i++) {
      this.workers.push(this._createWorker(i + 1));
    }
    console.log(`[GuestPool] All ${this.poolSize} guest sessions are ready.`);
  }

  _createWorker(id) {
    return {
      id,
      client: new Gemini(), // Guest Mode (no API key or cookies needed)
      requestCount: 0,
      cooldownUntil: 0,
      isBusy: false
    };
  }

  async recycleWorker(worker, reason = 'Rotation threshold reached') {
    console.log(`[GuestPool] Cycling Worker #${worker.id} (${reason}). Spawning fresh guest session...`);
    try {
      worker.client = new Gemini();
      worker.requestCount = 0;
      worker.cooldownUntil = 0;
      worker.isBusy = false;
      console.log(`[GuestPool] Worker #${worker.id} successfully refreshed.`);
    } catch (err) {
      console.error(`[GuestPool] Failed to refresh Worker #${worker.id}:`, err.message);
      worker.cooldownUntil = Date.now() + 60000; // 1-minute safety cooldown
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

    // If all are busy/cooling down, pick the one with earliest cooldown expiry or spawn temporary
    console.warn(`[GuestPool] All workers busy or cooling down. Falling back to temporary fresh session...`);
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
      const isRateLimit = errorMsg.includes('429') || errorMsg.toLowerCase().includes('quota') || errorMsg.toLowerCase().includes('exhausted');
      const cooldownTime = isRateLimit ? 90000 : 15000; // 90s cooldown for rate limits, 15s for other errors
      worker.cooldownUntil = Date.now() + cooldownTime;
      console.warn(`[GuestPool] Worker #${worker.id} placed on cooldown for ${cooldownTime / 1000}s. Cycling session...`);
      this.recycleWorker(worker, 'Error recovery');
      return;
    }

    worker.requestCount++;
    console.log(`[GuestPool] Worker #${worker.id} finished request (${worker.requestCount}/${this.maxRequestsPerSession}).`);

    // Auto-cycle account once threshold is reached
    if (worker.requestCount >= this.maxRequestsPerSession) {
      this.recycleWorker(worker, 'Hit request limit');
    }
  }
}

module.exports = GuestPool;
