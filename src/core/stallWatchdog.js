export const STALL_TIMEOUT_MS = 15000;
export const STALL_COOLDOWN_MS = 30000;
export const STALL_PROGRESS_EPSILON = 0.05;

export class StallWatchdog {
  constructor({
    timeoutMs = STALL_TIMEOUT_MS,
    cooldownMs = STALL_COOLDOWN_MS,
    now = Date.now,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    getPosition = () => 0,
    isActive = () => true,
    onStall = null
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.getPosition = getPosition;
    this.isActive = isActive;
    this.onStall = onStall;
    this._timer = null;
    this._stalled = false;
    this._startPosition = 0;
    this._cooldownUntil = 0;
  }

  waiting() {
    if (!this.isActive()) {
      this.stop();
      return false;
    }
    if (this.now() < this._cooldownUntil) return false;
    this.stop();
    this._stalled = true;
    this._startPosition = this._position();
    this._timer = this.setTimeoutFn(() => this._check(), this.timeoutMs);
    return true;
  }

  progress() {
    this.stop();
  }

  stop() {
    if (this._timer != null) this.clearTimeoutFn(this._timer);
    this._timer = null;
    this._stalled = false;
  }

  reset() {
    this.stop();
    this._cooldownUntil = 0;
  }

  cooling(now = this.now()) {
    return now < this._cooldownUntil;
  }

  pending() {
    return this._stalled && this._timer != null;
  }

  _position() {
    const n = Number(this.getPosition());
    return Number.isFinite(n) ? n : 0;
  }

  _check() {
    this._timer = null;
    if (!this._stalled) return;
    this._stalled = false;
    if (!this.isActive()) return;
    const now = this.now();
    if (now < this._cooldownUntil) return;
    if (this._position() > this._startPosition + STALL_PROGRESS_EPSILON) return;
    this._cooldownUntil = now + this.cooldownMs;
    if (this.onStall) this.onStall();
  }
}
