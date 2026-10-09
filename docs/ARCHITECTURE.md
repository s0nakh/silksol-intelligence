# 🏗 Architecture

SilkSol Intelligence is a client-rendered analytics dashboard over an isomorphic service layer. Every service is plain TypeScript with no framework or network dependency, so the same code runs during SSR, in the browser and in unit tests — and can move behind an API later unchanged.

```text
src/
  services/
    telemetry/      corridor.ts       network model: nodes, transit times, SLA thresholds, seasonal indices
                    weather.ts        Caspian wind / waves / storm alerts (mock + Open-Meteo live)
                    ais.ts            vessel positions, roadstead queues (mock + generic AIS proxy)
                    railPortDwell.ts  checkpoint arrival/departure timelines, contractual ETA
                    index.ts          CorridorSnapshot, env config, live-with-fallback loader
    ml/riskEngine.ts                  feature pipeline, classifier, survival model, bottlenecks, MODEL_CARD
    sla/slaMonitor.ts                 dwell vs threshold per checkpoint, shipment status
    ledger/         sha256.ts         synchronous SHA-256 + canonical JSON
                    auditLedger.ts    hash-chained entries, verification, ledger root
                    cargoLedger.ts    telemetry → per-cargo audit events
    reports/delayReport.ts            Passport of Delay: attribution, evidence, seal, verification
  i18n/ + locales/{en,ru,kk}.json     typed translation keys, Aktau-time formatting
  hooks/use-corridor-intel.ts         snapshot refresh (15 s), forecast, SLA, ledgers, reports
  components/intel/                   SLA monitor, weather/bottlenecks, audit drawer, report dialog
  routes/index.tsx                    dashboard (layout and styles unchanged from the original design)
```

## 1. Telemetry

`CorridorSnapshot` = weather per Caspian port (48 h history + 72 h forecast, hourly), AIS vessels and per-port queue statistics, shipments and their dwell timelines. Every feed carries `provenance { source, mode: "simulated" | "live", retrievedAt }`.

Mock mode is deterministic (seeded PRNG) and replays a scripted scenario from a fixed epoch: a gale has closed Aktau and Kuryk and is easing, a second front reaches Baku in ~30 h, and the Alat roadstead has a backlog from an earlier closure. The server render and the browser hydrate from the same epoch; afterwards the clock advances in real time.

## 2. ML risk engine

**Features** (per node and hour): weather severity (wind, waves), roadstead queue density (anchored vessels per berth-day, projected hour by hour — growing while the port is closed, draining when open), seasonal dwell index, rail network load, customs hold, port closure.

**Model 1 — node disruption classifier.** Logistic model → delay probability of a node at a given hour; drives the 72 h risk chart and bottleneck warnings. Per-feature log-odds contributions are exposed for explainability.

**Model 2 — dwell survival model.** Weibull proportional hazards with time-varying covariates: adverse conditions lower the hazard of leaving the queue; a closed port nearly stops it. The remaining dwell at the current node is sampled conditionally on time already spent, downstream nodes and sea legs are sampled at their forecast conditions, and 400 Monte Carlo paths give:

- **Predictive Risk Index** = P(arrival > contractual ETA + 48 h tolerance)
- **ETA drift** (median lateness) and the P10–P90 ETA band
- P(current-node dwell exceeds its SLA)

`MODEL_CARD.status = "baseline"`: coefficients are expert-set over synthetic seasonal baselines. Production path: train a CatBoost classifier and a survival model (e.g. Weibull AFT / random survival forest) on historical dwell logs, then swap the coefficients behind the same interface.

## 3. SLA monitor

For every checkpoint after the origin: dwell vs contractual threshold → `ok` / `warning` (≥ 80%) / `breach`; the active checkpoint also gets a predicted dwell and status. A confirmed breach marks the shipment `sla_breach`; otherwise risk ≥ 50% marks it `at_risk`.

## 4. Cryptographic audit trail

Each cargo has its own append-only chain. An entry is `{ seq, cargoId, type, occurredAt, node, payload, provenance, prevHash }`, hashed as SHA-256 over canonical JSON (sorted keys). `verifyChain` recomputes every hash and link and reports the first broken position (`hash_mismatch`, `link_mismatch`, `sequence_gap`). The ledger root is SHA-256 over all chain heads. Per-cargo chains keep a Delay Report verifiable on its own.

## 5. Passport of Delay

`buildDelayReport` bundles delay attribution (excess dwell split into storm closure hours observed at the port vs queueing, rail border, terminal handling), the SLA evaluation, the forecast, weather observations, AIS positions, the dwell timeline and the cargo's complete audit chain, then seals it with `reportHash`. Issuing appends `REPORT_ISSUED { reportId, reportHash, ledgerHead }` to the chain. `verifyDelayReport` works on a parsed JSON export, so a forwarder or insurer can check it independently.

## 6. Internationalisation

`src/locales/{en,ru,kk}.json` share one key set (enforced by a unit test, including placeholders). `TKey` types every key path. Times are shown in corridor time (Aktau, UTC+5) with dictionary month/weekday names, so server and browser output is identical regardless of ICU data.
