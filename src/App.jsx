import { useState, useCallback, useMemo } from "react";
import Papa from "papaparse";
import {
  Upload, Filter, Download, ChevronUp, ChevronDown,
  TrendingUp, TrendingDown, Minus, X, Eye, BarChart2,
  Search, Tag, ShoppingBag, Users, AlertCircle, Star,
  Layers, Target, Zap, RefreshCw
} from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────
const fmt = (n, prefix = "", suffix = "") => {
  if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "—";
  const num = Number(n);
  if (Math.abs(num) >= 1_000_000) return `${prefix}${(num / 1_000_000).toFixed(1)}M${suffix}`;
  if (Math.abs(num) >= 1_000) return `${prefix}${(num / 1_000).toFixed(1)}K${suffix}`;
  return `${prefix}${num.toFixed(2)}${suffix}`;
};
const pct = (n) => (n === null || n === undefined || n === "" ? "—" : `${(Number(n) * 100).toFixed(1)}%`);
const money = (n) => fmt(n, "$");

// ─── detect CSV type ─────────────────────────────────────────────────────────
function detectType(headers) {
  // Strip BOM, quotes, and whitespace from headers
  const h = headers.map(s => s.toLowerCase().replace(/^\uFEFF/, "").replace(/['"]/g, "").trim());
  if (h.some(x => x.includes("brand name")) && h.some(x => x.includes("brand score"))) return "brands";
  if (h.some(x => x.includes("search term")) && h.some(x => x.includes("opportunity score"))) return "search_terms";
  if (h.some(x => x.includes("seller id"))) return "sellers";
  if (h.some(x => x === "asin") && h.some(x => x.includes("page score"))) return "products";
  if (h.some(x => x.includes("total ad spend"))) return "adspy";
  if (h.some(x => x.includes("node id"))) return "subcategories";
  return "unknown";
}

// ─── Fulfld Opportunity Score ─────────────────────────────────────────────────
function calcScore(row, type) {
  let score = 0;
  if (type === "brands") {
    const rev = Number(row["Est. Monthly Revenue"]) || 0;
    const amazonPct = Number(row["Sales %"]) || 0;
    const sellers = Number(row["Avg. Sellers"]) || 0;
    const growth1m = Number(row["1 Month Growth"]) || 0;
    const growth12m = Number(row["12 Month Growth"]) || 0;
    const brandScore = Number(row["Brand Score"]) || 0;
    const stockRate = Number(row["Amazon In-Stock Rate"]) || 0;

    // Revenue sweet spot: $50K–$5M/month
    if (rev >= 50000 && rev <= 500000) score += 25;
    else if (rev > 500000 && rev <= 5000000) score += 20;
    else if (rev > 5000000) score += 10;

    // Low Amazon % = opportunity (Fulfld can add value)
    if (amazonPct < 20) score += 25;
    else if (amazonPct < 50) score += 15;
    else if (amazonPct > 80) score -= 10;

    // Multiple sellers = not exclusive
    if (sellers >= 2 && sellers <= 10) score += 20;
    else if (sellers > 10) score += 10;

    // Growth signals
    if (growth1m > 0) score += 10;
    if (growth12m > 0) score += 10;

    // Brand score (SmartScout's own quality metric)
    if (brandScore >= 7) score += 10;

    // Low in-stock = struggling
    if (stockRate < 0.5) score += 5;
  }
  return Math.min(100, Math.max(0, score));
}

function scoreColor(score) {
  if (score >= 70) return "#00ff87";
  if (score >= 45) return "#ffd166";
  return "#ef476f";
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────
const DEFAULT_FILTERS = {
  minScore: 0,
  maxAmazonPct: 100,
  minRevenue: 0,
  maxSellers: 999,
  minGrowth: -100,
  search: "",
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function ScoreBadge({ score }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: `${scoreColor(score)}18`,
      border: `1px solid ${scoreColor(score)}60`,
      borderRadius: 6, padding: "3px 10px",
    }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: scoreColor(score) }} />
      <span style={{ fontFamily: "'DM Mono'", fontSize: 13, fontWeight: 500, color: scoreColor(score) }}>
        {score}
      </span>
    </div>
  );
}

function GrowthBadge({ value }) {
  const num = Number(value);
  if (isNaN(num) || value === "" || value === null) return <span style={{ color: "#555" }}>—</span>;
  const formatted = `${num >= 0 ? "+" : ""}${(num * 100).toFixed(1)}%`;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      color: num > 0 ? "#00ff87" : num < 0 ? "#ef476f" : "#888",
      fontFamily: "'DM Mono'", fontSize: 12
    }}>
      {num > 0 ? <TrendingUp size={11} /> : num < 0 ? <TrendingDown size={11} /> : <Minus size={11} />}
      {formatted}
    </span>
  );
}

