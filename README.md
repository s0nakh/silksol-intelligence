<p align="center"><img src="./assets/logo.svg" alt="SilkSol Intelligence" width="420"/></p>

<h1 align="center">SilkSol Intelligence</h1>

<p align="center">
  <em>B2B Corridor Risk Intelligence for Middle Corridor (TITR / ТМТМ) logistics — predictive delay risk, SLA monitoring and verifiable Proof of Delay</em>
</p>

<p align="center">
  <b>English</b> · <a href="#-русский">Русский</a> · <a href="#-қазақша">Қазақша</a>
</p>

---

## 💡 Executive Summary

Forwarders, cargo owners and insurers on the Trans-Caspian route constantly argue about _why_ a container is late: the forwarder blames the port, the port blames the weather, the weather blames customs. SilkSol Intelligence is an independent **single source of truth**:

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
- **Cost of delay in tenge** — expected loss per shipment from the Monte Carlo forecast: storage & demurrage, wagon idle, SLA penalties, late delivery. Tariffs are demo assumptions (`src/services/economics/delayCost.ts`); a pilot plugs in the partner's contract rates.
- **What to do, with savings** — the engine re-runs the forecast for each operational lever with the same random draws (switch the departure port Aktau ↔ Kuryk, priority ferry slot, hold wagons upstream during a forecast storm) and shows net saving in ₸, risk and ETA before/after — including the options that are not worth it.
- **Three languages** — English, Russian, Kazakh with an EN | RU | KK switcher in the header (choice remembered per browser).

### Honesty labels

Every number carries its provenance: `SIMULATED` / `LIVE` tags in the UI and a `provenance` record (`source`, `mode`, `retrievedAt`) on every feed and ledger event. See `MODEL_CARD` in `riskEngine.ts` for what is calibrated and what is not.

---

## 📈 Model trained on real data

The **port-closure model** is fitted on real data and backtested out of time ([docs/BACKTEST.md](./docs/BACKTEST.md)):

- **Ground truth:** hourly weather-station observations at Aktau (UATE0) and Baku (37864). A "closure day" = sustained wind ≥ 15 m/s.
- **Train:** archived forecasts Jan 2022 – Feb 2024. **Test:** forecasts issued 1–3 days ahead, Mar 2024 – Dec 2025 (1,304 port-days, 53 closure days).

| Lead   | AUC  | Brier skill vs. climatology | Closure days caught (model) | Old fixed rule "wind > 15 m/s" |
| ------ | ---- | --------------------------- | --------------------------- | ------------------------------ |
| 1 day  | 0.88 | +0.16                       | 36% (CSI 0.24)              | 2% (CSI 0.02)                  |
| 2 days | 0.89 | +0.11                       | 32% (CSI 0.20)              | 2% (CSI 0.02)                  |
| 3 days | 0.89 | +0.08                       | 23% (CSI 0.14)              | 0%                             |

Sea-port seasonality comes from observed storm frequency 2010–2025. Dwell-time (Weibull PH) and disruption coefficients are still expert-set; they are trained on a pilot partner's dwell logs. Reproduce: `npm run data:fetch && npm run data:calibrate`.

---

## 📡 Data feeds

| Feed              | Default                      | Live option                                                                                                                     |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Caspian weather   | Scripted storm replay        | `VITE_WEATHER_MODE=live` → Open-Meteo forecast + marine API (free, no key)                                                      |
| Marine AIS        | Simulated fleet (18 vessels) | `VITE_AIS_MODE=live` + `VITE_AIS_API_URL` → proxy returning `RawAisPosition[]` (MarineTraffic, Spire, VesselFinder, AISStream…) |
| Rail & port dwell | Scripted CMR/SMGS replay     | Forwarder GPS/IoT trackers (adapter to `DwellTimeline`)                                                                         |

Each live feed falls back to simulation if it is unreachable. See [`.env.example`](./.env.example).

---

## 🛠 Tech Stack

React 19 · TypeScript · TanStack Start/Router · Tailwind CSS 4 · Recharts · Radix UI · Vitest · Playwright · Docker (Node.js 22).

---

## 🚀 Getting Started

```bash
npm install
npm run dev          # http://localhost:8080 (dashboard + API under /api/v1)
npm test             # unit tests: SHA-256, ledger, telemetry, ML engine, closure model, SLA, reports, API, locales
npm run typecheck
npm run lint
npm run build
npx playwright install chromium && npm run test:e2e
```

