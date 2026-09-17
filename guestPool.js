const { Gemini } = require('gemini-web-sdk');

/**
 * Enterprise-grade Worker Pool for Gemini Web SDK
 * Supports unauthenticated Guest Mode and optional cookie-based rotation.
 */
class GuestPool {
  /**
   * @param {Object|number} [options] - Pool configuration or pool size number
   */
  constructor(options = {}) {
    const config = typeof options === 'number' ? { poolSize: options } : options;
    this.poolSize = Math.max(1, parseInt(config.poolSize || process.env.POOL_SIZE || '5', 10));
    this.acquireTimeout = parseInt(config.acquireTimeout || process.env.ACQUIRE_TIMEOUT || '45000', 10);

    // Optional multi-cookie rotation: fallback to Guest mode if absent
    const rawCookies = process.env.GEMINI_COOKIES || process.env.SECURE_1PSID || '';
    this.cookies = rawCookies
      ? rawCookies.split(',').map((c) => c.trim()).filter(Boolean)
      : [];
    this.cookieIndex = 0;

    // Track dedicated worker slots
    this.slots = Array.from({ length: this.poolSize }, (_, i) => ({
      id: i + 1,
      busy: false,
      client: null,
      totalJobs: 0,
      consecutiveErrors: 0,
      cooldownUntil: 0
    }));

    this.queue = [];
    this.totalRequests = 0;
    this.totalErrors = 0;
  }

  /**
   * Initializes the pool configuration
   */
  async initialize() {
    const mode = this.cookies.length > 0
      ? `Authenticated Rotation (${this.cookies.length} session token(s))`
      : 'Stateless Guest Mode (Zero Google account requirement)';
    return { poolSize: this.poolSize, mode };
  }

  /**
   * Instantiates a Gemini client instance
   * @private
   */
  _createClient() {
    if (this.cookies.length > 0) {
      const cookie = this.cookies[this.cookieIndex % this.cookies.length];
      this.cookieIndex++;
      return new Gemini({ secure_1psid: cookie });
    }
    return new Gemini();
  }

  /**
   * Acquires a worker from the pool or queues until a slot is free.
   * @param {Object} [options]
   * @param {AbortSignal} [options.signal] - Cancellation signal from incoming HTTP request
   * @returns {Promise<{ id: number, client: Gemini, release: (hadError?: boolean, errorMsg?: string) => void }>}
   */
  acquireWorker(options = {}) {
    const { signal } = options;

    if (signal?.aborted) {
      return Promise.reject(new Error('Request was aborted prior to acquiring a worker'));
    }

    const now = Date.now();
    // 1. Locate an immediately available slot not in cooldown
    const availableSlot = this.slots.find((s) => !s.busy && s.cooldownUntil <= now);
    if (availableSlot) {
      return Promise.resolve(this._occupySlot(availableSlot));
    }

    // 2. Locate any non-busy slot whose cooldown is expiring soon
    const idleSlot = this.slots.find((s) => !s.busy);
    if (idleSlot) {
      const waitMs = Math.max(50, idleSlot.cooldownUntil - now);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (signal?.aborted) {
            return reject(new Error('Request aborted before worker acquired'));
          }
          resolve(this._occupySlot(idleSlot));
        }, waitMs);

        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Request aborted'));
          }, { once: true });
        }
      });
    }

    // 3. All slots are currently busy: queue request
    return new Promise((resolve, reject) => {
      let timer = null;

      const queueItem = {
        resolve: (worker) => {
          if (timer) clearTimeout(timer);
          resolve(worker);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
        signal,
        enqueuedAt: Date.now()
      };

      if (this.acquireTimeout > 0) {
        timer = setTimeout(() => {
          const idx = this.queue.indexOf(queueItem);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            reject(new Error(`Worker acquisition timed out after ${this.acquireTimeout}ms (Queue depth: ${this.queue.length})`));
          }
        }, this.acquireTimeout);
      }

      if (signal) {
        signal.addEventListener('abort', () => {
          if (timer) clearTimeout(timer);
          const idx = this.queue.indexOf(queueItem);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            reject(new Error('Request aborted while waiting in pool queue'));
          }
        }, { once: true });
      }

      this.queue.push(queueItem);
    });
  }

  /**
   * Binds an active slot to a new turn
   * @private
   */
  _occupySlot(slot) {
    slot.busy = true;
    slot.totalJobs++;
    this.totalRequests++;

    const client = this._createClient();
    slot.client = client;

    let released = false;
    const release = (hadError = false, errorMsg = '') => {
      if (released) return;
      released = true;
      this.releaseWorker(slot, hadError, errorMsg);
    };

    return {
      id: slot.id,
      client,
      release
    };
  }

  /**
   * Releases a worker slot and processes the queue
   */
  releaseWorker(slotOrWorker, hadError = false, errorMsg = '') {
    const slotId = slotOrWorker?.id || slotOrWorker;
    const slot = this.slots.find((s) => s.id === slotId);

    if (!slot) return;

    // Clean references for garbage collection
    slot.client = null;
    slot.busy = false;

    if (hadError) {
      slot.consecutiveErrors++;
      this.totalErrors++;
      // Exponential backoff cooldown (max 12s)
      const backoff = Math.min(12000, slot.consecutiveErrors * 2000);
      slot.cooldownUntil = Date.now() + backoff;
    } else {
      slot.consecutiveErrors = 0;
      slot.cooldownUntil = 0;
    }

    this._dispatchNext();
  }

  /**
   * Dispatches the next queued caller if a slot is available
   * @private
   */
  _dispatchNext() {
    if (this.queue.length === 0) return;

    const now = Date.now();
    const availableSlot = this.slots.find((s) => !s.busy && s.cooldownUntil <= now);
    if (!availableSlot) return;

    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next.signal?.aborted) continue;
      next.resolve(this._occupySlot(availableSlot));
      break;
    }
  }

  /**
   * Health metrics
   */
  getStats() {
    const now = Date.now();
    return {
      poolSize: this.poolSize,
      activeWorkers: this.slots.filter((s) => s.busy).length,
      availableSlots: this.slots.filter((s) => !s.busy && s.cooldownUntil <= now).length,
      coolingDownSlots: this.slots.filter((s) => !s.busy && s.cooldownUntil > now).length,
      queuedRequests: this.queue.length,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors
    };
  }
}

module.exports = GuestPool;
