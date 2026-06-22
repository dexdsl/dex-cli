import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { StoreProvider } from "./store";
import "./styles/fonts.css";
import "./styles/app.css";

const theme = localStorage.getItem("dx.theme") || "light";
document.documentElement.setAttribute("data-theme", theme);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>,
);
