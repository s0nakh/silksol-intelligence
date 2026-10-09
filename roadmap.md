# SilkSol Intelligence — roadmap

## Done (MVP)
- [x] Corridor dashboard (EN / RU / KK): Predictive Risk Index, P10–P90 ETA, SLA monitor, audit trail, Passport of Delay
- [x] Port-closure model calibrated on real data (Aktau, Baku stations; out-of-time backtest — `docs/BACKTEST.md`)
- [x] REST API v1 with API-key auth, access log and OpenAPI (`docs/API.md`)
- [x] Docker image, single-VM deployment (`docs/DEPLOYMENT.md`)

## Pilot (with a QazCloud corporate partner)
- [ ] Deploy in QazCloud (data stays in Kazakhstan); SSO via the partner's IdP
- [ ] Ingest the partner's dwell events (CMR / SMGS, terminal gate-in/out) and harbour-master closure logs
- [ ] Train dwell (survival) and delay (CatBoost) models on those logs; publish backtest vs. the current baseline
- [ ] Licensed data feeds: Kazhydromet / ECMWF weather, commercial AIS
- [ ] PostgreSQL for ledgers and reports; ERP / 1C export of delay reports

## Scale
- [ ] Full TITR coverage (Khorgos, Dostyk, Poti, Batumi, Alyat), rail-border queues
- [ ] Scoring API for insurers and banks
