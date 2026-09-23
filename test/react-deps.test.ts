import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe("react entry point dependencies", () => {
  it("requires the same react-query peer range as Clicky", () => {
    const sdk = readJson(new URL("../package.json", import.meta.url).pathname);
    const clicky = readJson(
      new URL("../node_modules/@flanksource/clicky-ui/package.json", import.meta.url).pathname,
    );

    expect(sdk.peerDependencies["@tanstack/react-query"]).toBe(
      clicky.peerDependencies["@tanstack/react-query"],
    );
  });
});
