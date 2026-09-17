const { Gemini } = require('gemini-web-sdk');

class GuestPool {
  constructor(poolSize = 5) {
    this.poolSize = poolSize;
    this.currentIndex = 0;
  }

  async initialize() {
    // Zero-overhead stateless initialization
  }

  async acquireWorker() {
    this.currentIndex = (this.currentIndex + 1) % this.poolSize;
    return {
      id: this.currentIndex + 1,
      client: new Gemini(), // Fresh client instance per turn
    };
  }

  releaseWorker(worker, hadError = false, errorMsg = '') {
    if (worker) {
      worker.client = null; // Clean garbage collection
    }
  }
}

module.exports = GuestPool;
