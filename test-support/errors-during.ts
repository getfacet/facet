/**
 * Every error that escaped while `run` executed.
 *
 * React catches a throw from an event handler at its dispatch boundary and
 * reports it to the environment, which jsdom turns into a window `error` event.
 * Listening for the report is what makes the escape assertable.
 */
export function errorsDuring(run: () => void): readonly string[] {
  const escaped: string[] = [];
  const record = (event: ErrorEvent): void => {
    escaped.push(event.error instanceof Error ? event.error.message : String(event.message));
    event.preventDefault();
  };
  window.addEventListener("error", record);
  try {
    run();
  } catch (error) {
    escaped.push(error instanceof Error ? error.message : String(error));
  } finally {
    window.removeEventListener("error", record);
  }
  return escaped;
}