// ─── BRAND TABLE ──────────────────────────────────────────────────────────────
function BrandsTable({ data, onSelectBrand }) {
  const [sort, setSort] = useState({ col: "__score", dir: "desc" });
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const scored = useMemo(() =>
    data.map(row => ({ ...row, __score: calcScore(row, "brands") })),
    [data]);

  const filtered = useMemo(() => scored.filter(row => {
    const rev = Number(row["Est. Monthly Revenue"]) || 0;
    const amazonPct = Number(row["Sales %"]) || 0;
    const sellers = Number(row["Avg. Sellers"]) || 0;
    const growth = Number(row["1 Month Growth"]) || 0;
    const name = (row["Brand Name"] || "").toLowerCase();
    return (
      row.__score >= filters.minScore &&
      amazonPct <= filters.maxAmazonPct &&
      rev >= filters.minRevenue &&
      sellers <= filters.maxSellers &&
      growth * 100 >= filters.minGrowth &&
      name.includes(filters.search.toLowerCase())
    );
  }), [scored, filters]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let av = a[sort.col], bv = b[sort.col];
    av = isNaN(Number(av)) ? av : Number(av);
    bv = isNaN(Number(bv)) ? bv : Number(bv);
    if (av < bv) return sort.dir === "asc" ? -1 : 1;
    if (av > bv) return sort.dir === "asc" ? 1 : -1;
    return 0;
  }), [filtered, sort]);

  const toggle = (col) => setSort(s => ({ col, dir: s.col === col && s.dir === "desc" ? "asc" : "desc" }));
  const SortIcon = ({ col }) => sort.col === col
    ? (sort.dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
    : <ChevronDown size={12} style={{ opacity: 0.3 }} />;

  const exportCSV = () => {
    const csv = Papa.unparse(sorted.map(r => ({
      "Brand Name": r["Brand Name"],
      "Fulfld Score": r.__score,
      "Monthly Revenue": r["Est. Monthly Revenue"],
      "Amazon %": r["Sales %"],
      "Avg Sellers": r["Avg. Sellers"],
      "1M Growth": r["1 Month Growth"],
      "12M Growth": r["12 Month Growth"],
      "Brand Score": r["Brand Score"],
      "Category": r["Main Category"],
      "Subcategory": r["Primary Subcategory"],
      "Storefront": r["Storefront Url"],
    })));
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fulfld_brand_shortlist.csv";
    a.click();
  };

  const cols = [
    { key: "__score", label: "Score" },
    { key: "Brand Name", label: "Brand" },
    { key: "Est. Monthly Revenue", label: "Mo. Revenue" },
    { key: "Sales %", label: "Amazon %" },
    { key: "Avg. Sellers", label: "Sellers" },
    { key: "Avg. FBA Sellers", label: "FBA Sellers" },
    { key: "1 Month Growth", label: "1M Growth" },
    { key: "12 Month Growth", label: "12M Growth" },
    { key: "Brand Score", label: "Brand Score" },
    { key: "Main Category", label: "Category" },
    { key: "Primary Subcategory", label: "Subcategory" },
  ];

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#666" }} />
          <input
            placeholder="Search brand name..."
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            style={inputStyle}
          />
        </div>
        <button onClick={() => setShowFilters(f => !f)} style={btnStyle}>
          <Filter size={14} /> Filters
        </button>
        <button onClick={exportCSV} style={{ ...btnStyle, background: "#00ff8720", borderColor: "#00ff8760", color: "#00ff87" }}>
          <Download size={14} /> Export Shortlist
        </button>
        <span style={{ color: "#666", fontSize: 13, fontFamily: "'DM Mono'" }}>
          {sorted.length} / {data.length} brands
        </span>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div style={{
          background: "#0d0d0d", border: "1px solid #222", borderRadius: 10,
          padding: "16px 20px", marginBottom: 16, display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14
        }}>
          {[
            { label: "Min Fulfld Score", key: "minScore", min: 0, max: 100 },
            { label: "Max Amazon %", key: "maxAmazonPct", min: 0, max: 100 },
            { label: "Min Mo. Revenue ($)", key: "minRevenue", min: 0, max: 10000000, step: 1000 },
            { label: "Max Sellers", key: "maxSellers", min: 0, max: 500 },
            { label: "Min 1M Growth (%)", key: "minGrowth", min: -100, max: 200 },
          ].map(({ label, key, min, max, step = 1 }) => (
            <div key={key}>
              <label style={{ color: "#666", fontSize: 11, fontFamily: "'DM Mono'", display: "block", marginBottom: 4 }}>{label}</label>
              <input
                type="number" min={min} max={max} step={step}
                value={filters[key]}
                onChange={e => setFilters(f => ({ ...f, [key]: Number(e.target.value) }))}
                style={{ ...inputStyle, paddingLeft: 10 }}
              />
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button onClick={() => setFilters(DEFAULT_FILTERS)} style={{ ...btnStyle, width: "100%" }}>
              <RefreshCw size={13} /> Reset
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #222" }}>
              {cols.map(c => (
                <th key={c.key}
                  onClick={() => toggle(c.key)}
                  style={{
                    padding: "10px 14px", textAlign: "left", cursor: "pointer",
                    color: sort.col === c.key ? "#00ff87" : "#555",
                    fontFamily: "'DM Mono'", fontWeight: 400, fontSize: 11,
                    whiteSpace: "nowrap", userSelect: "none"
                  }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {c.label} <SortIcon col={c.key} />
                  </span>
                </th>
              ))}
              <th style={{ padding: "10px 14px", color: "#555", fontFamily: "'DM Mono'", fontWeight: 400, fontSize: 11 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={i}
                style={{
                  borderBottom: "1px solid #111",
                  background: i % 2 === 0 ? "transparent" : "#0a0a0a",
                  transition: "background 0.15s"
                }}
                onMouseEnter={e => e.currentTarget.style.background = "#141414"}
                onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "#0a0a0a"}
              >
                <td style={tdStyle}><ScoreBadge score={row.__score} /></td>
                <td style={{ ...tdStyle, fontWeight: 600, color: "#fff", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row["Brand Name"] || "—"}
                </td>
                <td style={{ ...tdStyle, fontFamily: "'DM Mono'" }}>{money(row["Est. Monthly Revenue"])}</td>
                <td style={{ ...tdStyle, fontFamily: "'DM Mono'", color: Number(row["Sales %"]) > 70 ? "#ef476f" : Number(row["Sales %"]) < 30 ? "#00ff87" : "#ffd166" }}>
                  {row["Sales %"] !== undefined ? `${Number(row["Sales %"]).toFixed(1)}%` : "—"}
                </td>
                <td style={{ ...tdStyle, fontFamily: "'DM Mono'" }}>{row["Avg. Sellers"] || "—"}</td>
                <td style={{ ...tdStyle, fontFamily: "'DM Mono'" }}>{row["Avg. FBA Sellers"] || "—"}</td>
                <td style={tdStyle}><GrowthBadge value={row["1 Month Growth"]} /></td>
                <td style={tdStyle}><GrowthBadge value={row["12 Month Growth"]} /></td>
                <td style={{ ...tdStyle, fontFamily: "'DM Mono'" }}>{row["Brand Score"] || "—"}</td>
                <td style={{ ...tdStyle, color: "#666", fontSize: 12 }}>{row["Main Category"] || "—"}</td>
                <td style={{ ...tdStyle, color: "#555", fontSize: 11, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row["Primary Subcategory"] || "—"}
                </td>
                <td style={tdStyle}>
                  <button onClick={() => onSelectBrand(row)} style={{
                    background: "transparent", border: "1px solid #333",
                    borderRadius: 6, padding: "4px 10px", color: "#888",
                    cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 4,
                    transition: "all 0.15s"
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#00ff87"; e.currentTarget.style.color = "#00ff87"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = "#888"; }}
                  >
                    <Eye size={11} /> Analyze
                  </button>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={12} style={{ textAlign: "center", padding: 40, color: "#444", fontFamily: "'DM Mono'" }}>
                No brands match current filters
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── BRAND DETAIL PANEL ───────────────────────────────────────────────────────
function BrandDetail({ brand, allData, onClose }) {
  const score = calcScore(brand, "brands");

  // Find competitors from sellers data
  const competitors = (allData.sellers || [])
    .filter(s => {
      const cat = (s["Category"] || "").toLowerCase();
      const brandCat = (brand["Main Category"] || "").toLowerCase();
      return cat && brandCat && cat === brandCat && s["Seller"] !== "Amazon.com";
    })
    .sort((a, b) => Number(b["Estimated Monthly Revenue"]) - Number(a["Estimated Monthly Revenue"]))
    .slice(0, 8);

  // Find related search terms
  const searchTerms = (allData.search_terms || [])
    .sort((a, b) => Number(b["Estimated 30-day Search Volume"]) - Number(a["Estimated 30-day Search Volume"]))
    .slice(0, 10);

  // Find subcategory data
  const subcat = (allData.subcategories || []).find(s =>
    (s["Level 2"] || s["Level 3"] || "").toLowerCase().includes(
      (brand["Primary Subcategory"] || "").toLowerCase().slice(0, 10)
    )
  );

  // Find AdSpy data for this brand
  const adData = (allData.adspy || []).find(a =>
    (a["Brand"] || "").toLowerCase() === (brand["Brand Name"] || "").toLowerCase()
  );

  const metrics = [
    { label: "Monthly Revenue", value: money(brand["Est. Monthly Revenue"]), icon: <BarChart2 size={14} /> },
    { label: "Amazon %", value: brand["Sales %"] !== undefined ? `${Number(brand["Sales %"]).toFixed(1)}%` : "—", icon: <AlertCircle size={14} /> },
    { label: "Avg Sellers", value: brand["Avg. Sellers"] || "—", icon: <Users size={14} /> },
    { label: "Product Count", value: brand["Product Count"] || "—", icon: <ShoppingBag size={14} /> },
    { label: "Brand Score", value: brand["Brand Score"] || "—", icon: <Star size={14} /> },
    { label: "Total Reviews", value: fmt(brand["Total Reviews"]), icon: <Star size={14} /> },
    { label: "1M Growth", value: <GrowthBadge value={brand["1 Month Growth"]} />, icon: <TrendingUp size={14} /> },
    { label: "12M Growth", value: <GrowthBadge value={brand["12 Month Growth"]} />, icon: <TrendingUp size={14} /> },
    { label: "Avg Rating", value: brand["Avg. Rating"] || "—", icon: <Star size={14} /> },
    { label: "FBA Fees/mo", value: money(brand["Total Est. FBA Fees"]), icon: <Tag size={14} /> },
    { label: "In-Stock Rate", value: pct(brand["Amazon In-Stock Rate"]), icon: <Layers size={14} /> },
    { label: "Avg Price", value: money(brand["Avg. Price"]), icon: <Tag size={14} /> },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000cc",
      zIndex: 100, display: "flex", justifyContent: "flex-end"
    }} onClick={onClose}>
      <div style={{
        width: "min(720px, 95vw)", height: "100vh",
        background: "#080808", borderLeft: "1px solid #1a1a1a",
        overflowY: "auto", padding: "32px 28px",
        animation: "slideIn 0.25s ease"
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <div style={{ color: "#555", fontSize: 11, fontFamily: "'DM Mono'", marginBottom: 6 }}>BRAND ANALYSIS</div>
            <h2 style={{ margin: 0, fontSize: 26, fontFamily: "'Syne'", fontWeight: 800, color: "#fff" }}>
              {brand["Brand Name"]}
            </h2>
            <div style={{ color: "#555", fontSize: 13, marginTop: 4 }}>
              {brand["Main Category"]} → {brand["Primary Subcategory"]}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "#555", fontSize: 10, fontFamily: "'DM Mono'", marginBottom: 4 }}>FULFLD SCORE</div>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                border: `3px solid ${scoreColor(score)}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: scoreColor(score), fontFamily: "'DM Mono'", fontWeight: 700, fontSize: 18
              }}>{score}</div>
            </div>
            <button onClick={onClose} style={{
              background: "transparent", border: "1px solid #222",
              borderRadius: 8, padding: 8, cursor: "pointer", color: "#666",
              display: "flex", alignItems: "center"
            }}><X size={16} /></button>
          </div>
        </div>

        {/* Metrics Grid */}
        <div style={{ marginBottom: 28 }}>
          <SectionTitle icon={<Target size={14} />} label="Brand Metrics" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {metrics.map((m, i) => (
              <div key={i} style={{
                background: "#0d0d0d", border: "1px solid #1a1a1a",
                borderRadius: 8, padding: "12px 14px"
              }}>
                <div style={{ color: "#555", fontSize: 10, fontFamily: "'DM Mono'", marginBottom: 5, display: "flex", alignItems: "center", gap: 5 }}>
                  {m.icon} {m.label}
                </div>
                <div style={{ color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: "'DM Mono'" }}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Subcategory Share */}
        {subcat && (
          <div style={{ marginBottom: 28 }}>
            <SectionTitle icon={<Layers size={14} />} label="Subcategory Intelligence" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
              {[
                { label: "Subcategory Revenue", value: money(subcat["Estimated Monthly Revenue"]) },
                { label: "Seller Revenue Share", value: pct(subcat["Seller Revenue Share"]) },
                { label: "Amazon Revenue Share", value: pct(subcat["Amazon Revenue Share"]) },
                { label: "# Brands in Sub", value: fmt(subcat["Number of Brands"]) },
                { label: "Avg Sellers", value: fmt(subcat["Average Number of Sellers"]) },
                { label: "Avg Price", value: money(subcat["Average Price"]) },
              ].map((m, i) => (
                <div key={i} style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 8, padding: "10px 14px" }}>
                  <div style={{ color: "#555", fontSize: 10, fontFamily: "'DM Mono'", marginBottom: 4 }}>{m.label}</div>
                  <div style={{ color: "#fff", fontFamily: "'DM Mono'", fontWeight: 600 }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Ad Spy */}
        {adData && (
          <div style={{ marginBottom: 28 }}>
            <SectionTitle icon={<Zap size={14} />} label="Ad Intelligence" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
              {[
                { label: "Search Terms", value: fmt(adData["Search Terms"]) },
                { label: "Products with Ads", value: fmt(adData["Products with Ads"]) },
                { label: "Total Ad Spend", value: money(adData["Total Ad Spend"]) },
                { label: "Amazon Retail %", value: pct(adData["Percent of Sales by Amazon Retail"]) },
              ].map((m, i) => (
                <div key={i} style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 8, padding: "10px 14px" }}>
                  <div style={{ color: "#555", fontSize: 10, fontFamily: "'DM Mono'", marginBottom: 4 }}>{m.label}</div>
                  <div style={{ color: "#fff", fontFamily: "'DM Mono'", fontWeight: 600 }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Competitors */}
        {competitors.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <SectionTitle icon={<Users size={14} />} label={`Top Competitors in ${brand["Main Category"]}`} />
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1a1a1a" }}>
                  {["Seller", "Mo. Revenue", "FBA %", "Brands", "1M Growth"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#444", fontFamily: "'DM Mono'", fontWeight: 400, fontSize: 10 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {competitors.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #111" }}>
                    <td style={{ ...tdStyle, color: "#ccc", fontWeight: 500 }}>{c["Seller"] || "—"}</td>
                    <td style={{ ...tdStyle, fontFamily: "'DM Mono'" }}>{money(c["Estimated Monthly Revenue"])}</td>
                    <td style={{ ...tdStyle, fontFamily: "'DM Mono'" }}>{pct(c["Percent FBA"])}</td>
                    <td style={{ ...tdStyle, fontFamily: "'DM Mono'" }}>{c["Number of Brands Selling"] || "—"}</td>
                    <td style={tdStyle}><GrowthBadge value={c["1 Month Growth"]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Search Terms */}
        {searchTerms.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <SectionTitle icon={<Search size={14} />} label="Top Search Terms (Category)" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {searchTerms.map((t, i) => (
                <div key={i} style={{
                  background: "#0d0d0d", border: "1px solid #1a1a1a",
                  borderRadius: 20, padding: "6px 14px", fontSize: 12
                }}>
                  <span style={{ color: "#ccc" }}>{t["Search Term"]}</span>
                  <span style={{ color: "#555", fontFamily: "'DM Mono'", fontSize: 11, marginLeft: 8 }}>
                    {fmt(t["Estimated 30-day Search Volume"])}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Storefront Link */}
        {brand["Storefront Url"] && (
          <a href={brand["Storefront Url"]} target="_blank" rel="noreferrer" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "#00ff8712", border: "1px solid #00ff8740",
            borderRadius: 8, padding: "10px 18px", color: "#00ff87",
            textDecoration: "none", fontSize: 13, fontFamily: "'DM Mono'"
          }}>
            <ShoppingBag size={14} /> View Amazon Storefront ↗
          </a>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ icon, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, color: "#555", fontSize: 11, fontFamily: "'DM Mono'" }}>
      {icon} <span style={{ textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
    </div>
  );
}

// ─── GENERIC TABLE ─────────────────────────────────────────────────────────
function GenericTable({ data, type }) {
  const [sort, setSort] = useState({ col: null, dir: "desc" });
  const [search, setSearch] = useState("");

  if (!data.length) return <div style={{ color: "#444", padding: 40, textAlign: "center", fontFamily: "'DM Mono'" }}>No data</div>;
  const headers = Object.keys(data[0]).filter(k => !k.startsWith("__") && k !== "" && k !== "Product Image");

  const filtered = data.filter(row =>
    headers.some(h => String(row[h] || "").toLowerCase().includes(search.toLowerCase()))
  );

  const sorted = sort.col ? [...filtered].sort((a, b) => {
    let av = a[sort.col], bv = b[sort.col];
    av = isNaN(Number(av)) ? av : Number(av);
    bv = isNaN(Number(bv)) ? bv : Number(bv);
    if (av < bv) return sort.dir === "asc" ? -1 : 1;
    if (av > bv) return sort.dir === "asc" ? 1 : -1;
    return 0;
  }) : filtered;

  const toggle = (col) => setSort(s => ({ col, dir: s.col === col && s.dir === "desc" ? "asc" : "desc" }));

  const exportCSV = () => {
    const csv = Papa.unparse(sorted);
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fulfld_${type}_export.csv`;
    a.click();
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#666" }} />
          <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={inputStyle} />
        </div>
        <button onClick={exportCSV} style={{ ...btnStyle, background: "#00ff8720", borderColor: "#00ff8760", color: "#00ff87" }}>
          <Download size={14} /> Export
        </button>
        <span style={{ color: "#666", fontSize: 12, fontFamily: "'DM Mono'" }}>{sorted.length} rows</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #222" }}>
              {headers.map(h => (
                <th key={h} onClick={() => toggle(h)} style={{
                  padding: "9px 12px", textAlign: "left", cursor: "pointer",
                  color: sort.col === h ? "#00ff87" : "#555",
                  fontFamily: "'DM Mono'", fontWeight: 400, fontSize: 10,
                  whiteSpace: "nowrap", userSelect: "none"
                }}>
                  {h} {sort.col === h ? (sort.dir === "asc" ? "↑" : "↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 200).map((row, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #111", background: i % 2 === 0 ? "transparent" : "#0a0a0a" }}
                onMouseEnter={e => e.currentTarget.style.background = "#141414"}
                onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "#0a0a0a"}
              >
                {headers.map(h => (
                  <td key={h} style={{ ...tdStyle, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row[h] !== null && row[h] !== undefined ? String(row[h]) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > 200 && (
          <div style={{ textAlign: "center", padding: 16, color: "#555", fontFamily: "'DM Mono'", fontSize: 12 }}>
            Showing 200 of {sorted.length} rows — export CSV for full data
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SHARED STYLES ───────────────────────────────────────────────────────────
const inputStyle = {
  width: "100%", background: "#0d0d0d", border: "1px solid #222",
  borderRadius: 8, padding: "8px 10px 8px 34px", color: "#ccc",
  fontFamily: "'DM Mono'", fontSize: 13, outline: "none", boxSizing: "border-box"
};
const btnStyle = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "#0d0d0d", border: "1px solid #222",
  borderRadius: 8, padding: "8px 14px", color: "#888",
  cursor: "pointer", fontSize: 12, fontFamily: "'DM Mono'",
  whiteSpace: "nowrap", transition: "all 0.15s"
};
const tdStyle = { padding: "10px 14px", color: "#aaa", verticalAlign: "middle" };

const TYPE_LABELS = {
  brands: { label: "Brands", icon: <Tag size={14} /> },
  search_terms: { label: "Search Terms", icon: <Search size={14} /> },
  sellers: { label: "Sellers", icon: <Users size={14} /> },
  products: { label: "Products", icon: <ShoppingBag size={14} /> },
  adspy: { label: "AdSpy", icon: <Zap size={14} /> },
  subcategories: { label: "Subcategories", icon: <Layers size={14} /> },
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [allData, setAllData] = useState({});
  const [activeTab, setActiveTab] = useState(null);
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [dragging, setDragging] = useState(false);

  const parseFile = useCallback((file) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: ({ data, meta }) => {
        if (!data.length) return;
        const type = detectType(meta.fields || Object.keys(data[0]));
        setAllData(prev => ({ ...prev, [type]: data }));
        setActiveTab(prev => prev || type);
      }
    });
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    Array.from(e.dataTransfer.files).forEach(f => {
      if (f.name.endsWith(".csv")) parseFile(f);
    });
  }, [parseFile]);

  const handleFileInput = (e) => {
    Array.from(e.target.files).forEach(f => parseFile(f));
    e.target.value = "";
  };

  const loadedTypes = Object.keys(allData);

  return (
    <div style={{
      minHeight: "100vh", background: "#050505", color: "#ccc",
      fontFamily: "'Syne', sans-serif"
    }}>
      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 3px; }
        input:focus { outline: none; border-color: #333 !important; }
      `}</style>

      {/* Header */}
      <div style={{
        borderBottom: "1px solid #111", padding: "16px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, background: "#050505", zIndex: 50
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #00ff87, #0088ff)",
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
            <Target size={18} color="#000" strokeWidth={2.5} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.5px", color: "#fff" }}>
              Fulfld Brand Scout
            </div>
            <div style={{ fontSize: 11, color: "#444", fontFamily: "'DM Mono'" }}>
              SmartScout Intelligence Dashboard
            </div>
          </div>
        </div>
        <label style={{ ...btnStyle, cursor: "pointer", color: "#00ff87", borderColor: "#00ff8740", background: "#00ff8710" }}>
          <Upload size={13} /> Upload CSVs
          <input type="file" multiple accept=".csv" onChange={handleFileInput} style={{ display: "none" }} />
        </label>
      </div>

      {/* Drop Zone or Main Content */}
      {loadedTypes.length === 0 ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: "calc(100vh - 70px)",
            border: `2px dashed ${dragging ? "#00ff87" : "#1a1a1a"}`,
            margin: 32, borderRadius: 16, transition: "border-color 0.2s",
            background: dragging ? "#00ff8705" : "transparent"
          }}
        >
          <div style={{
            width: 72, height: 72, borderRadius: 20,
            background: "#0d0d0d", border: "1px solid #1a1a1a",
            display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20
          }}>
            <Upload size={28} color="#333" />
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 8 }}>
            Drop your SmartScout exports here
          </div>
          <div style={{ color: "#444", fontSize: 14, fontFamily: "'DM Mono'", textAlign: "center", lineHeight: 1.7 }}>
            Upload any combination of CSV exports:<br />
            Brands · Sellers · Products · Search Terms · AdSpy · Subcategories
          </div>
          <label style={{
            marginTop: 28, ...btnStyle, fontSize: 14, padding: "12px 24px",
            color: "#00ff87", borderColor: "#00ff8740", background: "#00ff8710", cursor: "pointer"
          }}>
            <Upload size={15} /> Choose Files
            <input type="file" multiple accept=".csv" onChange={handleFileInput} style={{ display: "none" }} />
          </label>
          <div style={{ marginTop: 40, display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            {Object.values(TYPE_LABELS).map(({ label, icon }) => (
              <div key={label} style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "#0d0d0d", border: "1px solid #1a1a1a",
                borderRadius: 20, padding: "6px 14px", fontSize: 12,
                color: "#555", fontFamily: "'DM Mono'"
              }}>
                {icon} {label}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: "0 32px 32px" }}>
          {/* Tabs */}
          <div style={{
            display: "flex", gap: 4, borderBottom: "1px solid #111",
            padding: "16px 0 0", marginBottom: 24, overflowX: "auto"
          }}>
            {loadedTypes.map(type => {
              const info = TYPE_LABELS[type] || { label: type, icon: null };
              return (
                <button key={type} onClick={() => setActiveTab(type)} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "transparent", border: "none", cursor: "pointer",
                  padding: "10px 16px", borderBottom: `2px solid ${activeTab === type ? "#00ff87" : "transparent"}`,
                  color: activeTab === type ? "#00ff87" : "#555",
                  fontFamily: "'DM Mono'", fontSize: 12, whiteSpace: "nowrap",
                  transition: "color 0.15s"
                }}>
                  {info.icon} {info.label}
                  <span style={{
                    background: "#111", borderRadius: 10,
                    padding: "1px 7px", fontSize: 10, color: "#444"
                  }}>{allData[type].length}</span>
                </button>
              );
            })}
            {/* Add more files */}
            <label style={{ ...btnStyle, marginLeft: "auto", marginBottom: 2, cursor: "pointer", fontSize: 12 }}>
              <Upload size={12} /> Add More
              <input type="file" multiple accept=".csv" onChange={handleFileInput} style={{ display: "none" }} />
            </label>
          </div>

          {/* Stats bar for brands */}
          {activeTab === "brands" && allData.brands && (
            <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
              {[
                {
                  label: "Total Brands", value: allData.brands.length,
                  sub: "uploaded"
                },
                {
                  label: "High Opportunity", color: "#00ff87",
                  value: allData.brands.filter(r => calcScore(r, "brands") >= 70).length,
                  sub: "score ≥ 70"
                },
                {
                  label: "Medium", color: "#ffd166",
                  value: allData.brands.filter(r => { const s = calcScore(r, "brands"); return s >= 45 && s < 70; }).length,
                  sub: "score 45–69"
                },
                {
                  label: "Low Amazon %", color: "#00ff87",
                  value: allData.brands.filter(r => Number(r["Sales %"]) < 30).length,
                  sub: "< 30% Amazon"
                },
                {
                  label: "Growing Brands",
                  value: allData.brands.filter(r => Number(r["1 Month Growth"]) > 0).length,
                  sub: "positive 1M"
                },
              ].map((s, i) => (
                <div key={i} style={{
                  background: "#0d0d0d", border: "1px solid #1a1a1a",
                  borderRadius: 10, padding: "14px 20px", flex: "1 1 140px"
                }}>
                  <div style={{ color: "#555", fontSize: 10, fontFamily: "'DM Mono'", marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: s.color || "#fff", fontFamily: "'Syne'" }}>{s.value}</div>
                  <div style={{ color: "#444", fontSize: 10, fontFamily: "'DM Mono'" }}>{s.sub}</div>
                </div>
              ))}
            </div>
          )}

          {/* Tab Content */}
          {activeTab && allData[activeTab] && (
            activeTab === "brands"
              ? <BrandsTable data={allData.brands} onSelectBrand={setSelectedBrand} />
              : <GenericTable data={allData[activeTab]} type={activeTab} />
          )}
        </div>
      )}

      {/* Brand Detail Panel */}
      {selectedBrand && (
        <BrandDetail brand={selectedBrand} allData={allData} onClose={() => setSelectedBrand(null)} />
      )}
    </div>
  );
}
