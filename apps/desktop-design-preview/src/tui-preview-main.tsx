import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TuiWorkspacePreview } from "./tui-preview";
import "./styles/index.css";
import "./styles/tui-preview.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("TUI preview root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <TuiWorkspacePreview />
  </StrictMode>,
);
