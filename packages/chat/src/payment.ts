/**
 * Who takes Dining Dollars (students say "Triton Dollars") versus Triton Cash.
 * HDH publishes that residential dining takes both. University Centers says most
 * of its eateries take Triton Cash, not Dining Dollars. Sunshine Market is the
 * HDH market inside Price Center, so it takes Dining Dollars and EBT.
 */

export type Tender = "dollars" | "cash" | "ebt";

/** In the prompt for every model, so a payment question is not a dish search. */
export const PAYMENT_GUIDE = `Payment, already known. Use only this. Do not invent shops.
- Dining Dollars, also called Triton Dollars: HDH dining halls (64 Degrees, Pines, OceanView, Ventanas, Canyon Vista, The Bistro, Foodworx, Restaurants at Sixth, Club Med, Goody's) and HDH markets (Sunshine, Rogers, Seventh, Sixth, Audrey's). Not at most Price Center chains.
- Triton Cash: those HDH halls and markets, plus most University Centers eateries (Panda Express, Subway, Taco Bell, Burger King, Starbucks, and the other stalls in Price Center and the Student Center).
- EBT / CalFresh: HDH markets only.
If they ask which places take one of these, or for the nearest one, action is "order", tender is "dollars", "cash", or "ebt", nearest is true when they want the closest, and item is empty.`;

const HALLS = [
  "64 Degrees",
  "Pines",
  "OceanView",
  "Ventanas",
  "Canyon Vista Marketplace",
  "The Bistro",
  "Foodworx",
  "Restaurants at Sixth College",
  "Club Med",
  "Goody's Marketplace",
];

const MARKETS = ["Sunshine Market", "Rogers Market", "Seventh Market", "Sixth Market", "Audrey's Cafe", "Goody's Marketplace"];

const CASH_ALSO = ["Panda Express", "Subway", "Taco Bell", "Burger King", "Starbucks"];

/** Campus-search names for places that take `tender`. */
export function tenderPlaces(tender: Tender): string[] {
  if (tender === "ebt") return MARKETS;
  if (tender === "cash") return [...HALLS, ...MARKETS, ...CASH_ALSO];
  return [...HALLS, ...MARKETS];
}

export function placesFor(tender: Tender): string {
  if (tender === "dollars") {
    return "Dining Dollars (Triton Dollars) work at the HDH dining halls: 64 Degrees, Pines, OceanView, Ventanas, Canyon Vista, the Bistro, Foodworx, Restaurants at Sixth, Club Med, and Goody's. They also work at the HDH markets: Sunshine, Rogers, Seventh, Sixth, and Audrey's. Most Price Center chains (Panda Express, Subway, Taco Bell, Burger King, Starbucks, and the other University Centers stalls) do not take them. Those take Triton Cash.";
  }
  if (tender === "cash") {
    return "Triton Cash works at every HDH dining hall and HDH market, and at most University Centers eateries in Price Center and the Student Center, including Panda Express, Subway, Taco Bell, Burger King, and Starbucks.";
  }
  return "EBT / CalFresh is for HDH markets only: Sunshine, Rogers, Seventh, Sixth, Audrey's, and Goody's. The dining halls do not take it.";
}

const CASH_WORDS = ["panda", "subway", "taco bell", "burger king", "starbucks", "price center", "student center"];

/** One place's tender, when the question names it. */
export function tenderFor(place: string): string | undefined {
  const q = place.toLowerCase();
  if (MARKETS.some((name) => q.includes(name.toLowerCase().split(" ")[0]) && name.toLowerCase().split(" ")[0].length > 4)) {
    return `${place} is an HDH market: Dining Dollars (Triton Dollars), Triton Cash, and EBT / CalFresh.`;
  }
  if (HALLS.some((name) => q.includes(name.toLowerCase()))) {
    return `${place} is HDH residential dining: Dining Dollars (Triton Dollars) and Triton Cash. Not EBT.`;
  }
  if (CASH_WORDS.some((name) => q.includes(name))) {
    return "That's a University Centers eatery. Most of those take Triton Cash and Grubhub, not Dining Dollars. Sunshine Market, in Price Center, is the HDH exception: Dining Dollars and EBT.";
  }
  return undefined;
}
