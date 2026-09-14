import { afterEach, describe, expect, it, vi } from "vitest";
import { getStripeSync, getUncachableStripeClient } from "./stripeClient";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function configureDirectCredentials() {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_offline_validation");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_offline_validation");
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@localhost/unused");
  vi.stubEnv("REPLIT_CONNECTORS_HOSTNAME", undefined);
  vi.stubEnv("REPL_IDENTITY", undefined);
  vi.stubEnv("WEB_REPL_RENEWAL", undefined);
}

describe("portable Stripe credentials", () => {
  it("constructs a client without a Replit connection", async () => {
    configureDirectCredentials();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const client = await getUncachableStripeClient();
    expect(client.webhooks).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses webhook processing without a signing secret", async () => {
    configureDirectCredentials();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", undefined);
    await expect(getStripeSync()).rejects.toThrow("STRIPE_WEBHOOK_SECRET");
  });

  it("rejects forged webhooks before event processing", async () => {
    configureDirectCredentials();
    const sync = await getStripeSync();
    const processEvent = vi.spyOn(sync, "processEvent").mockResolvedValue(undefined);
    await expect(sync.processWebhook("{}", "invalid")).rejects.toThrow();
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("accepts a webhook signed with the configured secret", async () => {
    configureDirectCredentials();
    const client = await getUncachableStripeClient();
    const sync = await getStripeSync();
    const processEvent = vi.spyOn(sync, "processEvent").mockResolvedValue(undefined);
    const event = { id: "evt_offline", type: "customer.created", data: { object: { id: "cus_offline" } } };
    const payload = JSON.stringify(event);
    const signature = client.webhooks.generateTestHeaderString({ payload, secret: "whsec_offline_validation" });
    await sync.processWebhook(payload, signature);
    expect(processEvent).toHaveBeenCalledWith(event);
  });
});
