import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ArrowUpDown,
  Coins,
  Ruler,
  Thermometer,
  Shirt,
  Clock,
  HandCoins,
  Receipt,
  LocateFixed,
  Loader2,
} from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { saveCurrencyRates, loadCachedRates, isOnline } from "../lib/offline";

// ═══════════════════════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════════════════════

const CURRENCIES = [
  { code: "USD", symbol: "$", name: "US Dollar", flag: "🇺🇸" },
  { code: "EUR", symbol: "€", name: "Euro", flag: "🇪🇺" },
  { code: "GBP", symbol: "£", name: "British Pound", flag: "🇬🇧" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen", flag: "🇯🇵" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan", flag: "🇨🇳" },
  { code: "KRW", symbol: "₩", name: "Korean Won", flag: "🇰🇷" },
  { code: "INR", symbol: "₹", name: "Indian Rupee", flag: "🇮🇳" },
  { code: "CHF", symbol: "Fr", name: "Swiss Franc", flag: "🇨🇭" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar", flag: "🇨🇦" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar", flag: "🇦🇺" },
  { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar", flag: "🇳🇿" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real", flag: "🇧🇷" },
  { code: "MXN", symbol: "MX$", name: "Mexican Peso", flag: "🇲🇽" },
  { code: "ARS", symbol: "AR$", name: "Argentine Peso", flag: "🇦🇷" },
  { code: "CLP", symbol: "CL$", name: "Chilean Peso", flag: "🇨🇱" },
  { code: "COP", symbol: "CO$", name: "Colombian Peso", flag: "🇨🇴" },
  { code: "PEN", symbol: "S/", name: "Peruvian Sol", flag: "🇵🇪" },
  { code: "RUB", symbol: "₽", name: "Russian Ruble", flag: "🇷🇺" },
  { code: "TRY", symbol: "₺", name: "Turkish Lira", flag: "🇹🇷" },
  { code: "PLN", symbol: "zł", name: "Polish Zloty", flag: "🇵🇱" },
  { code: "CZK", symbol: "Kč", name: "Czech Koruna", flag: "🇨🇿" },
  { code: "HUF", symbol: "Ft", name: "Hungarian Forint", flag: "🇭🇺" },
  { code: "RON", symbol: "lei", name: "Romanian Leu", flag: "🇷🇴" },
  { code: "BGN", symbol: "лв", name: "Bulgarian Lev", flag: "🇧🇬" },
  { code: "SEK", symbol: "kr", name: "Swedish Krona", flag: "🇸🇪" },
  { code: "NOK", symbol: "kr", name: "Norwegian Krone", flag: "🇳🇴" },
  { code: "DKK", symbol: "kr", name: "Danish Krone", flag: "🇩🇰" },
  { code: "ISK", symbol: "kr", name: "Icelandic Króna", flag: "🇮🇸" },
  { code: "THB", symbol: "฿", name: "Thai Baht", flag: "🇹🇭" },
  { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah", flag: "🇮🇩" },
  { code: "MYR", symbol: "RM", name: "Malaysian Ringgit", flag: "🇲🇾" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar", flag: "🇸🇬" },
  { code: "PHP", symbol: "₱", name: "Philippine Peso", flag: "🇵🇭" },
  { code: "VND", symbol: "₫", name: "Vietnamese Dong", flag: "🇻🇳" },
  { code: "TWD", symbol: "NT$", name: "Taiwan Dollar", flag: "🇹🇼" },
  { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar", flag: "🇭🇰" },
  { code: "SAR", symbol: "﷼", name: "Saudi Riyal", flag: "🇸🇦" },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham", flag: "🇦🇪" },
  { code: "ILS", symbol: "₪", name: "Israeli Shekel", flag: "🇮🇱" },
  { code: "EGP", symbol: "E£", name: "Egyptian Pound", flag: "🇪🇬" },
  { code: "ZAR", symbol: "R", name: "South African Rand", flag: "🇿🇦" },
  { code: "NGN", symbol: "₦", name: "Nigerian Naira", flag: "🇳🇬" },
  { code: "KES", symbol: "KSh", name: "Kenyan Shilling", flag: "🇰🇪" },
  { code: "MAD", symbol: "MAD", name: "Moroccan Dirham", flag: "🇲🇦" },
];

// Country code → currency code mapping
const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", KR: "KRW", IN: "INR",
  CH: "CHF", CA: "CAD", AU: "AUD", NZ: "NZD", BR: "BRL", MX: "MXN",
  AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN", RU: "RUB", TR: "TRY",
  PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", HR: "HRK",
  SE: "SEK", NO: "NOK", DK: "DKK", IS: "ISK", TH: "THB", ID: "IDR",
  MY: "MYR", SG: "SGD", PH: "PHP", VN: "VND", TW: "TWD", HK: "HKD",
  SA: "SAR", AE: "AED", IL: "ILS", EG: "EGP", ZA: "ZAR", NG: "NGN",
  KE: "KES", MA: "MAD",
  // Eurozone
  DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", NL: "EUR", BE: "EUR",
  AT: "EUR", PT: "EUR", IE: "EUR", FI: "EUR", GR: "EUR", SK: "EUR",
  SI: "EUR", EE: "EUR", LV: "EUR", LT: "EUR", LU: "EUR", MT: "EUR",
  CY: "EUR",
};

async function detectCurrencyByLocation(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
          );
          const data = await res.json();
          const countryCode = data.countryCode;
          resolve(COUNTRY_CURRENCY[countryCode] || null);
        } catch {
          resolve(null);
        }
      },
      () => resolve(null),
      { timeout: 5000 }
    );
  });
}

