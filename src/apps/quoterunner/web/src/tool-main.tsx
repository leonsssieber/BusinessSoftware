import "./theme.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ListTool } from "./pages/ListTool";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ListTool />
  </StrictMode>,
);
