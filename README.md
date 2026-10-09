<p align="center"><img src="./Solana%20Colloseum/SilkSol%20AI%20Logo.jpg" alt="SilkSol Intelligence logo" width="180"/></p>

<h1 align="center">🚢 SilkSol Intelligence ⚓️</h1>

<p align="center">
  <em>B2B Corridor Risk Intelligence for Middle Corridor (TITR / ТМТМ) logistics — predictive delay risk, SLA monitoring and verifiable Proof of Delay</em>
</p>

<p align="center">
  <b>English</b> · <a href="#-русский">Русский</a> · <a href="#-қазақша">Қазақша</a>
</p>

---

## 💡 Executive Summary

Forwarders, cargo owners and insurers on the Trans-Caspian route constantly argue about *why* a container is late: the forwarder blames the port, the port blames the weather, the weather blames customs. SilkSol Intelligence is an independent **single source of truth**:

1. **Predictive Risk Index** — an ML engine forecasts the probability that a shipment arrives later than its contractual ETA, with a probabilistic ETA (P10–P90) 3–7 days ahead.
2. **SLA Violation Monitor** — tracks port, roadstead and rail dwell time at every checkpoint against the thresholds agreed in the contract, and predicts upcoming breaches.
3. **Cryptographic Audit Trail** (ProofPilot spec) — every gate event, AIS anchoring, storm closure and SLA breach is written to a SHA-256 hash-chained ledger, one chain per cargo.
4. **Verifiable Delay Report ("Passport of Delay")** — a self-contained, hash-sealed evidence bundle (weather, AIS positions, dwell events, full audit chain) that anyone can re-verify — for forwarders and insurance partners.

It sells **analytics and decision support** (B2B SaaS for forwarders, pay-per-call risk scoring API for insurers) — no payments, custody, tokens or insurance products.

---

## 🏗 Architecture

```text
 Marine AIS (Aktau · Kuryk · Baku/Alat)   Caspian weather (Open-Meteo / Kazhydromet)   Rail & port dwell (GPS/IoT, CMR/SMGS)
          services/telemetry/ais.ts          services/telemetry/weather.ts               services/telemetry/railPortDwell.ts
                         └──────────────────────────────┬──────────────────────────────────────┘
                                                        ▼  CorridorSnapshot (provenance on every feed)
                 ╔══════════════════════════════════════════════════════════════════╗
                 ║ services/ml/riskEngine.ts — isolated inference service           ║
                 ║  • features: weather severity · roadstead queue density ·        ║
                 ║    seasonal dwell index · rail load · customs hold · closure     ║
                 ║  • node disruption classifier (logistic) → 72 h risk curve       ║
                 ║  • Weibull proportional-hazards dwell model + Monte Carlo        ║
                 ║    → Predictive Risk Index, ETA drift, P10–P90 ETA               ║
                 ║  • bottleneck warnings with reason codes                         ║
                 ╚══════════════════════════════════════════════════════════════════╝
                         │                         │                          │
                         ▼                         ▼                          ▼
          services/sla/slaMonitor.ts   services/ledger/* (SHA-256 chain)   services/reports/delayReport.ts
                         └─────────────────────────┴──────────────────────────┘
                                                   ▼
                        React dashboard (TanStack Start · Tailwind · Recharts) · i18n EN / RU / KK
```

Details: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

---

## ✨ Features

- **Predictive Risk Index (0–100%)** per shipment and container-weighted for the corridor; ETA drift and P10–P90 ETA band; per-feature explanation of the risk drivers.
- **Delay-risk chart** for the cargo's current node over the next 72 h (e.g. Aktau closed by a storm now, recovering as it passes).
- **SLA Violation Monitor** — actual vs. threshold dwell per checkpoint, warnings at 80%, predicted breach probability for the current node.
- **Caspian hydrometeorology** — wind, gusts, wave height, storm alerts; ports close for ferries/ro-ro above 15 m/s sustained wind.
- **Marine AIS** — simulated Caspian fleet with roadstead queues; live adapter for any AIS provider via a proxy.
- **Cryptographic audit trail** — per-cargo SHA-256 chain, ledger root over all chain heads, one-click re-verification; tampering, deletion or reordering is detected.
- **Passport of Delay** — delay attribution (storm closure / port queue / rail border / terminal handling), evidence tables, sources with provenance, integrity check and JSON export; issuing it anchors the report hash in the cargo's chain.
- **Three languages** — English, Russian, Kazakh with an EN | RU | KK switcher in the header (choice remembered per browser).

### Honesty labels (ProofPilot rules)

Every number carries its provenance: `SIMULATED` / `LIVE` tags in the UI and a `provenance` record (`source`, `mode`, `retrievedAt`) on every feed and ledger event. The risk model is a **baseline with expert-set coefficients** over synthetic seasonal baselines — see `MODEL_CARD` in `riskEngine.ts`. It must be trained on historical dwell data (CatBoost / survival analysis) before its scores are used commercially.

