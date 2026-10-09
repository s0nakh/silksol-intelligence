import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GENESIS_HASH,
  appendEntry,
  buildChain,
  ledgerRoot,
  verifyChain,
  type NewLedgerEvent,
} from "./auditLedger";
import { canonicalJson, sha256Hex } from "./sha256";

const event = (
  type: NewLedgerEvent["type"],
  occurredAt: string,
  payload: NewLedgerEvent["payload"] = {},
): NewLedgerEvent => ({
  type,
  occurredAt,
  node: "aktau",
  payload,
  provenance: { source: "test", mode: "simulated", retrievedAt: "2026-10-02T00:00:00.000Z" },
});

describe("sha256", () => {
  it("matches FIPS test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches node:crypto across block boundaries and UTF-8", () => {
    for (const text of [
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(64),
      "Ақтау → Баку · 15 м/с",
      "x".repeat(1000),
    ]) {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    }
  });

  it("canonical JSON is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [2, { x: 2, y: 1 }] }, b: 1 }),
    );
  });
});

describe("audit ledger", () => {
  const chain = buildChain("JOL-8921", [
    event("GATE_IN", "2026-10-01T00:00:00Z"),
    event("PORT_CLOSED", "2026-10-01T06:00:00Z", { windMs: 17.2 }),
    event("PORT_REOPENED", "2026-10-01T18:00:00Z", { windMs: 11 }),
  ]);

  it("links every entry to the previous hash", () => {
    expect(chain[0]!.prevHash).toBe(GENESIS_HASH);
    expect(chain[1]!.prevHash).toBe(chain[0]!.hash);
    expect(chain[2]!.prevHash).toBe(chain[1]!.hash);
    expect(verifyChain(chain)).toEqual({ valid: true, length: 3, head: chain[2]!.hash });
  });

  it("detects a tampered payload", () => {
    const tampered = chain.map((e, i) => (i === 1 ? { ...e, payload: { windMs: 12 } } : e));
    expect(verifyChain(tampered)).toMatchObject({
      valid: false,
      brokenAt: 1,
      reason: "hash_mismatch",
    });
  });

  it("detects a removed or reordered entry", () => {
    expect(verifyChain([chain[0]!, chain[2]!])).toMatchObject({
      valid: false,
      brokenAt: 1,
      reason: "sequence_gap",
    });
    const rehashedButUnlinked = appendEntry(
      [chain[0]!],
      "JOL-8921",
      event("PORT_REOPENED", "2026-10-01T18:00:00Z"),
    );
    expect(verifyChain([...rehashedButUnlinked, { ...chain[2]!, seq: 2 }])).toMatchObject({
      valid: false,
      brokenAt: 2,
      reason: "link_mismatch",
    });
  });

  it("ledger root changes when any chain head changes", () => {
    const other = buildChain("MCC-2048", [event("GATE_IN", "2026-10-01T00:00:00Z")]);
    const root = ledgerRoot({ "JOL-8921": chain, "MCC-2048": other });
    expect(root).toMatch(/^[0-9a-f]{64}$/);
    expect(ledgerRoot({ "JOL-8921": chain.slice(0, 2), "MCC-2048": other })).not.toBe(root);
  });
});
