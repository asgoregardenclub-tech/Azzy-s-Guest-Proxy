const { Gemini } = require('gemini-web-sdk');

class GuestPool {
  constructor(poolSize = 5) {
    this.poolSize = poolSize;
    this.currentIndex = 0;
  }

  async initialize() {
    // Zero-overhead initialization
  }

  /**
   * Spawns a 100% pristine, isolated Gemini instance with no shared cookies
   * or session memory from previous turns.
   */
  async acquireWorker() {
    this.currentIndex = (this.currentIndex + 1) % this.poolSize;
    return {
      id: this.currentIndex + 1,
      client: new Gemini(), // Fresh client instance every time
    };
  }

  releaseWorker(worker, hadError = false, errorMsg = '') {
    // Garbage collect client instance
    worker.client = null;
  }
}

module.exports = GuestPool;
