import { Option, Schema } from "effect";

const CHANNEL_NAME = "tagium-workspace-presence-v1";
const TAB_ID = crypto.randomUUID();

const presenceMessageSchema = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  from: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(Schema.String),
});

export const detectAnotherTagiumTab = (waitMs = 180) =>
  new Promise<boolean>((resolve) => {
    if (!globalThis.BroadcastChannel) {
      resolve(false);
      return;
    }
    const channel = new globalThis.BroadcastChannel(CHANNEL_NAME);
    let found = false;
    const finish = () => {
      channel.close();
      resolve(found);
    };
    channel.onmessage = (event) => {
      const decoded = Schema.decodeUnknownOption(presenceMessageSchema)(event.data);
      if (Option.isNone(decoded)) return;
      const message = decoded.value;
      if (message.type !== "present" || message.to !== TAB_ID || message.from === TAB_ID) return;
      found = true;
      finish();
    };
    channel.postMessage({ type: "presence?", from: TAB_ID });
    window.setTimeout(finish, waitMs);
  });

export const listenForTagiumPresence = () => {
  if (!globalThis.BroadcastChannel) return () => undefined;
  const channel = new globalThis.BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    const decoded = Schema.decodeUnknownOption(presenceMessageSchema)(event.data);
    if (Option.isNone(decoded)) return;
    const message = decoded.value;
    if (message.type === "presence?" && message.from && message.from !== TAB_ID) {
      channel.postMessage({ type: "present", from: TAB_ID, to: message.from });
    }
  };
  return () => channel.close();
};
