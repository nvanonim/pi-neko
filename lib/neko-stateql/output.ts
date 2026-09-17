import type { Response } from "@fadhilp/stateql";
import type { StateQLToolInput } from "./commands.ts";

export const MAX_TOOL_OUTPUT_BYTES = 40 * 1024;

export function redactCredential(value: string, input: StateQLToolInput): string {
  if (!input.secret_env) return value;
  const secret = process.env[input.secret_env];
  if (!secret) return value;
  return value.split(secret).join("[REDACTED]");
}

export function boundedText(value: string, maxBytes = MAX_TOOL_OUTPUT_BYTES): { text: string; truncated: boolean } {
  if (Buffer.byteLength(value) <= maxBytes) return { text: value, truncated: false };
  const message = "StateQL response truncated. Use a narrower query or bounded rows page.";
  const render = (partialJson: string) => JSON.stringify({ truncated: true, message, partial_json: partialJson }, null, 2);
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(render(value.slice(0, middle))) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return { text: render(value.slice(0, low)), truncated: true };
}

export function boundedJson(value: unknown, maxBytes = MAX_TOOL_OUTPUT_BYTES): { text: string; truncated: boolean } {
  return boundedText(JSON.stringify(value, null, 2), maxBytes);
}

export function responseResult(response: Response<unknown>, input: StateQLToolInput) {
  const bounded = boundedText(redactCredential(JSON.stringify(response, null, 2), input));
  const text = bounded.text;
  return {
    content: [{ type: "text" as const, text }],
    details: {
      command: input.command,
      ok: response.ok,
      truncated: bounded.truncated,
      commandId: response.command_id,
      sessionId: response.session_id,
      errorCode: response.ok ? undefined : response.error.code,
    },
  };
}

export function safeError(error: unknown, input: StateQLToolInput): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(redactCredential(message, input));
}
