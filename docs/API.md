# REST API v1

The dashboard and the API run the same services (`src/services`). The API is mounted by
`src/server.ts` under `/api/v1`; the machine-readable spec is served at `/api/v1/openapi.json`
(source: `src/api/openapi.ts`).

## Authentication

```bash
# .env (never committed)
SILKSOL_API_KEYS="erp-forwarder:3f9c…long-random…,insurer-x:9a1b…long-random…"
```

Send `Authorization: Bearer <key>` or `X-API-Key: <key>`. Keys are stored as SHA-256 digests in
memory and compared in constant time; the access log records the client name, never the key.
`/health` and `/openapi.json` are public. With no keys configured every other route returns 401.
`SILKSOL_API_AUTH=off` disables keys for local demos only.

Corporate deployments put SSO (OIDC — the customer's IdP or Keycloak) and rate limiting in an
API gateway / reverse proxy in front of the container.

## Endpoints

| Method | Path                                  | Purpose                                                                                                      |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GET    | `/health`                             | Liveness, version, feed mode, auth mode (public)                                                             |
| GET    | `/openapi.json`                       | OpenAPI 3.1 spec (public)                                                                                    |
| GET    | `/model`                              | Model card, closure-model coefficients, out-of-time backtest                                                 |
| GET    | `/corridor`                           | Corridor risk index, bottlenecks with reason codes, 3-day port-closure outlook, provenance                   |
| GET    | `/ports/{aktau\|kuryk\|baku}/weather` | Hourly wind / gust / waves (−48 h … +72 h) and closure outlook                                               |
| GET    | `/shipments`                          | Shipments with risk, ETA drift, status, SLA status                                                           |
| GET    | `/shipments/{id}`                     | P10–P90 ETA, risk drivers, SLA checks, expected delay cost (KZT) and options with net saving, dwell timeline |
| GET    | `/shipments/{id}/ledger`              | SHA-256 hash-chained audit trail + verification                                                              |
| POST   | `/shipments/{id}/delay-report`        | Issue a hash-sealed Passport of Delay, anchored in the ledger                                                |
| GET    | `/shipments/{id}/delay-report`        | Last issued report                                                                                           |
| POST   | `/reports/verify`                     | Re-verify any report JSON (report hash + embedded chain)                                                     |
| POST   | `/risk/closure`                       | Calibrated closure probability for `{ maxWindMs, maxGustMs }`                                                |

## Examples

```bash
KEY=…; H="Authorization: Bearer $KEY"; API=http://localhost:3000/api/v1

curl -s $API/health
curl -s -H "$H" $API/corridor | jq '.corridorRisk, .closureOutlook.aktau'
curl -s -H "$H" $API/shipments/KZL-4107 | jq '.forecast | {risk, etaP10, etaP90}'
curl -s -H "$H" -X POST $API/shipments/KZL-4107/delay-report > report.json
curl -s -H "$H" -X POST --data @report.json $API/reports/verify   # {"valid": true, …}
curl -s -H "$H" -X POST -d '{"maxWindMs":16,"maxGustMs":23}' $API/risk/closure
```

## Access log

One JSON line per request on stdout, ready for any log collector:

```json
{
  "ts": "2026-10-09T08:33:38.606Z",
  "client": "erp-forwarder",
  "method": "GET",
  "path": "/api/v1/corridor",
  "status": 200,
  "ms": 364
}
```

## State

MVP state (telemetry snapshot, audit chains, issued reports) lives in memory of one instance and
is refreshed every 15 s. The pilot moves ledgers and reports to PostgreSQL so replicas share them.
