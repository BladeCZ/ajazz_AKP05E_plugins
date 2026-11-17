// Shared lock for sequential USB HID and gRPC access to the Ajazz mouse dongle.
// Prevents concurrent requests from colliding on the single hardware endpoint.

let queue = Promise.resolve();

function withAjazzLock(fn) {
  const next = queue.then(async () => {
    try {
      return await fn();
    } finally {
      // 15ms breathing space for the dongle microcontroller between commands
      await new Promise((r) => setTimeout(r, 15));
    }
  });
  queue = next.catch(() => {});
  return next;
}

module.exports = { withAjazzLock };
