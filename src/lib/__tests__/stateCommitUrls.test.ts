import { describe, it, expect } from "vitest";
import {
  orderStateCommitUrls,
  type CachedInfoRefs,
} from "@/lib/git-grasp-pool/state-event";

const ANNOUNCED = "cae7406a8e136106681c48fb6f2fbf01b00c6eb4";
const NEWER = "18deedb7543f79c0f6db7d740090441812d157c3";

/** Build a peekInfoRefs stub from a url -> advertised HEAD map. */
function refs(
  heads: Record<string, string | null>,
): (url: string) => CachedInfoRefs | undefined {
  return (url: string): CachedInfoRefs | undefined => {
    if (!(url in heads)) return undefined;
    const head = heads[url];
    if (head === null) return { symrefs: {}, refs: {} };
    return {
      symrefs: { HEAD: "refs/heads/master" },
      refs: { "refs/heads/master": head },
    };
  };
}

describe("orderStateCommitUrls", () => {
  it("puts a server whose HEAD matches the announced commit first", () => {
    const peek = refs({
      "https://behind.example": NEWER,
      "https://agreeing.example": ANNOUNCED,
    });

    expect(
      orderStateCommitUrls(
        ["https://behind.example", "https://agreeing.example"],
        ANNOUNCED,
        peek,
      ),
    ).toEqual(["https://agreeing.example", "https://behind.example"]);
  });

  it("keeps a server whose HEAD has moved on, because the announced commit is still an ancestor it can serve by SHA", () => {
    // Regression: this server used to be filtered out entirely, so a maintainer's
    // older announcement was reported as "not found on any git server" even though
    // the objects were present and fetchable by hash.
    const peek = refs({ "https://moved-on.example": NEWER });

    expect(
      orderStateCommitUrls(["https://moved-on.example"], ANNOUNCED, peek),
    ).toEqual(["https://moved-on.example"]);
  });

  it("keeps servers with no cached infoRefs", () => {
    const peek = refs({});

    expect(
      orderStateCommitUrls(["https://unknown.example"], ANNOUNCED, peek),
    ).toEqual(["https://unknown.example"]);
  });

  it("keeps servers whose cached infoRefs advertise no HEAD at all", () => {
    const peek = refs({ "https://empty.example": null });

    expect(
      orderStateCommitUrls(["https://empty.example"], ANNOUNCED, peek),
    ).toEqual(["https://empty.example"]);
  });

  it("falls back to the first advertised ref when HEAD is not a symref", () => {
    const peek = (): CachedInfoRefs => ({
      symrefs: {},
      refs: { "refs/heads/main": ANNOUNCED },
    });

    expect(
      orderStateCommitUrls(["https://plain.example"], ANNOUNCED, peek),
    ).toEqual(["https://plain.example"]);
  });

  it("matches on a shared prefix in either direction", () => {
    const peek = refs({ "https://short.example": ANNOUNCED.slice(0, 12) });

    expect(
      orderStateCommitUrls(["https://short.example"], ANNOUNCED, peek),
    ).toEqual(["https://short.example"]);
  });

  it("returns an empty list for no servers", () => {
    expect(orderStateCommitUrls([], ANNOUNCED, refs({}))).toEqual([]);
  });

  it("preserves the input order within each group", () => {
    const peek = refs({
      "https://a.example": NEWER,
      "https://b.example": ANNOUNCED,
      "https://c.example": NEWER,
      "https://d.example": ANNOUNCED,
    });

    expect(
      orderStateCommitUrls(
        [
          "https://a.example",
          "https://b.example",
          "https://c.example",
          "https://d.example",
        ],
        ANNOUNCED,
        peek,
      ),
    ).toEqual([
      "https://b.example",
      "https://d.example",
      "https://a.example",
      "https://c.example",
    ]);
  });
});
