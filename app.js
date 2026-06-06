(() => {
  "use strict";


  "use strict";

  const CURRENCIES = [
    { code: "NGN", name: "Nigerian Naira" },
    { code: "GHS", name: "Ghanaian Cedi" },
    { code: "KES", name: "Kenyan Shilling" },
    { code: "ZAR", name: "South African Rand" },
    { code: "USD", name: "US Dollar" },
    { code: "EUR", name: "Euro" },
    { code: "GBP", name: "British Pound" },
    { code: "CAD", name: "Canadian Dollar" },
    { code: "AUD", name: "Australian Dollar" },
    { code: "JPY", name: "Japanese Yen" },
    { code: "CNY", name: "Chinese Yuan" },
    { code: "AED", name: "UAE Dirham" }
  ];

  const CURRENCY_BY_CODE = Object.fromEntries(CURRENCIES.map(c => [c.code, c]));

  const API_BASE = "https://open.er-api.com/v6/latest";
  const FETCH_TIMEOUT_MS = 10000;

  const els = {
    fromCurrency: document.getElementById("from-currency"),
    toCurrency: document.getElementById("to-currency"),
    fromAmount: document.getElementById("from-amount"),
    toAmount: document.getElementById("to-amount"),
    swapBtn: document.getElementById("swap-btn"),
    copyBtn: document.getElementById("copy-btn"),
    rateText: document.getElementById("rate-text"),
    updatedLine: document.getElementById("updated-line"),
    status: document.getElementById("status"),
    rowFrom: document.getElementById("row-from"),
    rowTo: document.getElementById("row-to")
  };

  const state = {
    base: "USD",
    rates: null,
    lastUpdated: null,
    usingCache: false,
    isFetching: false
  };

  function populateSelectors() {
    const fragFrom = document.createDocumentFragment();
    const fragTo = document.createDocumentFragment();

    CURRENCIES.forEach(c => {
      const opt1 = document.createElement("option");
      opt1.value = c.code;
      opt1.textContent = `${c.code} — ${c.name}`;
      fragFrom.appendChild(opt1);

      const opt2 = opt1.cloneNode(true);
      fragTo.appendChild(opt2);
    });

    els.fromCurrency.appendChild(fragFrom);
    els.toCurrency.appendChild(fragTo);

    els.fromCurrency.value = "USD";
    els.toCurrency.value = "NGN";
  }

  function setStatus(message, kind) {
    if (!message) {
      els.status.textContent = "";
      els.status.classList.remove("is-visible", "is-warning", "is-error");
      return;
    }
    els.status.textContent = message;
    els.status.classList.add("is-visible");
    els.status.classList.remove("is-warning", "is-error");
    if (kind === "warning") els.status.classList.add("is-warning");
    if (kind === "error") els.status.classList.add("is-error");
  }

  function formatNumber(value, currencyCode) {
    if (!Number.isFinite(value)) return "—";
    const isZeroDecimal = ["JPY"].includes(currencyCode);
    const minFraction = isZeroDecimal ? 0 : 2;
    const maxFraction = isZeroDecimal ? 2 : 4;
    try {
      return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: minFraction,
        maximumFractionDigits: maxFraction
      }).format(value);
    } catch {
      return value.toFixed(maxFraction);
    }
  }

  function formatGrouped(value, currencyCode) {
    if (!Number.isFinite(value)) return "—";
    const isZeroDecimal = ["JPY"].includes(currencyCode);
    const minFraction = isZeroDecimal ? 0 : 2;
    const maxFraction = isZeroDecimal ? 2 : 2;
    try {
      return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: minFraction,
        maximumFractionDigits: maxFraction
      }).format(value);
    } catch {
      return value.toFixed(maxFraction);
    }
  }

  function parseAmount(raw) {
    if (raw == null) return NaN;
    const cleaned = String(raw).replace(/[,\s]/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return NaN;
    if (!/^-?\d*\.?\d*$/.test(cleaned)) return NaN;
    return Number(cleaned);
  }

  function sanitizeInput(el) {
    const before = el.value;
    let cleaned = before.replace(/[^\d.,\-]/g, "");
    const firstMinus = cleaned.indexOf("-");
    if (firstMinus > 0) cleaned = cleaned.slice(0, firstMinus) + cleaned.slice(firstMinus + 1);
    cleaned = cleaned.replace(/-/g, "");
    const firstDot = cleaned.indexOf(".");
    if (firstDot >= 0) {
      cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
    }
    if (cleaned !== before) el.value = cleaned;
  }

  function rateFor(from, to) {
    if (!state.rates) return NaN;
    if (from === to) return 1;
    const rFrom = state.rates[from];
    const rTo = state.rates[to];
    if (typeof rFrom !== "number" || typeof rTo !== "number") return NaN;
    return rTo / rFrom;
  }

  function updateRateLine() {
    const from = els.fromCurrency.value;
    const to = els.toCurrency.value;
    if (!state.rates) {
      els.rateText.textContent = `1 ${from} = — ${to}`;
      return;
    }
    const r = rateFor(from, to);
    if (!Number.isFinite(r)) {
      els.rateText.textContent = `1 ${from} = — ${to}`;
      return;
    }
    els.rateText.textContent = `1 ${from} = ${formatGrouped(r, to)} ${to}`;
  }

  function formatRelative(timestamp) {
    if (!timestamp) return "—";
    const now = Date.now();
    const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
    if (diffSec < 5) return "just now";
    if (diffSec < 60) return `${diffSec} sec ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hr ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  }

  function startRelativeClock() {
    if (window.__kursRelInt) return;
    window.__kursRelInt = setInterval(() => {
      if (state.lastUpdated) {
        els.updatedLine.textContent = `Updated ${formatRelative(state.lastUpdated)}`;
      }
    }, 1000);
  }

  function setInputsDisabled(disabled) {
    els.fromAmount.disabled = disabled;
    els.toAmount.disabled = disabled;
  }

  function recalcFrom(source) {
    sanitizeInput(source);
    const from = els.fromCurrency.value;
    const to = els.toCurrency.value;
    const raw = source.value;
    const n = parseAmount(raw);
    if (!Number.isFinite(n)) {
      if (source === els.fromAmount) els.toAmount.value = "";
      else els.fromAmount.value = "";
      updateRateLine();
      return;
    }
    if (!state.rates) {
      if (source === els.fromAmount) els.toAmount.value = "";
      else els.fromAmount.value = "";
      updateRateLine();
      return;
    }
    const r = rateFor(from, to);
    if (!Number.isFinite(r)) {
      if (source === els.fromAmount) els.toAmount.value = "";
      else els.fromAmount.value = "";
      updateRateLine();
      return;
    }
    const result = n * r;
    if (source === els.fromAmount) {
      els.toAmount.value = formatGrouped(result, to);
    } else {
      els.fromAmount.value = formatGrouped(result, from);
    }
    updateRateLine();
  }

  async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchRates(base) {
    if (state.isFetching) return;
    state.isFetching = true;
    const baseCode = base || state.base;
    const url = `${API_BASE}/${encodeURIComponent(baseCode)}`;

    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.result !== "success" || !data.rates) {
        throw new Error("Invalid payload");
      }
      const required = CURRENCIES.map(c => c.code);
      const missing = required.filter(code => typeof data.rates[code] !== "number");
      if (missing.length) {
        throw new Error(`Missing rates: ${missing.join(", ")}`);
      }
      const seeded = { [baseCode]: 1 };
      const rates = { ...seeded, ...data.rates };
      state.base = baseCode;
      state.rates = rates;
      state.lastUpdated = Date.now();
      state.usingCache = false;
      els.updatedLine.textContent = `Updated ${formatRelative(state.lastUpdated)}`;
      setStatus("", null);
      els.rowFrom.classList.remove("is-error");
      els.rowTo.classList.remove("is-error");
    } catch (err) {
      if (state.rates) {
        state.usingCache = true;
        setStatus("Using cached rates. Live fetch failed.", "warning");
      } else {
        setStatus("Rate data unavailable. Check connection.", "error");
        els.rowFrom.classList.add("is-error");
        els.rowTo.classList.add("is-error");
      }
    } finally {
      state.isFetching = false;
      updateRateLine();
      setInputsDisabled(false);
      if (state.rates) {
        if (els.fromAmount.value === "" || els.fromAmount.value == null) {
          els.fromAmount.value = "1";
        }
        recalcFrom(els.fromAmount);
      }
    }
  }

  let debounceTimer = null;
  function debounceRecalc(source) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => recalcFrom(source), 300);
  }

  function onAmountInput(e) {
    debounceRecalc(e.target);
  }

  function onAmountKeyUp(e) {
    if (e.key === "Enter") e.target.blur();
  }

  function onCurrencyChange(e) {
    recalcFrom(els.fromAmount);
    fetchRates(e.target.value).catch(() => {});
  }

  function onSwap() {
    const f = els.fromCurrency.value;
    const t = els.toCurrency.value;
    if (f === t) return;
    els.fromCurrency.value = t;
    els.toCurrency.value = f;
    els.swapBtn.classList.add("is-swapping");
    setTimeout(() => els.swapBtn.classList.remove("is-swapping"), 200);
    recalcFrom(els.fromAmount);
    fetchRates(els.fromCurrency.value).catch(() => {});
  }

  function getResultNumber() {
    const to = els.toCurrency.value;
    const raw = els.toAmount.value;
    const n = parseAmount(raw);
    if (!Number.isFinite(n)) return null;
    const r = rateFor(els.fromCurrency.value, to);
    if (!Number.isFinite(r)) return null;
    return n;
  }

  function onCopy() {
    const val = els.toAmount.value;
    const to = els.toCurrency.value;
    if (!val) return;
    const num = parseAmount(val);
    if (!Number.isFinite(num)) return;

    const text = String(num);

    const showCopied = () => {
      const original = els.copyBtn.textContent;
      els.copyBtn.textContent = "Copied";
      els.copyBtn.classList.add("is-copied");
      setTimeout(() => {
        els.copyBtn.textContent = original;
        els.copyBtn.classList.remove("is-copied");
      }, 1500);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(showCopied).catch(() => fallbackCopy(text, showCopied));
    } else {
      fallbackCopy(text, showCopied);
    }
  }

  function fallbackCopy(text, cb) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok && typeof cb === "function") cb();
    } catch {
    }
  }

  function init() {
    populateSelectors();
    setInputsDisabled(true);
    els.rateText.textContent = "Loading rates…";
    els.updatedLine.textContent = "Updated —";

    els.fromAmount.addEventListener("input", onAmountInput);
    els.toAmount.addEventListener("input", onAmountInput);
    els.fromAmount.addEventListener("keyup", onAmountKeyUp);
    els.toAmount.addEventListener("keyup", onAmountKeyUp);

    els.fromCurrency.addEventListener("change", onCurrencyChange);
    els.toCurrency.addEventListener("change", onCurrencyChange);

    els.swapBtn.addEventListener("click", onSwap);
    els.copyBtn.addEventListener("click", onCopy);

    startRelativeClock();
    fetchRates(els.fromCurrency.value).catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
