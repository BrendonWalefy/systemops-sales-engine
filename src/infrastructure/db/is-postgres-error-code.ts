type ErrorLike = {
  code?: unknown;
  cause?: unknown;
};

export function isPostgresErrorCode(error: unknown, targetCode: string): boolean {
  let current: unknown = error;
  let depth = 0;

  while (current && depth < 5) {
    if (
      typeof current === "object" &&
      "code" in (current as ErrorLike) &&
      (current as ErrorLike).code === targetCode
    ) {
      return true;
    }

    current =
      typeof current === "object" && "cause" in (current as ErrorLike)
        ? (current as ErrorLike).cause
        : null;
    depth++;
  }

  return false;
}
