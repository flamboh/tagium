import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import AudioUpload from "./audioUpload";
import LandingScreen from "./LandingScreen";

const fileInput = (markup: string) => {
  const inputs = Array.from(markup.matchAll(/<input\b[^>]*type="file"[^>]*>/g), ([input]) => input);
  expect(inputs).toHaveLength(1);
  return inputs[0];
};

describe("upload input attributes", () => {
  it("keeps mobile MP3 uploads scoped to files instead of capture", () => {
    const inputs = [
      fileInput(renderToStaticMarkup(<AudioUpload onAudioUpload={() => {}} />)),
      fileInput(
        renderToStaticMarkup(
          <LandingScreen
            onAudioUpload={() => {}}
            onAudioDownload={() => {}}
            onSoundCloudSetDownload={() => {}}
          />,
        ),
      ),
    ];

    for (const input of inputs) {
      expect(input).toContain('accept=".mp3,audio/mpeg"');
      expect(input).toContain("multiple");
      expect(input).not.toContain("capture");
    }
  });
});
