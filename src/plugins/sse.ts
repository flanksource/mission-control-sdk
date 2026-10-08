import { MissionControlError } from "../core/errors.js";

export type PluginStreamEvent = {
  event: string;
  data: string;
  id: string;
};

/** Parse a fetch response without reconnecting; authentication and cancellation belong to the caller. */
export async function* readPluginEvents(response: Response): AsyncGenerator<PluginStreamEvent> {
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new MissionControlError(`Stream failed with ${response.status}${detail ? `: ${detail}` : ""}`, {
      status: response.status,
    });
  }
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/event-stream") {
    await response.body?.cancel();
    throw new MissionControlError("Stream response must have content-type text/event-stream");
  }
  if (!response.body) throw new MissionControlError("Stream response has no body");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let event = "";
  let id = "";
  let data: string[] = [];
  let skipLF = false;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      for (const character of chunk.value) {
        if (skipLF && character === "\n") {
          skipLF = false;
          continue;
        }
        skipLF = false;
        if (character !== "\r" && character !== "\n") {
          buffer += character;
          continue;
        }
        skipLF = character === "\r";
        const line = buffer;
        buffer = "";
        if (!line) {
          if (data.length) yield { event: event || "message", data: data.join("\n"), id };
          event = "";
          data = [];
          continue;
        }
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "data") data.push(value);
        if (field === "event") event = value;
        if (field === "id" && !value.includes("\0")) id = value;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
