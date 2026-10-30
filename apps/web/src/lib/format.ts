export function formatTimestamp(timestamp: number | undefined): string {
  if (!timestamp) {
    return "—";
  }
  return `${new Date(timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function formatDuration(startedAt?: number, endedAt?: number): string {
  if (!startedAt) {
    return "—";
  }
  const end = endedAt ?? Date.now();
  const totalSeconds = Math.max(0, Math.round((end - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

export function formatCost(cost: number | undefined): string {
  if (cost === undefined) {
    return "—";
  }
  return `$${cost.toFixed(4)}`;
}