const MEASURE_CATEGORIES = [
  {
    id: "length",
    labelKey: "length",
    units: [
      { code: "km", nameKey: "kilometers", factor: 1000 },
      { code: "m", nameKey: "meters", factor: 1 },
      { code: "cm", nameKey: "centimeters", factor: 0.01 },
      { code: "mm", nameKey: "millimeters", factor: 0.001 },
      { code: "mi", nameKey: "miles", factor: 1609.344 },
      { code: "yd", nameKey: "yards", factor: 0.9144 },
      { code: "ft", nameKey: "feet", factor: 0.3048 },
      { code: "in", nameKey: "inches", factor: 0.0254 },
    ],
    defaultFrom: "m",
    defaultTo: "ft",
  },
  {
    id: "weight",
    labelKey: "weight",
    units: [
      { code: "kg", nameKey: "kilograms", factor: 1 },
      { code: "g", nameKey: "grams", factor: 0.001 },
      { code: "mg", nameKey: "milligrams", factor: 0.000001 },
      { code: "lb", nameKey: "pounds", factor: 0.453592 },
      { code: "oz", nameKey: "ounces", factor: 0.0283495 },
      { code: "t", nameKey: "metricTons", factor: 1000 },
    ],
    defaultFrom: "kg",
    defaultTo: "lb",
  },
  {
    id: "volume",
    labelKey: "volume",
    units: [
      { code: "L", nameKey: "liters", factor: 1 },
      { code: "mL", nameKey: "milliliters", factor: 0.001 },
      { code: "gal", nameKey: "gallons", factor: 3.78541 },
      { code: "qt", nameKey: "quarts", factor: 0.946353 },
      { code: "pt", nameKey: "pints", factor: 0.473176 },
      { code: "cup", nameKey: "cups", factor: 0.236588 },
      { code: "floz", nameKey: "fluidOz", factor: 0.0295735 },
    ],
    defaultFrom: "L",
    defaultTo: "gal",
  },
  {
    id: "speed",
    labelKey: "speed",
    units: [
      { code: "km/h", nameKey: "km/h", factor: 1 },
      { code: "mph", nameKey: "mph", factor: 1.60934 },
      { code: "m/s", nameKey: "m/s", factor: 3.6 },
      { code: "kn", nameKey: "knots", factor: 1.852 },
    ],
    defaultFrom: "km/h",
    defaultTo: "mph",
  },
];

const TEMP_UNITS = ["C", "F", "K"] as const;

const SIZE_TABLES = {
  shoes_m: {
    labelKey: "shoesMen",
    columns: ["EU", "US", "UK"],
    rows: [
      ["39", "6.5", "6"],
      ["40", "7", "6.5"],
      ["41", "8", "7.5"],
      ["42", "8.5", "8"],
      ["43", "9.5", "9"],
      ["44", "10", "9.5"],
      ["44.5", "10.5", "10"],
      ["45", "11", "10.5"],
      ["46", "12", "11.5"],
      ["47", "13", "12.5"],
    ],
  },
  shoes_w: {
    labelKey: "shoesWomen",
    columns: ["EU", "US", "UK"],
    rows: [
      ["35", "5", "2.5"],
      ["36", "5.5", "3.5"],
      ["37", "6.5", "4"],
      ["38", "7.5", "5"],
      ["39", "8", "5.5"],
      ["40", "9", "6.5"],
      ["41", "9.5", "7"],
      ["42", "10.5", "8"],
    ],
  },
  clothing: {
    labelKey: "clothing",
    columns: ["IT/EU", "US", "UK"],
    rows: [
      ["XS — 40", "2", "6"],
      ["S — 42", "4", "8"],
      ["M — 44", "6", "10"],
      ["M — 46", "8", "12"],
      ["L — 48", "10", "14"],
      ["L — 50", "12", "16"],
      ["XL — 52", "14", "18"],
      ["XXL — 54", "16", "20"],
    ],
  },
};

