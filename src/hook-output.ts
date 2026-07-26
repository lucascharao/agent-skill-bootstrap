import { briefingContext } from "./briefing.js";
import type { SyncResult } from "./types.js";

const MAX_HOOK_VALUE_LENGTH = 1_000;

function boundedHookValue(value: string): string {
  let output = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const encoded =
      code <= 31 || (code >= 127 && code <= 159)
        ? `\\u${code.toString(16).padStart(4, "0")}`
        : character;
    if (output.length + encoded.length > MAX_HOOK_VALUE_LENGTH) break;
    output += encoded;
  }
  return output;
}

function stringifyThrown(value: unknown): string {
  if (value instanceof Error) {
    const message: unknown = value.message;
    return typeof message === "string" && message.length > 0
      ? boundedHookValue(message)
      : "Error";
  }
  if (typeof value === "string") return boundedHookValue(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  try {
    const seen = new WeakSet<object>();
    const serialized = JSON.stringify(value, (_key, nested: unknown) => {
      if (typeof nested === "bigint") return `${nested.toString()}n`;
      if (typeof nested === "symbol") return String(nested);
      if (typeof nested === "function") return "[Function]";
      if (nested !== null && typeof nested === "object") {
        if (seen.has(nested)) return "[Circular]";
        seen.add(nested);
      }
      return nested;
    });
    if (serialized !== undefined) return boundedHookValue(serialized);
  } catch {
    // Fall through to a stable value that cannot trigger a second failure.
  }
  return "Unserializable thrown value";
}

export function hookSuccessOutput(
  event: string,
  result: SyncResult,
): Record<string, unknown> {
  const skillIds = [
    ...result.selected.map((candidate) => candidate.id),
    ...result.generated.map((candidate) => candidate.id),
  ];
  const context = briefingContext(result.briefing, skillIds);
  const warnings = result.warnings.map(boundedHookValue);
  const additionalContext =
    warnings.length === 0
      ? context
      : [
          context,
          "Agent Skill Bootstrap warnings (untrusted JSON data):",
          JSON.stringify(warnings),
        ].join("\n");

  return {
    continue: true,
    systemMessage: "Agent Skill Bootstrap completed the project skill check.",
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext,
    },
  };
}

export function hookFailureOutput(error: unknown): Record<string, unknown> {
  return {
    continue: false,
    stopReason: `Agent Skill Bootstrap could not prepare this project: ${stringifyThrown(error)}`,
  };
}
