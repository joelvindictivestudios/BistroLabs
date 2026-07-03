import type { IntentResult, RestaurantConfig } from "./types";

export type EscalationDecision =
  | { escalate: false }
  | { escalate: true; reason: string };

/**
 * Körs FÖRE svarsgenereringen. Klagomål, osäker klassificering och stora
 * sällskap ska till en människa — inget AI-utkast genereras då.
 */
export function preGenerationCheck(
  intent: IntentResult,
  config: RestaurantConfig,
): EscalationDecision {
  if (intent.intent === "COMPLAINT") {
    return { escalate: true, reason: "Klagomål hanteras alltid manuellt" };
  }
  if (intent.confidence < config.confidenceThreshold) {
    return {
      escalate: true,
      reason: `Låg intent-confidence (${intent.confidence.toFixed(2)} < ${config.confidenceThreshold})`,
    };
  }
  if (
    intent.extracted.partySize !== undefined &&
    intent.extracted.partySize > config.escalationPartySize
  ) {
    return {
      escalate: true,
      reason: `Sällskap om ${intent.extracted.partySize} > gränsen ${config.escalationPartySize} — hanteras manuellt`,
    };
  }
  return { escalate: false };
}
