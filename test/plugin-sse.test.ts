import { describe, expect, it, vi } from "vitest";
import { readPluginEvents } from "../src/plugins/sse.js";

describe("fetch SSE parser", () => {
  it("handles chunk-split CRLF and UTF-8, comments, multiline data and default events", async () => {
    const bytes = new TextEncoder().encode(
      ": comment\r\nid: 17\revent: log\r\ndata: héllo\r\ndata: second\r\n\r\ndata:\n\nid: invalid\0id\ndata: last\n\ndata: unfinished",
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const events = [];
    for await (const event of readPluginEvents(new Response(body, {
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    }))) events.push(event);
    expect(events).toEqual([
      { event: "log", data: "héllo\nsecond", id: "17" },
      { event: "message", data: "", id: "17" },
      { event: "message", data: "last", id: "17" },
    ]);
  });

  it("parses a large chunk and closes the stream when the consumer breaks", async () => {
    const cancel = vi.fn();
    const data = "log line ".repeat(20000);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${data}\n\ndata: ignored\n\n`));
      },
      cancel,
    });
    for await (const event of readPluginEvents(new Response(body, {
      headers: { "content-type": "text/event-stream" },
    }))) {
      expect(event).toEqual({ event: "message", data, id: "" });
      break;
    }
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("surfaces HTTP status and rejects non-SSE responses", async () => {
    await expect(readPluginEvents(new Response("forbidden", { status: 403 })).next())
      .rejects.toMatchObject({ status: 403 });
    const response = new Response("not an event stream", { headers: { "content-type": "text/plain" } });
    const cancel = vi.spyOn(response.body!, "cancel");
    await expect(readPluginEvents(response).next()).rejects.toThrow("content-type text/event-stream");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
