import { defineContentScript } from "wxt/utils/define-content-script";
import { browser, type Browser } from "wxt/browser";
import {
  EXTENSION_CHANNEL,
  isAppOrigin,
  isRequest,
} from "../../../src/shared/youtube-extension/protocol";

export default defineContentScript({
  matches:
    import.meta.env.MODE === "development"
      ? ["https://tagium.app/*", "http://localhost/*"]
      : ["https://tagium.app/*"],
  runAt: "document_start",
  main(ctx) {
    if (
      window.top !== window ||
      !isAppOrigin(location.origin, import.meta.env.MODE === "development")
    )
      return;
    let port: Browser.runtime.Port | undefined;
    let activeId: string | undefined;

    const reply = (payload: unknown) => {
      window.postMessage(
        { channel: EXTENSION_CHANNEL, direction: "extension", payload },
        location.origin,
      );
    };

    const connect = () => {
      if (port) return port;
      port = browser.runtime.connect({ name: EXTENSION_CHANNEL });
      port.onMessage.addListener((payload) => {
        if (payload.type === "complete" || payload.type === "error") activeId = undefined;
        reply(payload);
      });
      port.onDisconnect.addListener(() => {
        port = undefined;

        if (activeId)
          reply({
            type: "error",
            id: activeId,
            message: "extension disconnected. reconnect to retry.",
          });
        activeId = undefined;
      });

      return port;
    };

    ctx.addEventListener(window, "message", (event) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.channel !== EXTENSION_CHANNEL ||
        event.data.direction !== "app" ||
        !isRequest(event.data.payload)
      )
        return;

      const request = event.data.payload;

      if (request.type === "start") activeId = request.id;

      if (request.type === "cancel" && activeId === request.id) activeId = undefined;

      try {
        connect().postMessage(request);
      } catch {
        reply({
          type: "error",
          id: request.id,
          message: "extension unavailable. reload tagium to reconnect.",
        });
        port?.disconnect();
        port = undefined;
      }
    });
    ctx.onInvalidated(() => port?.disconnect());
    ctx.addEventListener(window, "pagehide", () => port?.disconnect());
  },
});
