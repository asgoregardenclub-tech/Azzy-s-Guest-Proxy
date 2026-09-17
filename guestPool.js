const { Gemini } = require('gemini-web-sdk');

class GuestPool {
  constructor(poolSize = 5) {
    this.poolSize = poolSize;
    this.currentIndex = 0;
  }

  async initialize() {
    // Zero-overhead stateless initialization
  }

  /**
   * Spawns a clean, isolated Gemini client instance for each turn.
   * Prevents Google from tethering old conversation IDs (cid) across re-rolls.
   */
  async acquireWorker() {
    this.currentIndex = (this.currentIndex + 1) % this.poolSize;
    return {
      id: this.currentIndex + 1,
      client: new Gemini(),
    };
  }

  releaseWorker(worker, hadError = false, errorMsg = '') {
    if (worker) {
      worker.client = null; // Clean garbage collection
    }
  }

  async destroy() {
    // Clean hook for graceful server shutdown
  }
}

module.exports = GuestPool;
