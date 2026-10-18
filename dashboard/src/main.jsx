import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App.jsx";
import { DataProvider } from "./state/DataContext.jsx";
import "./styles/tokens.css";
import "./styles/base.css";

// The API base URL comes from VITE_API_URL (set in .env or the environment). Defaults to the local API on port 8000.
const apiBase =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) ||
  "http://localhost:8000";

// Exposed for debugging and for the README instructions.
window.__NEXUS_API_BASE__ = apiBase;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <DataProvider>
        <App />
      </DataProvider>
    </BrowserRouter>
  </React.StrictMode>
);