## 🔌 REST API & deployment

- **REST API v1** with API-key auth, JSON access log and OpenAPI 3.1 at `/api/v1/openapi.json`: corridor risk, shipments, P10–P90 ETA, SLA, audit ledger, delay reports, closure scoring — [docs/API.md](./docs/API.md).
- **Docker**: one container (dashboard + API), non-root, read-only FS, healthcheck — `docker compose up -d --build`. QazCloud target architecture: [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).
- **Compliance** (Law of RK on AI, personal-data localisation, corporate IS requirements): [docs/COMPLIANCE.md](./docs/COMPLIANCE.md).

---

## ⚠️ Status

MVP: simulated corridor scenario with optional live weather; port-closure model calibrated on real data. Analytics and decision support only — not an insurance, legal or financial determination.

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

- **Модель закрытия портов обучена на реальных данных:** наблюдения метеостанций Актау и Баку и архив прогнозов. Проверка на отложенном периоде (март 2024 – декабрь 2025, прогноз за 1–3 дня): AUC 0,88–0,89, модель ловит в 10+ раз больше штормовых дней, чем прежнее правило «ветер > 15 м/с» ([docs/BACKTEST.md](./docs/BACKTEST.md)).
- **Стоимость задержки в тенге** по каждому грузу (хранение и демередж, простой вагонов, штрафы SLA, опоздание) и **рекомендации «что делать»**: смена порта Актау ↔ Курык, приоритетная погрузка на паром, придержать вагоны на время шторма — с чистой экономией в ₸, риском и ETA до/после. Тарифы в демо условные, в пилоте — ставки партнёра.
- **REST API v1** с ключами доступа и журналом, **Docker**-образ для развёртывания в QazCloud ([docs/API.md](./docs/API.md), [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)), комплаенс РК — [docs/COMPLIANCE.md](./docs/COMPLIANCE.md).

Сценарий коридора по умолчанию симулирован и помечен `СИМУЛЯЦИЯ`; погода подключается вживую через Open-Meteo, AIS — через прокси провайдера. Модели простоя и ETA пока на экспертных коэффициентах и обучаются на данных пилотного партнёра. Запуск: `npm install && npm run dev`, Docker: `docker compose up -d --build`.

Copyright © 2026 **SilkSol / s0nakh**. Все права защищены.

---

## 🇰🇿 Қазақша

**SilkSol Intelligence** — Орта дәліз (ТХКБ) логистикасына арналған B2B тәуекел аналитикасы платформасы. Контейнердің кешігуіне кім кінәлі екенін анықтауда тәуелсіз ақиқат көзі болады:

- **Болжамды тәуекел индексі** — ML қозғалтқышы жүктің келісімшарттық ETA-дан кешігу ықтималдығын бағалайды және ықтималдық ETA (P10–P90) береді.
- **SLA бұзушылық мониторы** — порттардағы, рейдтегі және темір жолдағы нақты және болжамды тұрып қалуды келісілген шектермен салыстырады.
- **Криптографиялық аудит журналы** (ProofPilot спецификациясы) — жүк оқиғалары SHA-256 тізбегімен байланысқан; кез келген өзгеріс анықталады.
- **Кідіріс паспорты** — экспедиторлар мен сақтандыру серіктестеріне арналған ауа райы, AIS және тұрып қалу деректері бар, хэшпен мөрленген есеп; тексеріледі және JSON-ға экспортталады.
- Интерфейс ағылшын, орыс және қазақ тілдерінде (EN | RU | KK ауыстырғышы).

- **Порттың жабылу моделі нақты деректерде оқытылған:** Ақтау мен Баку метеостанцияларының бақылаулары және болжамдар мұрағаты. Кейінге қалдырылған кезеңде (2024 ж. наурыз – 2025 ж. желтоқсан, 1–3 күн бұрын) AUC 0,88–0,89 ([docs/BACKTEST.md](./docs/BACKTEST.md)).
- **REST API v1** және QazCloud-та орналастыруға арналған **Docker** бейнесі ([docs/API.md](./docs/API.md), [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)).

Дәліз сценарийі әдепкі бойынша симуляцияланған және `СИМУЛЯЦИЯ` деп белгіленген. Тұрып қалу және ETA модельдері пилоттық серіктестің деректерінде оқытылады. Іске қосу: `npm install && npm run dev`.

Copyright © 2026 **SilkSol / s0nakh**. Барлық құқықтар қорғалған.
