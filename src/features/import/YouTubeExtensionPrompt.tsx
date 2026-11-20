import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  detectYouTubeExtension,
  extensionState,
  updateExtensionState,
} from "@/features/import/youtubeExtensionBridge";

export default function YouTubeExtensionPrompt() {
  const state = useSyncExternalStore(
    extensionState.subscribe,
    extensionState.getSnapshot,
    extensionState.getSnapshot,
  );

  const [checking, setChecking] = useState(false);
  useEffect(() => {
    void detectYouTubeExtension();
  }, []);

  const connect = async () => {
    setChecking(true);
    const available = await detectYouTubeExtension();
    updateExtensionState({
      enabled: available,
      notice: available
        ? "connected for this tab. retry your youtube import and approve it in the extension tab."
        : "extension not found. load the prototype, then reload this page and connect again.",
    });
    setChecking(false);
  };

  return (
    <aside
      className="w-full max-w-md rounded-xl border bg-muted/30 p-4 text-sm"
      aria-label="youtube connection"
    >
      <p className="font-medium">
        {state.enabled ? "youtube extension connected" : "youtube blocked on the server?"}
      </p>
      <p className="mt-1 text-muted-foreground">
        use the desktop extension to try your own connection. each download asks for approval. the
        server stays available as a fallback.
      </p>
      {state.notice && (
        <p className="mt-2" role="status">
          {state.notice}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {state.enabled ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              updateExtensionState({
                enabled: false,
                notice: "future imports will use the server.",
              })
            }
          >
            use server
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={checking} onClick={() => void connect()}>
            {checking ? "checking…" : state.available ? "connect extension" : "check for extension"}
          </Button>
        )}
        <Button size="sm" variant="ghost" asChild>
          <a
            href="https://github.com/flamboh/tagium/blob/wxt-youtube-extension/docs/youtube-extension.md"
            target="_blank"
            rel="noreferrer"
          >
            install prototype
          </a>
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        unpublished prototype · desktop chrome and firefox · on mobile, use the server or upload a
        file
      </p>
    </aside>
  );
}
