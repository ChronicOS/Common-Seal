import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Questionnaire from "./Questionnaire";
import "./styles.css";

// A supplier's questionnaire link carries its code in the address and needs no sign-in
const questionnaire = new URLSearchParams(window.location.search).get("q");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {questionnaire ? <Questionnaire token={questionnaire} /> : <App />}
  </StrictMode>,
);
