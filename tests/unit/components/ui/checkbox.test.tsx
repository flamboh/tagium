import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { Checkbox } from "@/components/ui/checkbox";

describe("Checkbox", () => {
  it("prevents accidental text selection through the shared control class", () => {
    const markup = renderToStaticMarkup(<Checkbox aria-label="test checkbox" />);

    expect(markup).toContain("select-none");
  });
});
