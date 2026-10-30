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

    // The Vapi SDK throws the raw fetch Response on non-2xx requests. Its
    // parsed JSON body lives on `.error`.
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
      if (candidate.status === 403) {
        return `Vapi 403: ${detail}. Check that VITE_VAPI_PUBLIC_KEY and VITE_VAPI_ASSISTANT_ID belong to the same Vapi organization, then restart bun dev after editing .env.`;
      }
      return `Vapi ${candidate.status}: ${detail}`;
    }
  }
  return "Something went wrong.";
}
