export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      message?: unknown;
      data?: unknown;
      status?: unknown;
      statusText?: unknown;
      error?: unknown;
    };
    if (typeof candidate.message === "string") {
      return candidate.message;
    }
    if (typeof candidate.data === "string") {
      return candidate.data;
    }
    if (typeof candidate.data === "object" && candidate.data !== null) {
      const data = candidate.data as { message?: unknown };
      if (typeof data.message === "string") {
        return data.message;
      }
    }

    // Some SDKs throw the raw fetch Response on non-2xx requests. Its parsed
    // JSON body lives on `.error`.
    if (typeof candidate.status === "number") {
      const body =
        typeof candidate.error === "object" && candidate.error !== null
          ? (candidate.error as { message?: unknown; error?: unknown })
          : null;
      const detail =
        typeof body?.message === "string"
          ? body.message
          : typeof body?.error === "string"
            ? body.error
            : typeof candidate.statusText === "string"
              ? candidate.statusText
              : "Request failed";
      return `Request failed (${candidate.status}): ${detail}`;
    }
  }
  return "Something went wrong.";
}
