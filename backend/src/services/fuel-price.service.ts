import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";

const PO_BASE = "https://www.petrolofisi.com.tr";

export type FuelPrices = {
  cityId: string;
  cityName: string;
  districtId: string;
  districtName: string;
  benzin: number;
  motorin: number;
  gazyagi: number | null;
  kalorifer: number | null;
  fuelOil: number | null;
  lpg: number;
  fetchedAt: Date;
  source: string;
};

let latestCache: FuelPrices | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let fetching = false;

function parseTrFloat(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function extractDistrictPrices(html: string, districtId: string): {
  districtName: string;
  prices: number[];
} | null {
  const rowRe = new RegExp(
    `<tr class="price-row[^"]*" data-disctrict-id="${districtId}"[^>]*>([\\s\\S]*?)</tr>`,
    "i"
  );
  const rowMatch = html.match(rowRe);
  if (!rowMatch) return null;

  const row = rowMatch[0];
  const nameMatch = row.match(/data-disctrict-name="([^"]+)"/i);
  const withTax = [...row.matchAll(/<span class="with-tax">([^<]+)<\/span>/gi)].map((m) =>
    parseTrFloat(m[1])
  );

  if (withTax.length < 2 || withTax.some((v, i) => i < 2 && v === null)) {
    return null;
  }

  return {
    districtName: nameMatch?.[1] || districtId,
    prices: withTax.filter((v): v is number => v !== null),
  };
}

export async function fetchIpsalaFuelPrices(): Promise<FuelPrices> {
  const cityId = config.fuelPriceCityId;
  const districtId = config.fuelPriceDistrictId;
  const cityName = config.fuelPriceCityName;

  const body = new URLSearchParams({
    template: "1",
    cityId,
    districtId,
    isBp: "false",
  });

  const res = await fetch(`${PO_BASE}/Fuel/Search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${PO_BASE}/akaryakit-fiyatlari`,
      Origin: PO_BASE,
      "User-Agent":
        "Mozilla/5.0 (compatible; MutluAkaryakit/1.0; +https://localhost)",
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Petrol Ofisi yanıt hatası: HTTP ${res.status}`);
  }

  const html = await res.text();
  if (html.trim().startsWith("{")) {
    throw new Error(`Petrol Ofisi doğrulama hatası: ${html.slice(0, 200)}`);
  }

  const parsed = extractDistrictPrices(html, districtId);
  if (!parsed || parsed.prices.length < 6) {
    throw new Error(`İpsala fiyat satırı bulunamadı (districtId=${districtId})`);
  }

  const [benzin, motorin, gazyagi, kalorifer, fuelOil, lpg] = parsed.prices;

  return {
    cityId,
    cityName,
    districtId,
    districtName: parsed.districtName,
    benzin,
    motorin,
    gazyagi: gazyagi ?? null,
    kalorifer: kalorifer ?? null,
    fuelOil: fuelOil ?? null,
    lpg,
    fetchedAt: new Date(),
    source: "petrolofisi",
  };
}

function pricesEqual(a: FuelPrices, b: FuelPrices) {
  return (
    a.benzin === b.benzin &&
    a.motorin === b.motorin &&
    a.lpg === b.lpg &&
    a.gazyagi === b.gazyagi &&
    a.kalorifer === b.kalorifer &&
    a.fuelOil === b.fuelOil
  );
}

export async function refreshFuelPrices(): Promise<FuelPrices> {
  if (fetching) {
    if (latestCache) return latestCache;
    throw new Error("Fiyat çekimi devam ediyor");
  }
  fetching = true;
  try {
    const prices = await fetchIpsalaFuelPrices();
    const prev = latestCache;
    latestCache = prices;

    if (!prev || !pricesEqual(prev, prices)) {
      await prisma.fuelPriceSnapshot.create({
        data: {
          cityId: prices.cityId,
          cityName: prices.cityName,
          districtId: prices.districtId,
          districtName: prices.districtName,
          benzin: prices.benzin,
          motorin: prices.motorin,
          gazyagi: prices.gazyagi,
          kalorifer: prices.kalorifer,
          fuelOil: prices.fuelOil,
          lpg: prices.lpg,
          source: prices.source,
          fetchedAt: prices.fetchedAt,
        },
      });
      console.log(
        `[fuel-prices] ${prices.districtName}: benzin=${prices.benzin} motorin=${prices.motorin} lpg=${prices.lpg}`
      );
    } else {
      // touch cache timestamp even if unchanged
      latestCache = { ...prices, fetchedAt: new Date() };
    }

    return latestCache;
  } finally {
    fetching = false;
  }
}

export async function getLatestFuelPrices(): Promise<FuelPrices | null> {
  if (latestCache) return latestCache;

  const row = await prisma.fuelPriceSnapshot.findFirst({
    where: { districtId: config.fuelPriceDistrictId },
    orderBy: { fetchedAt: "desc" },
  });
  if (!row) return null;

  latestCache = {
    cityId: row.cityId,
    cityName: row.cityName,
    districtId: row.districtId,
    districtName: row.districtName,
    benzin: row.benzin,
    motorin: row.motorin,
    gazyagi: row.gazyagi,
    kalorifer: row.kalorifer,
    fuelOil: row.fuelOil,
    lpg: row.lpg,
    fetchedAt: row.fetchedAt,
    source: row.source,
  };
  return latestCache;
}

export function startFuelPricePoller() {
  const intervalMs = config.fuelPricePollIntervalMs;
  console.log(
    `[fuel-prices] Edirne/İpsala poller her ${Math.round(intervalMs / 60000)} dk`
  );

  void refreshFuelPrices().catch((err) => {
    console.warn("[fuel-prices] ilk çekim başarısız:", err);
  });

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    void refreshFuelPrices().catch((err) => {
      console.warn("[fuel-prices] çekim hatası:", err);
    });
  }, intervalMs);
}
