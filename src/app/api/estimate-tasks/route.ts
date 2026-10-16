import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { MISSING_KEY, errorResponse, fail, hasApiKey } from "@/lib/ai";
import { estimateTasks } from "@/lib/estimate";
import { intakeSchema, type TaskEstimate } from "@/lib/fitness";

export const maxDuration = 90;

const bodySchema = z.object({
  intake: z.unknown(),
  tasks: z.array(z.object({ name: z.string().max(300), repsOrDuration: z.string().max(300) })).max(400),
});

/** Estimates calories and quantities for task texts. The page saves the results with the tasks. */
export async function POST(req: Request) {
  try {
    if (!hasApiKey()) return fail(MISSING_KEY);
    const body = bodySchema.safeParse(await req.json().catch(() => null));
    const intake = intakeSchema.safeParse(body.success ? body.data.intake : null);
    if (!body.success || !intake.success) return fail("Invalid request.", 400);

    const client = new Anthropic({ maxRetries: 3 });
    const estimates = await estimateTasks(client, intake.data, body.data.tasks);
    return NextResponse.json({ estimates: Object.fromEntries(estimates) as Record<string, TaskEstimate> });
  } catch (err) {
    return errorResponse(err);
  }
}
