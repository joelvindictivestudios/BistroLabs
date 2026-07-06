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
export type CompanyInfoStatus = {
  complete: boolean;
  hasName: boolean;
  hasAddress: boolean;
  hasOpeningHours: boolean;
  tableCount: number;
};

/**
 * Gating för "Träna din AI": kortet på översikten är låst tills alla
 * grundläggande företagsuppgifter är ifyllda under "Ditt företag".
 */
export async function getCompanyInfoStatus(
  restaurant: { id: string; name: string },
  config: RestaurantConfig,
): Promise<CompanyInfoStatus> {
  const hasName = restaurant.name.trim().length >= 2;
  const hasAddress = config.address.trim().length > 0;
  const hasOpeningHours = Object.values(config.openingHours).some(
    (ranges) => ranges.length > 0,
  );
  const tableCount = await prisma.diningTable.count({
    where: { restaurantId: restaurant.id },
  });
  return {
    complete: hasName && hasAddress && hasOpeningHours && tableCount > 0,
    hasName,
    hasAddress,
    hasOpeningHours,
    tableCount,
  };
}

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
