import { useMessages } from "gt-react";

export function TranslatedText({ children }: { children: string }) {
  const m = useMessages();

  return m(children);
}
