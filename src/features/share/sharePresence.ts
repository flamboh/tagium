import { Option, Schema } from "effect";

const CHANNEL_NAME = "tagium-workspace-presence-v1";
const TAB_ID = crypto.randomUUID();

const presenceMessageSchema = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  from: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(Schema.String),
});

const decodePresenceMessage = (event: MessageEvent) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(presenceMessageSchema)(event.data));

export const watchForAnotherTagiumTab = (onFound: () => void) => {
  if (!globalThis.BroadcastChannel) return () => undefined;
  const channel = new globalThis.BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    const message = decodePresenceMessage(event);
    if (message?.type !== "present" || !message.from || message.from === TAB_ID) return;
    if (message.to !== undefined && message.to !== TAB_ID) return;
    channel.close();
    onFound();
  };
  channel.postMessage({ type: "presence?", from: TAB_ID });
  return () => channel.close();
};

export const listenForTagiumPresence = () => {
  if (!globalThis.BroadcastChannel) return () => undefined;
  const channel = new globalThis.BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    const message = decodePresenceMessage(event);
    if (message?.type === "presence?" && message.from && message.from !== TAB_ID) {
      channel.postMessage({ type: "present", from: TAB_ID, to: message.from });
    }
  };
  channel.postMessage({ type: "present", from: TAB_ID });
  return () => channel.close();
};
