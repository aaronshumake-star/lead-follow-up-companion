import { describe, expect, it } from "vitest";
import { assertSupabaseBuildEnv } from "./build-env.ts";

const validEnv = {
  VITE_SUPABASE_URL: "https://jodbktsbwinoupybmawf.supabase.co",
  VITE_SUPABASE_ANON_KEY: "sb_publishable_example",
};

describe("assertSupabaseBuildEnv", () => {
  it("accepts an intentional demo build with no Supabase values", () => {
    expect(() => assertSupabaseBuildEnv({})).not.toThrow();
  });

  it("accepts a project origin and Publishable key", () => {
    expect(() => assertSupabaseBuildEnv(validEnv)).not.toThrow();
  });

  it("rejects a REST endpoint in place of the project origin", () => {
    expect(() =>
      assertSupabaseBuildEnv({
        ...validEnv,
        VITE_SUPABASE_URL: `${validEnv.VITE_SUPABASE_URL}/rest/v1`,
      }),
    ).toThrow(/project origin/);
  });

  it("rejects partial Supabase configuration", () => {
    expect(() =>
      assertSupabaseBuildEnv({ VITE_SUPABASE_URL: validEnv.VITE_SUPABASE_URL }),
    ).toThrow(/both be set/);
  });

  it("rejects Secret and legacy keys in a browser build", () => {
    for (const key of ["sb_secret_example", "eyJlegacy-anon-key"]) {
      expect(() =>
        assertSupabaseBuildEnv({ ...validEnv, VITE_SUPABASE_ANON_KEY: key }),
      ).toThrow(/Publishable key/);
    }
  });
});
