import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Questionnaire from "./Questionnaire";
import { RiskAction, RiskRespond } from "./RiskPublic";
import "./styles.css";

// Personal links carry their code in the address and need no sign-in: supplier questionnaire, risk input, action update
const params = new URLSearchParams(window.location.search);
const questionnaire = params.get("q");
const riskRequest = params.get("r");
const riskAction = params.get("a");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {questionnaire ? <Questionnaire token={questionnaire} /> : riskRequest ? <RiskRespond token={riskRequest} /> : riskAction ? <RiskAction token={riskAction} /> : <App />}
  </StrictMode>,
);
