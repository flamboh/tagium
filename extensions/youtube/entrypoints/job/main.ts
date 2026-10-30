import { browser } from "wxt/browser";
import { isRequest } from "../../../../src/shared/youtube-extension/protocol";
import { acquireAudio } from "../../lib/acquire";
import "./style.css";

const status = document.querySelector<HTMLParagraphElement>("#status")!;

const start = document.querySelector<HTMLButtonElement>("#start")!;

const cancel = document.querySelector<HTMLButtonElement>("#cancel")!;

const port = browser.runtime.connect({ name: "tagium-job" });

const controller = new AbortController();

const id = location.hash.slice(1);

let videoId: string | undefined;

let sequence = 0;

let completed = false;

let acknowledge: (() => void) | undefined;

const heartbeat = setInterval(() => port.postMessage({ type: "ready", id }), 20_000);

port.onMessage.addListener((message: unknown) => {
  if (!isRequest(message) || message.id !== id) return;

  if (message.type === "start") {
    videoId = message.videoId;
    document.querySelector("#video")!.textContent = `video: ${videoId}`;
    status.textContent = "waiting for your approval";
    start.disabled = false;
  } else if (message.type === "ack" && message.sequence === sequence) {
    acknowledge?.();
  }
});

port.onDisconnect.addListener(() => {
  clearInterval(heartbeat);
  controller.abort();
  start.disabled = true;
  cancel.disabled = true;

  if (!completed) status.textContent = "disconnected. return to tagium to retry.";
});

cancel.onclick = () => {
  clearInterval(heartbeat);
  completed = true;
  controller.abort();
  port.postMessage({ type: "error", id, message: "extension download canceled.", canceled: true });
  status.textContent = "canceled. return to tagium.";
};

start.onclick = async () => {
  if (!videoId || start.disabled) return;
  start.disabled = true;
  status.textContent = "resolving anonymous youtube audio…";

  try {
    let transferred = 0;

    const result = await acquireAudio(videoId, controller.signal, async (chunk) => {
      let binary = "";

      for (const byte of chunk) binary += String.fromCharCode(byte);
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", abort);
          acknowledge = undefined;
        };

        const abort = () => {
          cleanup();
          reject(new Error("download canceled."));
        };

        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("tagium stopped receiving audio."));
        }, 30_000);

        acknowledge = () => {
          cleanup();
          resolve();
        };

        controller.signal.addEventListener("abort", abort, { once: true });

        if (controller.signal.aborted) {
          abort();

          return;
        }

        port.postMessage({ type: "chunk", id, sequence, data: btoa(binary) });
      });
      sequence += 1;
      transferred += chunk.length;
      status.textContent = `sending audio to tagium · ${(transferred / 1024 / 1024).toFixed(1)} mb`;
    });

    completed = true;
    clearInterval(heartbeat);
    port.postMessage({ type: "complete", id, ...result });
    status.textContent = "audio sent. return to tagium to finish processing.";
  } catch (error) {
    if (controller.signal.aborted) return;
    completed = true;
    clearInterval(heartbeat);

    const message =
      error instanceof Error && !/https?:\/\//i.test(error.message)
        ? error.message.slice(0, 500)
        : "youtube extraction failed. return to tagium to try the server or upload a file.";

    status.textContent = message;
    port.postMessage({ type: "error", id, message });
  }
};