const TIMEZONES = [
  { label: "🇺🇸 New York", tz: "America/New_York" },
  { label: "🇺🇸 Los Angeles", tz: "America/Los_Angeles" },
  { label: "🇺🇸 Chicago", tz: "America/Chicago" },
  { label: "🇬🇧 London", tz: "Europe/London" },
  { label: "🇫🇷 Paris", tz: "Europe/Paris" },
  { label: "🇮🇹 Rome", tz: "Europe/Rome" },
  { label: "🇩🇪 Berlin", tz: "Europe/Berlin" },
  { label: "🇪🇸 Madrid", tz: "Europe/Madrid" },
  { label: "🇷🇺 Moscow", tz: "Europe/Moscow" },
  { label: "🇹🇷 Istanbul", tz: "Europe/Istanbul" },
  { label: "🇸🇦 Riyadh", tz: "Asia/Riyadh" },
  { label: "🇦🇪 Dubai", tz: "Asia/Dubai" },
  { label: "🇮🇳 Mumbai", tz: "Asia/Kolkata" },
  { label: "🇹🇭 Bangkok", tz: "Asia/Bangkok" },
  { label: "🇨🇳 Shanghai", tz: "Asia/Shanghai" },
  { label: "🇭🇰 Hong Kong", tz: "Asia/Hong_Kong" },
  { label: "🇯🇵 Tokyo", tz: "Asia/Tokyo" },
  { label: "🇰🇷 Seoul", tz: "Asia/Seoul" },
  { label: "🇦🇺 Sydney", tz: "Australia/Sydney" },
  { label: "🇳🇿 Auckland", tz: "Pacific/Auckland" },
  { label: "🇧🇷 São Paulo", tz: "America/Sao_Paulo" },
  { label: "🇲🇽 Mexico City", tz: "America/Mexico_City" },
  { label: "🇿🇦 Johannesburg", tz: "Africa/Johannesburg" },
  { label: "🇪🇬 Cairo", tz: "Africa/Cairo" },
  { label: "🇰🇪 Nairobi", tz: "Africa/Nairobi" },
  { label: "🇮🇩 Jakarta", tz: "Asia/Jakarta" },
  { label: "🇸🇬 Singapore", tz: "Asia/Singapore" },
];

const TIP_COUNTRIES = [
  { country: "🇺🇸 USA", pct: [15, 18, 20, 25] },
  { country: "🇬🇧 UK", pct: [10, 12.5, 15] },
  { country: "🇫🇷 France", pct: [5, 10] },
  { country: "🇮🇹 Italy", pct: [5, 10] },
  { country: "🇩🇪 Germany", pct: [5, 10, 15] },
  { country: "🇪🇸 Spain", pct: [5, 10] },
  { country: "🇯🇵 Japan", pct: [0] },
  { country: "🇨🇳 China", pct: [0] },
  { country: "🇧🇷 Brazil", pct: [10] },
  { country: "🇲🇽 Mexico", pct: [10, 15] },
  { country: "🇦🇺 Australia", pct: [10] },
  { country: "🇮🇳 India", pct: [10] },
  { country: "🇹🇷 Turkey", pct: [5, 10, 15] },
  { country: "🇦🇪 UAE", pct: [10, 15] },
  { country: "🇿🇦 South Africa", pct: [10, 15] },
];

