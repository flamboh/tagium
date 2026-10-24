import { defineBackground } from "wxt/utils/define-background";
import { browser, type Browser } from "wxt/browser";
import {
  EXTENSION_CHANNEL,
  JOB_TIMEOUT_MS,
  isAppOrigin,
  isRequest,
  isReply,
} from "../../../src/shared/youtube-extension/protocol";

type ActiveJob = {
  id: string;
  videoId: string;
  app: Browser.runtime.Port;
  job?: Browser.runtime.Port;
  tabId?: number;
  timer: ReturnType<typeof setTimeout>;
};

export default defineBackground(() => {
  let active: ActiveJob | undefined;

  const finish = (closeTab = false) => {
    if (!active) return;
    const job = active;
    active = undefined;
    clearTimeout(job.timer);
    job.job?.disconnect();

    if (closeTab && job.tabId !== undefined)
      void browser.tabs.remove(job.tabId).catch(() => undefined);
  };

  const fail = (message: string, canceled = false) => {
    if (!active) return;
    active.app.postMessage({ type: "error", id: active.id, message, canceled });
    finish();
  };

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === "tagium-job") {
      if (
        !active ||
        active.job ||
        port.sender?.tab?.id !== active.tabId ||
        port.sender?.url !== browser.runtime.getURL(`/job.html#${active.id}`)
      ) {
        port.disconnect();

        return;
      }

      active.job = port;
      port.postMessage({ type: "start", id: active.id, videoId: active.videoId });
      port.onMessage.addListener((message: unknown) => {
        if (!active || active.job !== port || !isReply(message) || message.id !== active.id) return;
        active.app.postMessage(message);

        if (message.type === "complete" || message.type === "error") finish();
      });
      port.onDisconnect.addListener(() => {
        if (active?.job === port) fail("extension download tab closed or disconnected.", true);
      });

      return;
    }

    if (
      port.name !== EXTENSION_CHANNEL ||
      port.sender?.frameId !== 0 ||
      !port.sender.url ||
      !isAppOrigin(new URL(port.sender.url).origin, import.meta.env.MODE === "development")
    ) {
      port.disconnect();

      return;
    }

    port.onMessage.addListener(async (message: unknown) => {
      if (!isRequest(message)) return;

      if (message.type === "ping") {
        port.postMessage({ type: "ready", id: message.id });
      } else if (message.type === "start") {
        if (active) {
          port.postMessage({
            type: "error",
            id: message.id,
            message: "another extension download is active.",
          });

          return;
        }

        const job: ActiveJob = {
          id: message.id,
          videoId: message.videoId,
          app: port,
          timer: setTimeout(() => fail("extension download timed out."), JOB_TIMEOUT_MS),
        };

        active = job;

        try {
          const tab = await browser.tabs.create({ url: "about:blank" });

          if (active === job && tab.id !== undefined) {
            job.tabId = tab.id;
            await browser.tabs.update(tab.id, {
              url: browser.runtime.getURL(`/job.html#${message.id}`),
            });
          } else if (tab.id !== undefined) {
            await browser.tabs.remove(tab.id);
          }
        } catch {
          if (active === job) fail("could not open the extension download tab.");
        }
      } else if (active?.app === port && active.id === message.id) {
        if (message.type === "cancel") finish(true);
        else active.job?.postMessage(message);
      }
    });
    port.onDisconnect.addListener(() => {
      if (active?.app === port) finish(true);
    });
  });
});
