// OpenAPI 3.1 description of REST API v1 (served at /api/v1/openapi.json).

const id = { name: "id", in: "path", required: true, schema: { type: "string" } } as const;
const ok = (description: string) => ({
  description,
  content: { "application/json": { schema: { type: "object" } } },
});
const errors = {
  "401": { $ref: "#/components/responses/Unauthorized" },
  "404": { $ref: "#/components/responses/NotFound" },
};

export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "SilkSol Intelligence API",
    version: "1.0.0",
    description:
      "Corridor risk intelligence for the Middle Corridor (TITR): delay-risk forecasts, SLA monitoring, calibrated Caspian port-closure probabilities and hash-sealed delay reports. Decision-support analytics only.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ bearerAuth: [] }, { apiKey: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: { code: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: "Missing or invalid API key",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      NotFound: {
        description: "Unknown resource",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
  paths: {
    "/health": {
      get: { summary: "Liveness and configuration", security: [], responses: { "200": ok("OK") } },
    },
    "/openapi.json": {
      get: { summary: "This document", security: [], responses: { "200": ok("OpenAPI") } },
    },
    "/model": {
      get: {
        summary: "Model card, calibration and out-of-time backtest metrics",
        responses: { "200": ok("Model card"), ...errors },
      },
    },
    "/corridor": {
      get: {
        summary:
          "Corridor risk index, bottlenecks, port-closure outlook, expected delay cost (KZT) and data provenance",
        responses: { "200": ok("Corridor summary"), ...errors },
      },
    },
    "/ports/{port}/weather": {
      get: {
        summary: "Hourly Caspian port weather (−48 h … +72 h) and closure outlook",
        parameters: [
          {
            name: "port",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["aktau", "kuryk", "baku"] },
          },
        ],
        responses: { "200": ok("Port weather"), ...errors },
      },
    },
    "/shipments": {
      get: {
        summary: "Monitored shipments with Predictive Risk Index, ETA and SLA status",
        responses: { "200": ok("Shipments"), ...errors },
      },
    },
    "/shipments/{id}": {
      get: {
        summary:
          "Shipment forecast (P10–P90 ETA, risk drivers), SLA checks, expected delay cost in KZT with recommended actions, dwell timeline",
        parameters: [id],
        responses: { "200": ok("Shipment"), ...errors },
      },
    },
    "/shipments/{id}/ledger": {
      get: {
        summary: "Hash-chained audit trail of the cargo with verification result",
        parameters: [id],
        responses: { "200": ok("Ledger"), ...errors },
      },
    },
    "/shipments/{id}/delay-report": {
      get: {
        summary: "Last issued delay report (Passport of Delay)",
        parameters: [id],
        responses: { "200": ok("Delay report"), ...errors },
      },
      post: {
        summary: "Issue a hash-sealed delay report and anchor it in the audit trail",
        parameters: [id],
        responses: { "201": ok("Delay report"), ...errors },
      },
    },
    "/reports/verify": {
      post: {
        summary: "Re-verify a delay report: report hash and embedded audit chain",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "200": ok("Verification result"), "400": ok("Invalid body"), ...errors },
      },
    },
    "/risk/closure": {
      post: {
        summary: "Calibrated port-closure probability for a day's forecast max wind and gust",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["maxWindMs", "maxGustMs"],
                properties: { maxWindMs: { type: "number" }, maxGustMs: { type: "number" } },
              },
            },
          },
        },
        responses: { "200": ok("Probability"), "400": ok("Invalid input"), ...errors },
      },
    },
  },
} as const;
