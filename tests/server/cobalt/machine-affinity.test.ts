import { describe, expect, it } from "vite-plus/test";
import { signCobaltMachine } from "../../../server/utils/cobalt-machine-affinity";

describe("cobalt machine affinity", () => {
  it("signs machine-bound tunnel URLs with a fixed payload vector", () => {
    expect(
      signCobaltMachine(
        { COBALT_MACHINE_AFFINITY_SECRET: "test-machine-affinity-secret" },
        "https://example.test/tunnel?b=2&a=1",
        "cobalt-machine-1",
      ),
    ).toBe("4dc08b444310acb7001482a821983ee754d4ad960f1dd3f2b6f4c22f5f68c105");
  });
});
