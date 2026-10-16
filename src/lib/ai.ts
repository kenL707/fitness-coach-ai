import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

// Latest Sonnet; override with ANTHROPIC_MODEL (e.g. claude-haiku-5-5 for even faster, cheaper runs).
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

export const hasApiKey = () => !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "your_key_here";

export const MISSING_KEY = "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.";

export const fail = (message: string, status = 500) => NextResponse.json({ error: message }, { status });

/** Parse JSON from a model reply, tolerating stray code fences or surrounding prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("No JSON object found in model response.");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

/** Text of the first text block, or throws a readable error for refusals / truncation. */
export function responseText(response: Anthropic.Message): string {
  if (response.stop_reason === "refusal") throw new Error("The model declined to generate this. Please adjust your inputs and try again.");
  if (response.stop_reason === "max_tokens") throw new Error("The response came back incomplete. Please try again.");
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("The model returned no content.");
  return block.text;
}

/** Map any thrown error to a 500 JSON response with a useful message. */
export function errorResponse(err: unknown) {
  console.error("AI request failed", err);
  if (err instanceof Anthropic.AuthenticationError) return fail("Anthropic rejected the API key. Check ANTHROPIC_API_KEY.");
  if (err instanceof Anthropic.NotFoundError) return fail(`Model "${MODEL}" was not found. Set ANTHROPIC_MODEL to a valid model.`);
  if (err instanceof Anthropic.RateLimitError) return fail("Rate limited by Anthropic. Please retry shortly.");
  if (err instanceof Anthropic.APIError && /credit balance/i.test(err.message)) {
    return fail("Your Anthropic account is out of credits. Add credits under Plans & Billing at console.anthropic.com, then try again.");
  }
  if (err instanceof Anthropic.APIError) return fail(`Anthropic API error (${err.status}): ${err.message.slice(0, 300)}`);
  if (err instanceof Error) return fail(err.message);
  return fail("Something went wrong. Please try again.");
}
