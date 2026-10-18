/** Wait for owned work without delaying parent cancellation. The work itself remains owned. */
export async function waitForDelegation<T>(result: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new Error("Delegation wait canceled.");
  if (!signal) return result;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      result,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error("Delegation wait canceled."));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
