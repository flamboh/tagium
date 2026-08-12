import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { FloatingLabelInput, FloatingLabelTextarea } from "@/components/ui/floating-label-field";

describe("floating label fields", () => {
  it("keeps a persistent label associated with a larger input", () => {
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
    expect(markup.indexOf('id="track-title"')).toBeLessThan(markup.indexOf("<label"));
  });

  it("uses the same label treatment for multiline metadata", () => {
    const markup = renderToStaticMarkup(
      <FloatingLabelTextarea id="track-comment" label="comment" placeholder="add a comment" />,
    );

    expect(markup).toContain('<textarea id="track-comment"');
    expect(markup).toContain('placeholder="add a comment"');
    expect(markup).toContain('<label for="track-comment"');
  });
});
