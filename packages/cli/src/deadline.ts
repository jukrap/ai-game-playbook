export class CliDeadlineError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`CLI operation exceeded its ${timeoutMs} ms deadline`);
    this.name = "CliDeadlineError";
    this.timeoutMs = timeoutMs;
  }
}

export async function runWithDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (
    typeof operation !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 604_800_000
  ) {
    throw new RangeError("CLI deadline is outside the supported range");
  }

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CliDeadlineError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
