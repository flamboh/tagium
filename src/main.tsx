import "@fontsource-variable/libre-franklin/index.css";
import "@fontsource/fragment-mono/400.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource-variable/archivo/standard.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
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
