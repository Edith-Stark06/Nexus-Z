// The assistant's two calls. Kept apart from services/api.js: a chat question must never fall back to sample data,
// because an invented answer is worse than an honest error.
const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) ||
  "http://localhost:8000";

export class ChatError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// What a question would use right now: { mode: "llm" | "rules", models: [...], token_configured }. Null when the API is unreachable.
export async function getChatStatus() {
  try {
    const res = await fetch(`${API_BASE}/chat/status`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// One question with the last turns of the conversation. Resolves with the API's answer object, or throws a ChatError that is safe to show.
export async function askAssistant(message, history = []) {
  let res;
  try {
    res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: history.slice(-6).map(({ role, content }) => ({ role, content: content.slice(0, 1500) })) }),
    });
  } catch {
    throw new ChatError("Could not reach the NEXUS Z API. Check the tunnel or the server.", 0);
  }
  if (res.status === 429) throw new ChatError("Too many questions in the last minute. Wait a moment and try again.", 429);
  if (res.status === 422) throw new ChatError("That question is too long or not valid. Keep it under 500 characters.", 422);
  if (!res.ok) throw new ChatError(`The assistant is not available right now (HTTP ${res.status}).`, res.status);
  return res.json();
}
