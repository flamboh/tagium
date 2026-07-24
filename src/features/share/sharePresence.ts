const CHANNEL_NAME = "tagium-workspace-presence-v1";
const TAB_ID = crypto.randomUUID();

export const detectAnotherTagiumTab = (waitMs = 180) =>
  new Promise<boolean>((resolve) => {
    if (typeof BroadcastChannel === "undefined") {
      resolve(false);
      return;
    }
    const channel = new BroadcastChannel(CHANNEL_NAME);
    let found = false;
    const finish = () => {
      channel.close();
      resolve(found);
    };
    channel.onmessage = (event) => {
      const message = event.data as { type?: string; from?: string; to?: string };
      if (message.type !== "present" || message.to !== TAB_ID || message.from === TAB_ID) return;
      found = true;
      finish();
    };
    channel.postMessage({ type: "presence?", from: TAB_ID });
    window.setTimeout(finish, waitMs);
  });

export const listenForTagiumPresence = () => {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    const message = event.data as { type?: string; from?: string };
    if (message.type === "presence?" && message.from && message.from !== TAB_ID) {
      channel.postMessage({ type: "present", from: TAB_ID, to: message.from });
    }
  };
  return () => channel.close();
};
