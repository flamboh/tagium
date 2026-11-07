import { createElement } from "react";
import { useMessages } from "gt-react";

function TranslatedText({ children }: { children: string }) {
  const m = useMessages();

  return m(children);
}

export const translated = (message: string) => createElement(TranslatedText, null, message);
