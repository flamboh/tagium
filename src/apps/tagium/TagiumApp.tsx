import { useLayoutEffect } from "react";
import { DevPanel } from "@/components/dev/DevPanel";
import AudioTagger from "@/features/workspace/audioTagger";
import { useDisplayedLocale } from "@/i18n/i18n";

export default function TagiumApp() {
  const locale = useDisplayedLocale();

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <>
      <AudioTagger />
      <DevPanel appId="tagium" />
    </>
  );
}
