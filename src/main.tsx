import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initializeAnalytics } from "./analytics";
import AppRoot from "./runtime/AppRoot";
import { getAppTitle, resolveApp } from "./runtime/resolveApp";
import "./index.css";

const appId = resolveApp(window.location);
initializeAnalytics(appId);
document.title = getAppTitle(appId);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRoot appId={appId} />
  </StrictMode>,
);
