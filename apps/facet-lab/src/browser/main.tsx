import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./app.css";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Facet Lab root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
