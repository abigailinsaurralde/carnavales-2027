import { describe, it, expect } from "vitest";
import { loadConfig, type AppConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads with DATABASE_URL from env", () => {
    process.env["DATABASE_URL"] = "postgresql://test@localhost/test";
    process.env["PORT"] = "3000";
    const config = loadConfig();
    expect(config.databaseUrl).toBe("postgresql://test@localhost/test");
    expect(config.port).toBe(3000);
  });

  it("throws when DATABASE_URL is missing", () => {
    delete process.env["DATABASE_URL"];
    expect(() => loadConfig()).toThrow("Missing required environment variable: DATABASE_URL");
  });

  it("uses overrides", () => {
    const overrides: Partial<AppConfig> = {
      databaseUrl: "postgresql://override@localhost/override",
      port: 4000,
    };
    const config = loadConfig(overrides);
    expect(config.databaseUrl).toBe("postgresql://override@localhost/override");
    expect(config.port).toBe(4000);
  });

  it("parses CORS_ORIGINS", () => {
    process.env["DATABASE_URL"] = "postgresql://test@localhost/test";
    process.env["CORS_ORIGINS"] = "http://a.com, http://b.com";
    const config = loadConfig();
    expect(config.corsOrigins).toEqual(["http://a.com", "http://b.com"]);
    delete process.env["CORS_ORIGINS"];
  });
});
