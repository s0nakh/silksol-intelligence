import { canonicalJson, sha256Hex } from "./sha256";

// Cryptographic audit trail (ProofPilot spec): every cargo has its own append-only event chain.
// Each entry commits to the previous entry's hash, so editing, removing or reordering any past
// event breaks every later hash. One chain per cargo keeps a Delay Report self-verifiable.

export const GENESIS_HASH = "0".repeat(64);

export type LedgerEventType =
  | "GATE_IN"
  | "GATE_OUT"
  | "RAIL_DEPARTED"
  | "RAIL_ARRIVED"
  | "VESSEL_ANCHORED"
  | "VESSEL_BERTHED"
  | "VESSEL_DEPARTED"
  | "STORM_ALERT"
  | "PORT_CLOSED"
  | "PORT_REOPENED"
  | "CUSTOMS_HOLD"
  | "CUSTOMS_CLEARED"
  | "RISK_ASSESSED"
  | "SLA_BREACH"
  | "REPORT_ISSUED";

/** Where a fact came from. ProofPilot rule: facts carry a source and a retrieval time. */
export type Provenance = { source: string; mode: "simulated" | "live"; retrievedAt: string };

export type LedgerEntryBody = {
  seq: number;
  cargoId: string;
  type: LedgerEventType;
  /** ISO-8601 time the event happened (not when it was recorded). */
  occurredAt: string;
  node: string;
  payload: Record<string, string | number | boolean>;
  provenance: Provenance;
  prevHash: string;
};

export type LedgerEntry = LedgerEntryBody & { hash: string };

export type NewLedgerEvent = Omit<LedgerEntryBody, "seq" | "cargoId" | "prevHash">;

export const hashEntry = (body: LedgerEntryBody) => sha256Hex(canonicalJson(body));

export function appendEntry(
  chain: readonly LedgerEntry[],
  cargoId: string,
  event: NewLedgerEvent,
): LedgerEntry[] {
  const prev = chain[chain.length - 1];
  const body: LedgerEntryBody = {
    ...event,
    seq: chain.length,
    cargoId,
    prevHash: prev ? prev.hash : GENESIS_HASH,
  };
  return [...chain, { ...body, hash: hashEntry(body) }];
}

export function buildChain(cargoId: string, events: readonly NewLedgerEvent[]): LedgerEntry[] {
  return events.reduce<LedgerEntry[]>((chain, e) => appendEntry(chain, cargoId, e), []);
}

export type ChainVerification =
  | { valid: true; length: number; head: string }
  | {
      valid: false;
      length: number;
      brokenAt: number;
      reason: "hash_mismatch" | "link_mismatch" | "sequence_gap";
    };

/** Recomputes every hash and link. Returns the first broken position, if any. */
export function verifyChain(chain: readonly LedgerEntry[]): ChainVerification {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < chain.length; i++) {
    const { hash, ...body } = chain[i]!;
    if (body.seq !== i)
      return { valid: false, length: chain.length, brokenAt: i, reason: "sequence_gap" };
    if (body.prevHash !== prevHash)
      return { valid: false, length: chain.length, brokenAt: i, reason: "link_mismatch" };
    if (hashEntry(body) !== hash)
      return { valid: false, length: chain.length, brokenAt: i, reason: "hash_mismatch" };
    prevHash = hash;
  }
  return { valid: true, length: chain.length, head: prevHash };
}

export const chainHead = (chain: readonly LedgerEntry[]) =>
  chain[chain.length - 1]?.hash ?? GENESIS_HASH;

/** Merkle-style commitment over all cargo chain heads — one fingerprint for the whole ledger. */
export function ledgerRoot(chains: Record<string, readonly LedgerEntry[]>): string {
  const heads = Object.keys(chains)
    .sort()
    .map((id) => `${id}:${chainHead(chains[id]!)}`);
  return sha256Hex(heads.join("\n"));
}
