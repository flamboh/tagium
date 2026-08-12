import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { FloatingLabelInput, FloatingLabelTextarea } from "@/components/ui/floating-label-field";

describe("floating label fields", () => {
  it("seats a persistent label inside one uninterrupted control", () => {
    const markup = renderToStaticMarkup(
      <FloatingLabelInput
        id="track-title"
        label="title"
        placeholder="Died But Came Back"
        required
      />,
    );

    expect(markup).toContain('data-slot="floating-label-field"');
    expect(markup).toContain('id="track-title"');
    expect(markup).toContain('placeholder="Died But Came Back"');
    expect(markup).toContain("h-14");
    expect(markup).toContain('<label for="track-title"');
    expect(markup).toContain("title</span>");
    expect(markup).toContain('<span class="sr-only"> required</span>');

    // The control owns the outline and the label overlays the space reserved above the value,
    // so the border is never notched or covered by a painted chip.
    expect(markup.match(/<(input|textarea|fieldset)/g)).toEqual(["<input"]);
    expect(markup).toContain("border-input");
    expect(markup).toContain("pointer-events-none");
    expect(markup).toContain("absolute");
    expect(markup).toContain("leading-tight");
    expect(markup).not.toContain("leading-none");
    expect(markup).not.toContain("bg-background");

    // The label follows the control so its focus and invalid colors can key off `peer`.
    expect(markup.indexOf('id="track-title"')).toBeLessThan(markup.indexOf("<label"));
  });

  it("uses the same label treatment for multiline metadata", () => {
    const markup = renderToStaticMarkup(
      <FloatingLabelTextarea id="track-comment" label="comment" placeholder="add a comment" />,
    );

    expect(markup).toContain('<textarea id="track-comment"');
    expect(markup).toContain('placeholder="add a comment"');
    expect(markup).toContain('<label for="track-comment"');
    expect(markup.match(/<(input|textarea|fieldset)/g)).toEqual(["<textarea"]);
    expect(markup).toContain("border-input");
    expect(markup).toContain("min-h-20");
  });
});
