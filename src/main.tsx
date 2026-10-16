import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Questionnaire from "./Questionnaire";
import { RiskAction, RiskRespond } from "./RiskPublic";
import TrainingPublic from "./TrainingPublic";
import "./styles.css";

// Personal links carry their code in the address and need no sign-in: supplier questionnaire, risk input, action update, training
const params = new URLSearchParams(window.location.search);
const questionnaire = params.get("q");
const riskRequest = params.get("r");
const riskAction = params.get("a");
const trainingLink = params.get("t");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {questionnaire ? <Questionnaire token={questionnaire} /> : riskRequest ? <RiskRespond token={riskRequest} /> : riskAction ? <RiskAction token={riskAction} /> : trainingLink ? <TrainingPublic token={trainingLink} /> : <App />}
  </StrictMode>,
);
