import { describe, it, expect } from "vitest";
import { matchRoute, type Route } from "../src/routes/router.js";

const routes: readonly Route[] = [
  { method: "GET", path: "/health", handler: (() => {}) as never },
  { method: "GET", path: "/api/v1/users/:id", handler: (() => {}) as never },
];

describe("matchRoute", () => {
  it("matches exact path", () => {
    const result = matchRoute(routes, "GET", "/health");
    expect(result).toBeDefined();
    expect(result?.route.path).toBe("/health");
  });

  it("matches parameterized path", () => {
    const result = matchRoute(routes, "GET", "/api/v1/users/abc-123");
    expect(result).toBeDefined();
    expect(result?.params["id"]).toBe("abc-123");
  });

  it("returns undefined for unknown path", () => {
    const result = matchRoute(routes, "GET", "/unknown");
    expect(result).toBeUndefined();
  });

  it("returns undefined for wrong method", () => {
    const result = matchRoute(routes, "POST", "/health");
    expect(result).toBeUndefined();
  });

  it("strips query string", () => {
    const result = matchRoute(routes, "GET", "/health?foo=bar");
    expect(result).toBeDefined();
  });
});
