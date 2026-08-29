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
    {
      id: "green-kitchen",
      name: "Green Kitchen",
      aliases: ["green kitchen", "greenkitchen", "green kitchens"],
      address: null,
      items: [
        {
          id: "lunch-bowl",
          name: "Lunch Bowl",
          // Plural aliases are explicit because the parser matches on
          // \b…\b word boundaries, which do not auto-pluralize. The canned
          // "Lunch bowl" example uses the singular form.
          aliases: ["lunch bowl", "lunch bowls", "grain bowl", "grain bowls"],
          // 9 SUI each: one bowl totals 9 SUI, under the displayed 12 SUI cap.
          priceMist: (9n * SUI).toString(),
        },
      ],
    },
    {
      id: "daybreak-coffee",
      name: "Daybreak Coffee",
      aliases: ["daybreak coffee", "daybreakcoffee", "daybreak"],
      address: null,
      items: [
        {
          id: "cold-brew",
          name: "Cold Brew",
          // Plural aliases are explicit (\b…\b does not match "brew" + "s").
          // The canned "Three cold brews" example uses the plural form, so
          // "cold brews" must be present or the parser fails closed with
          // unknown_item.
          aliases: ["cold brew", "cold brews", "coldbrew"],
          // 1.5 SUI each: three cold brews total 4.5 SUI, under the displayed
          // 6 SUI cap. 1.5 SUI = 1_500_000_000 MIST (exact, no float drift).
          priceMist: ((3n * SUI) / 2n).toString(),
        },
      ],
    },
  ],
};

/** Return the static catalog. Pure and deterministic. */
export function getCatalog(): Catalog {
  return CATALOG;
}
