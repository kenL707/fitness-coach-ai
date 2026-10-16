import { vi } from "vitest";

/** Shared fake of the Anthropic SDK: `create` is the one function the routes call. */
export const create = vi.fn();

export const anthropicModule = () => {
  class APIError extends Error {
    status?: number;
  }
  class AuthenticationError extends APIError {}
  class NotFoundError extends APIError {}
  class RateLimitError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    static NotFoundError = NotFoundError;
    static RateLimitError = RateLimitError;
    messages = { create };
  }
  return { default: Anthropic };
};

/** A successful text reply carrying `body` as JSON. */
export const reply = (body: unknown, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
});

export const systemOf = (args: { system?: unknown }) => String(args.system ?? "");
export const userOf = (args: { messages: { content: unknown }[] }) => String(args.messages[0].content);