const TAX_COUNTRIES = [
  { country: "🇺🇸 USA (varies)", vat: 7.25 },
  { country: "🇬🇧 UK", vat: 20 },
  { country: "🇫🇷 France", vat: 20 },
  { country: "🇮🇹 Italy", vat: 22 },
  { country: "🇩🇪 Germany", vat: 19 },
  { country: "🇪🇸 Spain", vat: 21 },
  { country: "🇳🇱 Netherlands", vat: 21 },
  { country: "🇸🇪 Sweden", vat: 25 },
  { country: "🇳🇴 Norway", vat: 25 },
  { country: "🇩🇰 Denmark", vat: 25 },
  { country: "🇫🇮 Finland", vat: 25.5 },
  { country: "🇵🇱 Poland", vat: 23 },
  { country: "🇨🇿 Czech Republic", vat: 21 },
  { country: "🇭🇺 Hungary", vat: 27 },
  { country: "🇷🇴 Romania", vat: 19 },
  { country: "🇧🇬 Bulgaria", vat: 20 },
  { country: "🇯🇵 Japan", vat: 10 },
  { country: "🇨🇳 China", vat: 13 },
  { country: "🇮🇳 India (GST)", vat: 18 },
  { country: "🇧🇷 Brazil", vat: 17 },
  { country: "🇲🇽 Mexico", vat: 16 },
  { country: "🇦🇺 Australia (GST)", vat: 10 },
  { country: "🇨🇦 Canada (GST)", vat: 5 },
  { country: "🇦🇪 UAE", vat: 5 },
  { country: "🇸🇦 Saudi Arabia", vat: 15 },
  { country: "🇿🇦 South Africa", vat: 15 },
  { country: "🇰🇪 Kenya", vat: 16 },
  { country: "🇳🇬 Nigeria", vat: 7.5 },
  { country: "🇨🇭 Switzerland", vat: 8.1 },
  { country: "🇹🇷 Turkey", vat: 20 },
];

// ═══════════════════════════════════════════════════════════════════════════

type TabType = "currency" | "units" | "temperature" | "sizes" | "timezone" | "tip" | "tax";

