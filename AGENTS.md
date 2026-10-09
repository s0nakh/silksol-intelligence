## Architecture

- `src/services` is framework-free and isomorphic: the dashboard runs it in the browser, the REST API (`src/api`, mounted in `src/server.ts` under `/api/v1`) runs the same code on the server.
- Keep every number traceable: feeds and ledger events carry a `provenance` record, and the UI labels simulated data.
- The port-closure model is fitted on real data by `scripts/data/*.mjs`; re-run them instead of editing `src/services/ml/caspianCalibration.json` by hand.
- Centralize reusable control styling in `src/components/ui`; this keeps interaction states aligned with the project design tokens.
- This product carries no Web3 / crypto / insurance functionality — it is analytics and decision support.
