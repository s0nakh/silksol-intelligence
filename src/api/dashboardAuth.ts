import { safeEqual } from "./auth";

// Optional HTTP Basic auth for the dashboard in corporate deployments:
//   SILKSOL_DASHBOARD_USER=ops  SILKSOL_DASHBOARD_PASSWORD=<secret>
// Unset = public demo. Put SSO (OIDC via the customer's IdP or Keycloak) in front for production.

export function dashboardAuthResponse(
  request: Request,
  env: Record<string, string | undefined>,
): Response | null {
  const user = env["SILKSOL_DASHBOARD_USER"];
  const password = env["SILKSOL_DASHBOARD_PASSWORD"];
  if (!user || !password) return null;
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const [u, ...rest] = atob(header.slice(6)).split(":");
      if (safeEqual(u ?? "", user) && safeEqual(rest.join(":"), password)) return null;
    } catch {
      // Malformed header — fall through to the challenge.
    }
  }
  return new Response("Authentication required", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="SilkSol Intelligence", charset="UTF-8"' },
  });
}
