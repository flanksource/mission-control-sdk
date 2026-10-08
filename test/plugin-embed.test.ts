import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginEmbed, type PluginEmbedOptions, type PluginUIToken } from "../src/index.js";

const embeds: ReturnType<typeof createPluginEmbed>[] = [];

function host() {
  const window = Object.assign(new EventTarget(), { location: new URL("https://host.test/app") });
  const postMessage = vi.fn();
  const iframe = { isConnected: true, contentWindow: { postMessage }, src: "", ownerDocument: {} };
  vi.stubGlobal("window", window);
  return {
    window, iframe, postMessage,
    message(type: string, origin = "https://mc.test", source: unknown = iframe.contentWindow) {
      window.dispatchEvent(Object.assign(new Event("message"), { origin, source, data: { type } }));
    },
    embed(getToken: PluginEmbedOptions["getToken"], extra: Partial<PluginEmbedOptions> = {}) {
      const embed = createPluginEmbed({
        iframe: iframe as unknown as HTMLIFrameElement,
        baseUrl: "https://mc.test", name: "logs", configId: "scope-a", getToken, ...extra,
      });
      embeds.push(embed);
      return embed;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const embed of embeds.splice(0)) embed.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("plugin iframe host", () => {
  it("deduplicates ready/request races and posts only to the iframe's exact origin", async () => {
    const fixture = host();
    let resolve!: (token: PluginUIToken) => void;
    const getToken = vi.fn(() => new Promise<PluginUIToken>(done => { resolve = done; }));
    const observer = vi.fn();
    vi.stubGlobal("MutationObserver", observer);
    fixture.embed(getToken);
    expect(fixture.iframe.src).toBe("https://mc.test/api/plugins/logs/ui/?config_id=scope-a&embed=token");
    expect(observer).not.toHaveBeenCalled();
    fixture.message("mc.tab.ready", "https://wrong.test");
    fixture.message("mc.token.request", "https://mc.test", fixture.window);
    await vi.advanceTimersByTimeAsync(0);
    expect(getToken).not.toHaveBeenCalled();
    fixture.message("mc.tab.ready");
    fixture.message("mc.token.request");
    fixture.message("mc.token.request");
    await vi.advanceTimersByTimeAsync(0);
    expect(getToken).toHaveBeenCalledOnce();
    resolve({ token: "minted", expiresInSeconds: 300 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.postMessage).toHaveBeenCalledExactlyOnceWith(
      { type: "mc.token", token: "minted", expiresInSeconds: 300 }, "https://mc.test",
    );
    await vi.advanceTimersByTimeAsync(1000);
    fixture.message("mc.tab.ready");
    expect(fixture.postMessage).toHaveBeenLastCalledWith(
      { type: "mc.token", token: "minted", expiresInSeconds: 299 }, "https://mc.test",
    );
    expect(getToken).toHaveBeenCalledOnce();
  });

  it("backs off failed mints, ignores requests during backoff, and recovers scheduled refresh", async () => {
    const fixture = host();
    const error = new Error("network unavailable");
    const onError = vi.fn();
    const getToken = vi.fn<PluginEmbedOptions["getToken"]>()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue({ token: "recovered", expiresInSeconds: 35 });
    fixture.embed(getToken, { onError });
    fixture.message("mc.tab.ready");
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(error);
    fixture.message("mc.token.request");
    await vi.advanceTimersByTimeAsync(999);
    expect(getToken).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(fixture.postMessage).not.toHaveBeenCalled();
    fixture.message("mc.token.request");
    await vi.advanceTimersByTimeAsync(1999);
    expect(getToken).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(getToken).toHaveBeenCalledTimes(3);
    expect(fixture.postMessage).toHaveBeenCalledWith(
      { type: "mc.token", token: "recovered", expiresInSeconds: 35 }, "https://mc.test",
    );
    await vi.advanceTimersByTimeAsync(4999);
    expect(getToken).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(getToken).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("caps backoff at 30 seconds and resets it after recovery", async () => {
    const fixture = host();
    let recover = false;
    const getToken = vi.fn<PluginEmbedOptions["getToken"]>(async () => {
      if (!recover) throw new Error("offline");
      return { token: "new", expiresInSeconds: 300 };
    });
    fixture.embed(getToken);
    fixture.message("mc.tab.ready");
    await vi.advanceTimersByTimeAsync(0);
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const before = getToken.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(getToken).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(getToken).toHaveBeenCalledTimes(before + 1);
    }
    recover = true;
    await vi.advanceTimersByTimeAsync(30000);
    recover = false;
    fixture.message("mc.token.request");
    await vi.advanceTimersByTimeAsync(0);
    const before = getToken.mock.calls.length;
    await vi.advanceTimersByTimeAsync(999);
    expect(getToken).toHaveBeenCalledTimes(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(getToken).toHaveBeenCalledTimes(before + 1);
  });

  it("disposal aborts a pending mint and ignores its eventual result", async () => {
    const fixture = host();
    let signal!: AbortSignal;
    let resolve!: (token: PluginUIToken) => void;
    const getToken = vi.fn<PluginEmbedOptions["getToken"]>(input => {
      signal = input;
      return new Promise(done => { resolve = done; });
    });
    const embed = fixture.embed(getToken);
    fixture.message("mc.tab.ready");
    await vi.advanceTimersByTimeAsync(0);
    embed.dispose();
    expect(signal.aborted).toBe(true);
    resolve({ token: "too-late", expiresInSeconds: 300 });
    fixture.message("mc.token.request");
    await vi.advanceTimersByTimeAsync(300000);
    expect(fixture.postMessage).not.toHaveBeenCalled();
    expect(getToken).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up removal at the next refresh, with optional immediate observation", async () => {
    const fixture = host();
    const getToken = vi.fn<PluginEmbedOptions["getToken"]>(async () => ({ token: "initial", expiresInSeconds: 35 }));
    fixture.embed(getToken);
    fixture.message("mc.tab.ready");
    await vi.advanceTimersByTimeAsync(0);
    const signal = getToken.mock.calls[0][0];
    fixture.iframe.isConnected = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(getToken).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(true);

    const observed = host();
    let removed!: () => void;
    const disconnect = vi.fn();
    vi.stubGlobal("MutationObserver", class {
      constructor(callback: () => void) { removed = callback; }
      observe() {}
      disconnect = disconnect;
    });
    observed.embed(getToken, { observeRemoval: true });
    observed.iframe.isConnected = false;
    removed();
    expect(disconnect).toHaveBeenCalledOnce();
    observed.message("mc.tab.ready");
    await vi.advanceTimersByTimeAsync(0);
    expect(getToken).toHaveBeenCalledOnce();
  });
});