export default function Converter() {
  const navigate = useNavigate();
  const { uiLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);
  const [tab, setTab] = useState<TabType>("currency");

  // ── Geo ──
  const [geoLoading, setGeoLoading] = useState<"from" | "to" | null>(null);

  const handleGeolocate = async (target: "from" | "to") => {
    setGeoLoading(target);
    const currency = await detectCurrencyByLocation();
    if (currency) {
      if (target === "from") setFromCurrency(currency);
      else setToCurrency(currency);
    }
    setGeoLoading(null);
  };

  // ── Currency ──
  const [fromCurrency, setFromCurrency] = useState("EUR");
  const [toCurrency, setToCurrency] = useState("USD");
  const [amount, setAmount] = useState("1");
  const [rates, setRates] = useState<Record<string, number>>({});
  const [ratesDate, setRatesDate] = useState("");
  const [loadingRates, setLoadingRates] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  // ── Units ──
  const [measureCat, setMeasureCat] = useState(0);
  const [fromUnit, setFromUnit] = useState("m");
  const [toUnit, setToUnit] = useState("ft");
  const [unitAmount, setUnitAmount] = useState("1");

  // ── Temperature ──
  const [tempFrom, setTempFrom] = useState("C");
  const [tempTo, setTempTo] = useState("F");
  const [tempVal, setTempVal] = useState("0");

  // ── Sizes ──
  const [sizeTable, setSizeTable] = useState<keyof typeof SIZE_TABLES>("shoes_m");

  // ── Timezone ──
  const [now, setNow] = useState(new Date());

  // ── Tip ──
  const [tipAmount, setTipAmount] = useState("50");
  const [tipPct, setTipPct] = useState(15);
  const [tipPeople, setTipPeople] = useState("1");

  // ── Tax ──
  const [taxAmount, setTaxAmount] = useState("100");
  const [taxCountry, setTaxCountry] = useState(0);

  // Fetch rates
  useEffect(() => {
    if (tab !== "currency") return;
    setLoadingRates(true);

    setRateError(null);

    if (!isOnline()) {
      // Offline: load from cache
      const cached = loadCachedRates(fromCurrency);
      if (cached) {
        setRates(cached.rates);
        setRatesDate(cached.date + " (offline)");
      } else {
        setRateError(String(uiLanguage).toLowerCase().startsWith("it") ? "Tassi non disponibili offline" : "Rates unavailable offline");
      }
      setLoadingRates(false);
      return;
    }

    fetch(`https://api.frankfurter.app/latest?from=${fromCurrency}`)
      .then((r) => r.json())
      .then((data) => {
        setRates(data.rates || {});
        setRatesDate(data.date || "");
        setRateError(null);
        // Cache for offline use
        saveCurrencyRates(fromCurrency, data.rates || {}, data.date || "");
      })
      .catch((e) => {
        console.error("Rate fetch error:", e);
        // Try to load cached rates as fallback
        const cached = loadCachedRates(fromCurrency);
        if (cached) {
          setRates(cached.rates);
          setRatesDate(cached.date + " (offline)");
        } else {
          setRateError(String(uiLanguage).toLowerCase().startsWith("it") ? "Impossibile caricare i tassi" : "Could not load rates");
        }
      })
      .finally(() => setLoadingRates(false));
  }, [fromCurrency, tab]);

  // Clock tick
  useEffect(() => {
    if (tab !== "timezone") return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [tab]);

  // ── Helpers ──
  const convertedCurrency = (() => {
    const n = parseFloat(amount);
    if (isNaN(n) || !rates[toCurrency]) return "—";
    return (n * rates[toCurrency]).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  })();

  const convertedUnit = (() => {
    const n = parseFloat(unitAmount);
    if (isNaN(n)) return "—";
    const cat = MEASURE_CATEGORIES[measureCat];
    const f = cat.units.find((u) => u.code === fromUnit);
    const t2 = cat.units.find((u) => u.code === toUnit);
    if (!f || !t2) return "—";
    return ((n * f.factor) / t2.factor).toLocaleString(undefined, { maximumFractionDigits: 6 });
  })();

  const convertedTemp = (() => {
    const n = parseFloat(tempVal);
    if (isNaN(n)) return "—";
    let c = tempFrom === "C" ? n : tempFrom === "F" ? (n - 32) * 5 / 9 : n - 273.15;
    let r = tempTo === "C" ? c : tempTo === "F" ? c * 9 / 5 + 32 : c + 273.15;
    return r.toLocaleString(undefined, { maximumFractionDigits: 2 });
  })();

  const tipResult = (() => {
    const bill = parseFloat(tipAmount);
    const people = parseInt(tipPeople) || 1;
    if (isNaN(bill)) return { tip: "—", total: "—", perPerson: "—" };
    const tip = bill * tipPct / 100;
    const total = bill + tip;
    return {
      tip: tip.toFixed(2),
      total: total.toFixed(2),
      perPerson: people > 1 ? (total / people).toFixed(2) : null,
    };
  })();

  const taxResult = (() => {
    const n = parseFloat(taxAmount);
    const vatPct = TAX_COUNTRIES[taxCountry]?.vat || 0;
    if (isNaN(n)) return { tax: "—", total: "—", pct: vatPct };
    const tax = n * vatPct / 100;
    return { tax: tax.toFixed(2), total: (n + tax).toFixed(2), pct: vatPct };
  })();

  const changeMeasureCat = (idx: number) => {
    setMeasureCat(idx);
    const cat = MEASURE_CATEGORIES[idx];
    setFromUnit(cat.defaultFrom);
    setToUnit(cat.defaultTo);
    setUnitAmount("1");
  };

  // ── Shared UI ──
  const swapBtn = (fn: () => void) => (
    <div className="flex justify-center">
      <button onClick={fn} className="bg-[#295BDB] hover:bg-[#295BDB] w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110">
        <ArrowUpDown className="w-5 h-5" />
      </button>
    </div>
  );

  const card = (label: string, children: React.ReactNode) => (
    <div className="bg-[#0E2666] rounded-2xl p-5 border border-[#FFFFFF14]">
      <label className="text-xs text-[#F4F4F4]/40 uppercase tracking-wider">{label}</label>
      <div className="mt-2">{children}</div>
    </div>
  );

  const TABS: { key: TabType; icon: React.ElementType; label: string }[] = [
    { key: "currency", icon: Coins, label: t("currency") },
    { key: "units", icon: Ruler, label: t("units") },
    { key: "temperature", icon: Thermometer, label: t("temperature") },
    { key: "sizes", icon: Shirt, label: t("sizes") },
    { key: "timezone", icon: Clock, label: t("timezone") },
    { key: "tip", icon: HandCoins, label: t("tip") },
    { key: "tax", icon: Receipt, label: t("tax") },
  ];

  return (
    <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans overflow-hidden">
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666] shrink-0">
        <button onClick={() => navigate("/")} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <Coins className="w-5 h-5 text-[#295BDB]" />
        <h1 className="text-lg font-bold flex-1">{t("convertUnits")}</h1>
      </header>

      {/* Tabs — scrollable */}
      <div className="flex overflow-x-auto border-b border-[#FFFFFF14] bg-[#0E2666] no-scrollbar shrink-0">
        {TABS.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-col items-center gap-1 py-3 px-4 text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${
              tab === key ? "text-[#295BDB] border-b-2 border-[#295BDB]" : "text-[#F4F4F4]/40 hover:text-[#F4F4F4]/80"
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="w-full max-w-sm mx-auto space-y-4">

          {/* ═══ CURRENCY ═══ */}
          {tab === "currency" && (<>
            {card(t("from"), (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <select value={fromCurrency} onChange={(e) => setFromCurrency(e.target.value)} className="flex-1 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-sm text-[#F4F4F4] appearance-none outline-none focus:ring-2 focus:ring-[#295BDB]">
                    {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
                  </select>
                  <button
                    onClick={() => handleGeolocate("from")}
                    disabled={geoLoading !== null}
                    className={`p-2.5 rounded-xl border border-[#FFFFFF14] text-[#F4F4F4]/60 hover:text-[#295BDB] hover:border-[#295BDB] transition-colors shrink-0 ${geoLoading === "from" ? "animate-pulse text-[#295BDB] border-[#295BDB]" : ""}`}
                  >
                    <LocateFixed className="w-4 h-4" />
                  </button>
                </div>
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-center text-2xl font-bold text-[#F4F4F4] outline-none focus:ring-2 focus:ring-[#295BDB]" min="0" step="any" />
              </div>
            ))}
            {swapBtn(() => { setFromCurrency(toCurrency); setToCurrency(fromCurrency); })}
            {card(t("to"), (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <select value={toCurrency} onChange={(e) => setToCurrency(e.target.value)} className="flex-1 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-sm text-[#F4F4F4] appearance-none outline-none focus:ring-2 focus:ring-[#295BDB]">
                    {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
                  </select>
                  <button
                    onClick={() => handleGeolocate("to")}
                    disabled={geoLoading !== null}
                    className={`p-2.5 rounded-xl border border-[#FFFFFF14] text-[#F4F4F4]/60 hover:text-[#295BDB] hover:border-[#295BDB] transition-colors shrink-0 ${geoLoading === "to" ? "animate-pulse text-[#295BDB] border-[#295BDB]" : ""}`}
                  >
                    <LocateFixed className="w-4 h-4" />
                  </button>
                </div>
                {loadingRates ? (
                  <div className="flex items-center justify-center gap-2 py-1">
                    <Loader2 className="w-6 h-6 text-[#295BDB] animate-spin" />
                  </div>
                ) : rateError ? (
                  <p className="text-center text-sm text-red-400">{rateError}</p>
                ) : (
                  <p className="text-center text-3xl font-bold text-[#295BDB]">{convertedCurrency}</p>
                )}
              </div>
            ))}
            {rates[toCurrency] && (
              <p className="text-center text-xs text-[#F4F4F4]/40">
                1 {fromCurrency} = {rates[toCurrency].toLocaleString(undefined, { maximumFractionDigits: 4 })} {toCurrency}
                {ratesDate && <span> · {ratesDate}</span>}
              </p>
            )}
          </>)}

          {/* ═══ UNITS ═══ */}
          {tab === "units" && (<>
            <div className="flex gap-2 flex-wrap">
              {MEASURE_CATEGORIES.map((cat, i) => (
                <button key={cat.id} onClick={() => changeMeasureCat(i)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${measureCat === i ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]" : "bg-[#0E2666] border-[#FFFFFF14] text-[#F4F4F4]/60"}`}>
                  {t(cat.labelKey as any)}
                </button>
              ))}
            </div>
            {card(t("from"), (
              <div className="space-y-3">
                <select value={fromUnit} onChange={(e) => setFromUnit(e.target.value)} className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-sm text-[#F4F4F4] appearance-none outline-none focus:ring-2 focus:ring-[#295BDB]">
                  {MEASURE_CATEGORIES[measureCat].units.map((u) => <option key={u.code} value={u.code}>{u.code} — {t(u.nameKey as any)}</option>)}
                </select>
                <input type="number" value={unitAmount} onChange={(e) => setUnitAmount(e.target.value)} className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-center text-2xl font-bold text-[#F4F4F4] outline-none focus:ring-2 focus:ring-[#295BDB]" step="any" />
              </div>
            ))}
            {swapBtn(() => { setFromUnit(toUnit); setToUnit(fromUnit); })}
            {card(t("to"), (
              <div className="space-y-3">
                <select value={toUnit} onChange={(e) => setToUnit(e.target.value)} className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-sm text-[#F4F4F4] appearance-none outline-none focus:ring-2 focus:ring-[#295BDB]">
                  {MEASURE_CATEGORIES[measureCat].units.map((u) => <option key={u.code} value={u.code}>{u.code} — {t(u.nameKey as any)}</option>)}
                </select>
                <p className="text-center text-3xl font-bold text-[#295BDB]">{convertedUnit}</p>
              </div>
            ))}
          </>)}

          {/* ═══ TEMPERATURE ═══ */}
          {tab === "temperature" && (<>
            {card(t("from"), (
              <div className="space-y-3">
                <div className="flex gap-2">
                  {TEMP_UNITS.map((u) => (
                    <button key={u} onClick={() => setTempFrom(u)} className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${tempFrom === u ? "bg-[#295BDB] text-[#F4F4F4]" : "bg-[#02114A] text-[#F4F4F4]/60 border border-[#FFFFFF14]"}`}>°{u}</button>
                  ))}
                </div>
                <input type="number" value={tempVal} onChange={(e) => setTempVal(e.target.value)} className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-center text-2xl font-bold text-[#F4F4F4] outline-none focus:ring-2 focus:ring-[#295BDB]" step="any" />
              </div>
            ))}
            {swapBtn(() => { setTempFrom(tempTo); setTempTo(tempFrom); })}
            {card(t("to"), (
              <div className="space-y-3">
                <div className="flex gap-2">
                  {TEMP_UNITS.map((u) => (
                    <button key={u} onClick={() => setTempTo(u)} className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${tempTo === u ? "bg-[#295BDB] text-[#F4F4F4]" : "bg-[#02114A] text-[#F4F4F4]/60 border border-[#FFFFFF14]"}`}>°{u}</button>
                  ))}
                </div>
                <p className="text-center text-3xl font-bold text-[#295BDB]">{convertedTemp}°{tempTo}</p>
              </div>
            ))}
          </>)}

          {/* ═══ SIZES ═══ */}
          {tab === "sizes" && (<>
            <div className="flex gap-2">
              {(Object.keys(SIZE_TABLES) as (keyof typeof SIZE_TABLES)[]).map((k) => (
                <button key={k} onClick={() => setSizeTable(k)}
                  className={`flex-1 px-2 py-2 rounded-xl text-xs font-medium border transition-colors text-center ${sizeTable === k ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]" : "bg-[#0E2666] border-[#FFFFFF14] text-[#F4F4F4]/60"}`}>
                  {t(SIZE_TABLES[k].labelKey as any)}
                </button>
              ))}
            </div>
            <div className="bg-[#0E2666] rounded-2xl border border-[#FFFFFF14] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#123182]">
                    {SIZE_TABLES[sizeTable].columns.map((col) => (
                      <th key={col} className="py-3 px-3 text-xs text-[#F4F4F4]/60 font-medium text-center">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SIZE_TABLES[sizeTable].rows.map((row, i) => (
                    <tr key={i} className="border-t border-[#FFFFFF14]">
                      {row.map((cell, j) => (
                        <td key={j} className={`py-2.5 px-3 text-center ${j === 0 ? "font-bold text-[#F4F4F4]" : "text-[#F4F4F4]/80"}`}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>)}

          {/* ═══ TIMEZONE ═══ */}
          {tab === "timezone" && (
            <div className="space-y-2">
              {TIMEZONES.map((tz) => {
                const locale = uiLanguage === "en" ? "en-GB" : uiLanguage === "it" ? "it-IT" : uiLanguage === "es" ? "es-ES" : uiLanguage === "fr" ? "fr-FR" : uiLanguage === "de" ? "de-DE" : "en-GB";
                const timeStr = now.toLocaleTimeString(locale, { timeZone: tz.tz, hour: "2-digit", minute: "2-digit", second: "2-digit" });
                const dateStr = now.toLocaleDateString(locale, { timeZone: tz.tz, weekday: "short", day: "numeric", month: "short" });
                return (
                  <div key={tz.tz} className="flex items-center justify-between bg-[#0E2666] rounded-xl px-4 py-3 border border-[#FFFFFF14]">
                    <span className="text-sm text-[#F4F4F4]/80">{tz.label}</span>
                    <div className="text-right">
                      <p className="text-lg font-bold font-mono text-[#295BDB]">{timeStr}</p>
                      <p className="text-xs text-[#F4F4F4]/40">{dateStr}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ═══ TIP ═══ */}
          {tab === "tip" && (<>
            {card(t("amount"), (
              <input type="number" value={tipAmount} onChange={(e) => setTipAmount(e.target.value)} className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-2xl font-bold text-[#F4F4F4] outline-none focus:ring-2 focus:ring-[#295BDB] text-center" min="0" step="any" />
            ))}
            <div>
              <label className="text-xs text-[#F4F4F4]/40 uppercase tracking-wider block mb-2">{t("tip")} %</label>
              <div className="grid grid-cols-4 gap-2">
                {[0, 5, 10, 15, 18, 20, 25].map((p) => (
                  <button key={p} onClick={() => setTipPct(p)}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-colors ${tipPct === p ? "bg-[#295BDB] text-[#F4F4F4]" : "bg-[#0E2666] text-[#F4F4F4]/60 border border-[#FFFFFF14]"}`}>
                    {p}%
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-[#F4F4F4]/40 uppercase tracking-wider block mb-2">{t("splitBill")}</label>
              <input type="number" value={tipPeople} onChange={(e) => setTipPeople(e.target.value)} className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-2.5 text-[#F4F4F4] outline-none focus:ring-2 focus:ring-[#295BDB] text-center" min="1" />
            </div>
            <div className="bg-[#0E2666] rounded-2xl p-4 border border-[#FFFFFF14] space-y-3">
              <div className="flex justify-between"><span className="text-[#F4F4F4]/60">{t("tip")}</span><span className="font-bold text-[#F4F4F4]">{tipResult.tip}</span></div>
              <div className="border-t border-[#FFFFFF14]" />
              <div className="flex justify-between"><span className="text-[#F4F4F4]/60">{t("total")}</span><span className="text-xl font-bold text-[#295BDB]">{tipResult.total}</span></div>
              {tipResult.perPerson && (<>
                <div className="border-t border-[#FFFFFF14]" />
                <div className="flex justify-between"><span className="text-[#F4F4F4]/60">{t("perPerson")}</span><span className="font-bold text-[#F4F4F4]">{tipResult.perPerson}</span></div>
              </>)}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-[#F4F4F4]/40 uppercase tracking-wider mb-2">{t("tipByCountry")}</p>
              {TIP_COUNTRIES.map((tc) => (
                <div key={tc.country} className="flex items-center justify-between bg-[#0E2666]/50 rounded-lg px-3 py-2 text-sm">
                  <span className="text-[#F4F4F4]/80">{tc.country}</span>
                  <span className="text-[#F4F4F4]/60">{tc.pct.map((p) => `${p}%`).join(" · ")}</span>
                </div>
              ))}
            </div>
          </>)}

          {/* ═══ TAX ═══ */}
          {tab === "tax" && (<>
            {card(t("amount"), (
              <input type="number" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-2xl font-bold text-[#F4F4F4] outline-none focus:ring-2 focus:ring-[#295BDB] text-center" min="0" step="any" />
            ))}
            <div>
              <label className="text-xs text-[#F4F4F4]/40 uppercase tracking-wider block mb-2">{t("country")}</label>
              <select value={taxCountry} onChange={(e) => setTaxCountry(parseInt(e.target.value))} className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-[#F4F4F4] appearance-none outline-none focus:ring-2 focus:ring-[#295BDB]">
                {TAX_COUNTRIES.map((tc, i) => <option key={i} value={i}>{tc.country} — {tc.vat}%</option>)}
              </select>
            </div>
            <div className="bg-[#0E2666] rounded-2xl p-4 border border-[#FFFFFF14] space-y-3">
              <div className="flex justify-between"><span className="text-[#F4F4F4]/60">VAT/Tax ({taxResult.pct}%)</span><span className="font-bold text-[#F4F4F4]">{taxResult.tax}</span></div>
              <div className="border-t border-[#FFFFFF14]" />
              <div className="flex justify-between"><span className="text-[#F4F4F4]/60">{t("total")}</span><span className="text-xl font-bold text-[#295BDB]">{taxResult.total}</span></div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-[#F4F4F4]/40 uppercase tracking-wider mb-2">{t("taxByCountry")}</p>
              {TAX_COUNTRIES.map((tc) => (
                <div key={tc.country} className="flex items-center justify-between bg-[#0E2666]/50 rounded-lg px-3 py-2 text-sm">
                  <span className="text-[#F4F4F4]/80">{tc.country}</span>
                  <span className="font-medium text-[#295BDB]">{tc.vat}%</span>
                </div>
              ))}
            </div>
          </>)}

        </div>
      </div>
    </div>
  );
}
