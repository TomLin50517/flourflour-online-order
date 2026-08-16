import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";

function lastLogEntry(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls.at(-1);
  return JSON.parse(call?.[0] as string);
}

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("masks phone numbers to the last 3 digits", () => {
    logger.info("order created", { customerPhone: "0912345678" });
    expect(lastLogEntry(logSpy)).toMatchObject({ customerPhone: "***678" });
  });

  it("fully redacts token/secret/password-like fields", () => {
    logger.info("payment attempt", {
      accessToken: "a1b2c3d4",
      cardNumber: "4242424242424242",
      hashKey: "supersecret",
    });
    expect(lastLogEntry(logSpy)).toMatchObject({
      accessToken: "[REDACTED]",
      cardNumber: "[REDACTED]",
      hashKey: "[REDACTED]",
    });
  });

  it("masks nested fields recursively", () => {
    logger.info("nested", { customer: { phone: "0987654321", name: "王小明" } });
    const entry = lastLogEntry(logSpy);
    expect(entry.customer).toMatchObject({ phone: "***321", name: "王小明" });
  });

  it("routes error and alert levels through console.error", () => {
    logger.error("boom", {});
    logger.alert("ALERT!", {});
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("emits structured JSON with level/message/time via console.warn", () => {
    logger.warn("careful", { foo: "bar" });
    const entry = lastLogEntry(warnSpy);
    expect(entry).toMatchObject({ level: "warn", message: "careful", foo: "bar" });
    expect(typeof entry.time).toBe("string");
  });
});
