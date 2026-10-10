import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initializeAnalytics } from "./analytics";
import { startTemporaryStorageSession } from "./apps/tagium-save/download/storage";
import AppRoot from "./runtime/AppRoot";
import { holdForFonts } from "./runtime/holdForFonts";
import { getAppTitle, resolveApp } from "./runtime/resolveApp";
import "./index.css";

holdForFonts();

const appId = resolveApp(window.location);
initializeAnalytics(appId);
if (appId === "tagium-save") void startTemporaryStorageSession();
document.title = getAppTitle(appId);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRoot appId={appId} />
  </StrictMode>,
);
