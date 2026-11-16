// A minimal circuit breaker: after `trip()`, `isOpen()` is true for `pauseMs`, then it closes by itself.
// Used to leave a failing dependency alone for a moment instead of letting every request wait on it.
export function createBreaker(pauseMs = 30000, now = Date.now) {
  let openUntil = 0;
  return { isOpen: () => now() < openUntil, trip: () => { openUntil = now() + pauseMs; }, reset: () => { openUntil = 0; } };
}
