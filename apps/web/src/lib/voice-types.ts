export type ConnectionState = "idle" | "connecting" | "active" | "ending" | "ended" | "error";

export type LiveTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
};
