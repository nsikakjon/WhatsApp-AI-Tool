// Runs a task over and over on a timer (e.g. "are any daily reports due?").
// A run that is still going is never overlapped by the next one, and an error
// is logged without stopping the timer.
export function runEvery(
  intervalMs: number,
  task: () => Promise<void>,
  log: Pick<Console, "error"> = console,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (err) {
      log.error("Scheduled task failed:", err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  void tick();
  return () => clearInterval(timer);
}