---

## 📡 Data feeds

| Feed | Default | Live option |
|---|---|---|
| Caspian weather | Scripted storm replay | `VITE_WEATHER_MODE=live` → Open-Meteo forecast + marine API (free, no key) |
| Marine AIS | Simulated fleet (18 vessels) | `VITE_AIS_MODE=live` + `VITE_AIS_API_URL` → proxy returning `RawAisPosition[]` (MarineTraffic, Spire, VesselFinder, AISStream…) |
| Rail & port dwell | Scripted CMR/SMGS replay | Forwarder GPS/IoT trackers (adapter to `DwellTimeline`) |

Each live feed falls back to simulation if it is unreachable. See [`.env.example`](./.env.example).

---

## 🛠 Tech Stack

React 19 · TypeScript · TanStack Start/Router · Tailwind CSS 4 · Recharts · Radix UI · Vitest · Playwright. No Web3 dependencies.

---

## 🚀 Getting Started

```bash
npm install
npm run dev          # http://localhost:8080
npm test             # unit tests: SHA-256, ledger, telemetry, ML engine, SLA, reports, locales
npm run typecheck
npm run lint
npm run build
npx playwright install chromium && npm run test:e2e
```

---

## ⚠️ Status

MVP with simulated data. Analytics and decision support only — not an insurance, legal or financial determination.

## 📜 License & Copyright

Copyright © 2026 **SilkSol / s0nakh**. All rights reserved.

---

## 🇷🇺 Русский

**SilkSol Intelligence** — B2B-платформа аналитики рисков Среднего коридора (ТМТМ). Экспедиторы, грузовладельцы и страховщики постоянно спорят, кто виноват в задержке контейнера; платформа выступает независимым источником истины:

- **Индекс предиктивного риска** — ML-движок оценивает вероятность опоздания груза относительно договорного ETA и даёт вероятностный ETA (P10–P90).
- **Монитор нарушений SLA** — фактический и прогнозный простой в портах, на рейде и на ж/д против договорных порогов.
- **Криптографический журнал аудита** (спецификация ProofPilot) — события груза связаны в цепочку SHA-256; любое изменение обнаруживается.
- **Паспорт задержки** — запечатанный хешем отчёт с данными погоды, AIS и простоев для экспедиторов и страховых партнёров; проверяется и экспортируется в JSON.
- Интерфейс на английском, русском и казахском (переключатель EN | RU | KK).

Данные по умолчанию симулированы и помечены `СИМУЛЯЦИЯ`; погода может подключаться вживую через Open-Meteo (`VITE_WEATHER_MODE=live`), AIS — через прокси провайдера. Модель риска — базовая версия с экспертными коэффициентами, её нужно обучить на исторических данных до коммерческого использования. Запуск: `npm install && npm run dev`.

Copyright © 2026 **SilkSol / s0nakh**. Все права защищены.

---

## 🇰🇿 Қазақша

**SilkSol Intelligence** — Орта дәліз (ТХКБ) логистикасына арналған B2B тәуекел аналитикасы платформасы. Контейнердің кешігуіне кім кінәлі екенін анықтауда тәуелсіз ақиқат көзі болады:

- **Болжамды тәуекел индексі** — ML қозғалтқышы жүктің келісімшарттық ETA-дан кешігу ықтималдығын бағалайды және ықтималдық ETA (P10–P90) береді.
- **SLA бұзушылық мониторы** — порттардағы, рейдтегі және темір жолдағы нақты және болжамды тұрып қалуды келісілген шектермен салыстырады.
- **Криптографиялық аудит журналы** (ProofPilot спецификациясы) — жүк оқиғалары SHA-256 тізбегімен байланысқан; кез келген өзгеріс анықталады.
- **Кідіріс паспорты** — экспедиторлар мен сақтандыру серіктестеріне арналған ауа райы, AIS және тұрып қалу деректері бар, хэшпен мөрленген есеп; тексеріледі және JSON-ға экспортталады.
- Интерфейс ағылшын, орыс және қазақ тілдерінде (EN | RU | KK ауыстырғышы).

Әдепкі деректер симуляцияланған және `СИМУЛЯЦИЯ` деп белгіленген; ауа райын Open-Meteo арқылы тікелей қосуға болады (`VITE_WEATHER_MODE=live`), AIS — провайдер проксиі арқылы. Тәуекел моделі — сарапшылық коэффициенттері бар базалық нұсқа, коммерциялық қолданар алдында тарихи деректерде оқытылуы тиіс. Іске қосу: `npm install && npm run dev`.

Copyright © 2026 **SilkSol / s0nakh**. Барлық құқықтар қорғалған.
