/**
 * Static commerce catalog. Owned by the commerce domain (Wave 2).
 *
 * Prices are stored as integer MIST strings (1 SUI = 1_000_000_000 MIST) so
 * they can be consumed by BigInt arithmetic without floating-point drift.
 * Merchant addresses are null in simulation mode; Wave 3 resolves a real
 * testnet address from NEXT_PUBLIC_MERCHANT_ADDRESS at payment time.
 */

export interface CatalogItem {
  id: string;
  name: string;
  aliases: string[];
  priceMist: string;
}

export interface CatalogMerchant {
  id: string;
  name: string;
  aliases: string[];
  address: string | null;
  items: CatalogItem[];
}

export interface Catalog {
  merchants: CatalogMerchant[];
}

const SUI = 1_000_000_000n;

const CATALOG: Catalog = {
  merchants: [
    {
      id: "river-cafe",
      name: "River Cafe",
      aliases: ["river cafe", "river café", "rivercafe"],
      address: null,
      items: [
        {
          id: "iced-coffee",
          name: "Iced Coffee",
          aliases: ["iced coffee", "iced coffees", "ice coffee", "cold coffee"],
          priceMist: (3n * SUI).toString(),
        },
        {
          id: "latte",
          name: "Latte",
          aliases: ["latte", "lattes", "cafe latte", "café latte"],
          priceMist: (4n * SUI).toString(),
        },
        {
          id: "espresso",
          name: "Espresso",
          aliases: ["espresso", "espressos", "double espresso"],
          priceMist: (2n * SUI).toString(),
        },
      ],
    },
    {
      id: "harbor-bakery",
      name: "Harbor Bakery",
      aliases: ["harbor bakery", "harbour bakery", "harborbake"],
      address: null,
      items: [
        {
          id: "croissant",
          name: "Croissant",
          aliases: ["croissant", "croissants", "butter croissant"],
          priceMist: (2n * SUI).toString(),
        },
      ],
    },
  ],
};

/** Return the static catalog. Pure and deterministic. */
export function getCatalog(): Catalog {
  return CATALOG;
}
