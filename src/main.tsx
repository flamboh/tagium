import "@fontsource-variable/libre-franklin/index.css";
import "@fontsource/fragment-mono/400.css";
import "@fontsource/archivo-black/400.css";
import "@fontsource/krona-one/400.css";
import "@fontsource/anton/400.css";
import "@fontsource/rajdhani/700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initializeAnalytics } from "./analytics";
import "./index.css";

initializeAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
