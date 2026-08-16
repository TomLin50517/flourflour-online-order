import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { clearLoginFailures, isLockedOut, recordLoginFailure } from "@/lib/login-guard";

describe("login-guard", () => {
  it("locks out after 5 failures within the window (IP + email)", () => {
    const ip = `1.2.3.${Math.floor(Math.random() * 255)}`;
    const email = `${randomUUID()}@test.local`;

    for (let i = 0; i < 4; i++) {
      recordLoginFailure(ip, email);
      expect(isLockedOut(ip, email)).toBe(false);
    }
    recordLoginFailure(ip, email); // 第 5 次
    expect(isLockedOut(ip, email)).toBe(true);
  });

  it("does not lock out a different email from the same IP", () => {
    const ip = `1.2.3.${Math.floor(Math.random() * 255)}`;
    const emailA = `${randomUUID()}@test.local`;
    const emailB = `${randomUUID()}@test.local`;

    for (let i = 0; i < 5; i++) recordLoginFailure(ip, emailA);
    expect(isLockedOut(ip, emailA)).toBe(true);
    expect(isLockedOut(ip, emailB)).toBe(false);
  });

  it("clearLoginFailures resets the lockout", () => {
    const ip = `1.2.3.${Math.floor(Math.random() * 255)}`;
    const email = `${randomUUID()}@test.local`;

    for (let i = 0; i < 5; i++) recordLoginFailure(ip, email);
    expect(isLockedOut(ip, email)).toBe(true);

    clearLoginFailures(ip, email);
    expect(isLockedOut(ip, email)).toBe(false);
  });
});
