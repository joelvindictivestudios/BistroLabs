import { prisma } from "../db/client";
import type { RestaurantConfig } from "../email-concierge/types";

export type CoreFactsStatus = {
  complete: boolean;
  hasAddress: boolean;
  hasOpeningHours: boolean;
  documentCount: number;
};

/**
 * Gating för Bokningsassistenten: AI:n ska inte gå live på telefon innan
 * den vet var restaurangen ligger, när den har öppet och kan något om den.
 * Används av hubben, assistant-UI:t och phone-number-API:t.
 */
export async function getCoreFactsStatus(
  restaurantId: string,
  config: RestaurantConfig,
): Promise<CoreFactsStatus> {
  const hasAddress = config.address.trim().length > 0;
  const hasOpeningHours = Object.values(config.openingHours).some(
    (ranges) => ranges.length > 0,
  );
  const documentCount = await prisma.knowledgeDocument.count({
    where: { restaurantId },
  });
  return {
    complete: hasAddress && hasOpeningHours && documentCount > 0,
    hasAddress,
    hasOpeningHours,
    documentCount,
  };
}
