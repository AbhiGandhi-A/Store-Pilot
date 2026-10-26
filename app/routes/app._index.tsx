import { useEffect, useState, useMemo } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { AdminGraphQL } from "~/services/shopify.admin.server";
import { analyzeInventory, type AnalysisResult } from "~/services/inventory.intelligence.server";
import { getAIExplanations, type AIExplanationResult, type AIExplanation } from "~/services/ai/inventory.explanations.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const adminGraphQL = admin as unknown as AdminGraphQL;

  const { getOrCreateShop, fetchShopInfo } = await import("~/services/shopify.admin.server");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const shopInfo = await fetchShopInfo(adminGraphQL);
    const shop = await getOrCreateShop(shopInfo.myshopifyDomain, shopInfo);

    const syncTracking = await prisma.syncTracking.findMany({
      where: { shopId: shop.id },
      orderBy: { startedAt: "desc" },
      take: 10,
    });

    const productCount = await prisma.product.count({ where: { shopId: shop.id } });
    const variantCount = await prisma.productVariant.count({ where: { shopId: shop.id } });
    const locationCount = await prisma.location.count({ where: { shopId: shop.id, isActive: true } });
    const inventoryLevelCount = await prisma.inventoryLevel.count({ where: { shopId: shop.id } });

    const lastSuccessfulSync = syncTracking.find((s) => s.status === "completed");

    let inventoryAnalysis: AnalysisResult | null = null;
    let aiExplanations: AIExplanationResult | null = null;
    if (variantCount > 0 && inventoryLevelCount > 0) {
      try {
        inventoryAnalysis = await analyzeInventory(shop.id, adminGraphQL);

        if (inventoryAnalysis && inventoryAnalysis.findings.length > 0) {
          try {
            aiExplanations = await getAIExplanations(inventoryAnalysis.findings, inventoryAnalysis.settings);
          } catch (error) {
            console.error("AI explanations failed:", error);
          }
        }
      } catch (error) {
        console.error("Inventory analysis failed:", error);
      }
    }

    return {
      shop: {
        id: shop.id,
        domain: shop.domain,
        name: shop.name,
      },
      stats: {
        products: productCount,
        variants: variantCount,
        locations: locationCount,
        inventoryLevels: inventoryLevelCount,
      },
      syncHistory: syncTracking,
      lastSuccessfulSync: lastSuccessfulSync
        ? {
            type: lastSuccessfulSync.syncType,
            completedAt: lastSuccessfulSync.completedAt,
            recordsProcessed: lastSuccessfulSync.recordsProcessed,
          }
        : null,
      inventoryAnalysis,
      aiExplanations,
    };
  } finally {
    await prisma.$disconnect();
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const adminGraphQL = admin as unknown as AdminGraphQL;

  const formData = await request.formData();
  const syncType = formData.get("syncType") as string | null;

  const { getOrCreateShop, fetchShopInfo } = await import("~/services/shopify.admin.server");
  const { syncAll, syncProducts, syncLocations, syncInventoryLevels } = await import("~/services/sync.server");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const shopInfo = await fetchShopInfo(adminGraphQL);
    const shop = await getOrCreateShop(shopInfo.myshopifyDomain, shopInfo);

    let results: Array<{
      success: boolean;
      recordsProcessed: number;
      recordsCreated: number;
      recordsUpdated: number;
      recordsFailed: number;
      error?: string;
    }> = [];

    if (syncType === "full" || !syncType) {
      results = await syncAll(adminGraphQL);
    } else {
      switch (syncType) {
        case "shop":
          results = [{ success: true, recordsProcessed: 1, recordsCreated: 1, recordsUpdated: 0, recordsFailed: 0 }];
          break;
        case "products":
          results = [await syncProducts(adminGraphQL, shop.id)];
          break;
        case "locations":
          results = [await syncLocations(adminGraphQL, shop.id)];
          break;
        case "inventory_levels":
          results = [await syncInventoryLevels(adminGraphQL, shop.id)];
          break;
        default:
          results = await syncAll(adminGraphQL);
      }
    }

    const totalProcessed = results.reduce((sum, r) => sum + r.recordsProcessed, 0);
    const totalCreated = results.reduce((sum, r) => sum + r.recordsCreated, 0);
    const totalUpdated = results.reduce((sum, r) => sum + r.recordsUpdated, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.recordsFailed, 0);
    const allSuccess = results.every((r) => r.success);
    const failedResult = results.find((r) => !r.success);
    const safeError = failedResult?.error || (allSuccess ? undefined : "One or more sync operations failed");

    return {
      success: allSuccess,
      error: safeError,
      summary: {
        totalProcessed,
        totalCreated,
        totalUpdated,
        totalFailed,
        syncTypes: results.map((r) => (r.success ? "completed" : "failed")),
      },
      details: results,
    };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Unknown error";
    const message = rawMessage
      .replace(/(?:shpat_|shpss_|Bearer\s+)[a-zA-Z0-9_-]+/gi, "[REDACTED_SECRET]")
      .replace(/postgresql:\/\/[^@]+@/gi, "postgresql://[REDACTED_USER_INFO]@")
      .replace(/api[-_]?key[=:\s]+[a-zA-Z0-9_-]+/gi, "api_key=[REDACTED]");
    console.error("[StockPilot Sync Action Error]:", error);
    return { success: false, error: message };
  } finally {
    await prisma.$disconnect();
  }
};

function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFindingTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    OUT_OF_STOCK: "Out of Stock",
    LOW_STOCK: "Low Stock",
    STOCKOUT_RISK: "Stockout Risk",
    SLOW_MOVING: "Slow Moving",
    POTENTIAL_DEAD_STOCK: "Potential Dead Stock",
    EXCESS_INVENTORY: "Excess Inventory",
    REORDER_RECOMMENDED: "Reorder Recommended",
    INSUFFICIENT_HISTORY: "Insufficient History",
    STALE_DATA: "Stale Data",
    NEGATIVE_INVENTORY: "Negative Inventory",
    MISSING_DATA: "Missing Data",
    ZERO_DEMAND: "Zero Demand",
  };
  return labels[type] || type.replace(/_/g, " ");
}

export default function Dashboard() {
  const { shop, stats, syncHistory, lastSuccessfulSync, inventoryAnalysis, aiExplanations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [activeTab, setActiveTab] = useState<"findings" | "health" | "sync">("findings");
  const [findingSearch, setFindingSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set());

  const isLoading = ["loading", "submitting"].includes(fetcher.state) && fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data) {
      if (fetcher.data.success) {
        shopify.toast.show(`Sync completed: ${fetcher.data.summary?.totalProcessed || 0} records processed`);
      } else {
        shopify.toast.show(`Sync failed: ${fetcher.data.error || "Unknown error"}`);
      }
    }
  }, [fetcher.data, shopify]);

  const triggerSync = (type?: string) => {
    const formData = new FormData();
    if (type) formData.set("syncType", type);
    fetcher.submit(formData, { method: "POST" });
  };

  const toggleExpand = (findingId: string) => {
    setExpandedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(findingId)) next.delete(findingId);
      else next.add(findingId);
      return next;
    });
  };

  const analysis = inventoryAnalysis;
  const summary = analysis?.summary;
  const findings = useMemo(() => analysis?.findings || [], [analysis?.findings]);
  const dataQuality = analysis?.dataQuality;

  // Filtered findings
  const filteredFindings = useMemo(() => {
    return findings.filter((f) => {
      const matchesSearch =
        !findingSearch ||
        f.productTitle.toLowerCase().includes(findingSearch.toLowerCase()) ||
        f.variantTitle.toLowerCase().includes(findingSearch.toLowerCase()) ||
        (f.sku && f.sku.toLowerCase().includes(findingSearch.toLowerCase()));
      const matchesSeverity = severityFilter === "all" || f.severity === severityFilter;
      return matchesSearch && matchesSeverity;
    });
  }, [findings, findingSearch, severityFilter]);

  const criticalIssuesCount = (summary?.outOfStock || 0) + (summary?.stockoutRisk || 0);
  const warningIssuesCount = (summary?.lowStock || 0) + (summary?.reorderRecommended || 0) + (summary?.potentialDeadStock || 0);

  return (
    <div className="sp-page-layout">
      {/* Page Header */}
      <div className="sp-page-header">
        <div className="sp-page-title-group">
          <h1 className="sp-page-title">
            StockPilot Inventory Dashboard
            {shop?.name && <span className="sp-badge sp-badge-neutral">{shop.name}</span>}
          </h1>
          <p className="sp-page-subtitle">
            Autonomous inventory intelligence, AI demand insights, and replenishment workflows.
          </p>
        </div>

        <div className="sp-header-actions" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            className="sp-btn sp-btn-secondary"
            onClick={() => triggerSync("products")}
            disabled={isLoading}
            title="Sync products and variants from Shopify"
          >
            Sync Products
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-secondary"
            onClick={() => triggerSync("locations")}
            disabled={isLoading}
            title="Sync fulfillment and warehouse locations"
          >
            Sync Locations
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-secondary"
            onClick={() => triggerSync("inventory_levels")}
            disabled={isLoading}
            title="Sync inventory levels from Shopify"
          >
            Sync Inventory
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-primary"
            onClick={() => triggerSync("full")}
            disabled={isLoading}
            title="Run full store sync"
          >
            {isLoading ? "Syncing..." : "Run Full Sync"}
          </button>
        </div>
      </div>

      {/* Sync Status Banner if recently run */}
      {fetcher.data && (
        <div className={`sp-banner ${fetcher.data.success ? "success" : "critical"}`}>
          <div className="sp-banner-icon">{fetcher.data.success ? "✓" : "⚠"}</div>
          <div className="sp-banner-content">
            <h4 className="sp-banner-title">{fetcher.data.success ? "Sync Completed Successfully" : "Sync Failed"}</h4>
            <p className="sp-banner-message">
              {fetcher.data.success ? (
                <>
                  Processed: <strong>{fetcher.data.summary?.totalProcessed || 0}</strong> records | Created:{" "}
                  <strong>{fetcher.data.summary?.totalCreated || 0}</strong> | Updated:{" "}
                  <strong>{fetcher.data.summary?.totalUpdated || 0}</strong> | Failed:{" "}
                  <strong>{fetcher.data.summary?.totalFailed || 0}</strong>
                </>
              ) : (
                fetcher.data.error || "An unexpected error occurred during sync."
              )}
            </p>
          </div>
        </div>
      )}

      {/* Executive KPI Overview Cards */}
      <div className="sp-kpi-grid">
        <div className={`sp-kpi-card ${criticalIssuesCount > 0 ? "critical" : "success"}`}>
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Stockout Risks</span>
            <span className={`sp-badge ${criticalIssuesCount > 0 ? "sp-badge-critical" : "sp-badge-success"}`}>
              <span className="sp-badge-dot" />
              {criticalIssuesCount > 0 ? "Urgent Action" : "Healthy"}
            </span>
          </div>
          <div className="sp-kpi-value">{criticalIssuesCount}</div>
          <div className="sp-kpi-meta">
            <span>{summary?.outOfStock || 0} out of stock · {summary?.stockoutRisk || 0} imminent risk</span>
          </div>
        </div>

        <div className={`sp-kpi-card ${warningIssuesCount > 0 ? "warning" : "info"}`}>
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Reorder Needed</span>
            <span className="sp-badge sp-badge-warning">
              <span className="sp-badge-dot" />
              Reorder
            </span>
          </div>
          <div className="sp-kpi-value">{summary?.reorderRecommended || 0}</div>
          <div className="sp-kpi-meta">
            <Link to="/app/reorder" className="sp-btn-plain" style={{ padding: 0 }}>
              Review reorder recommendations →
            </Link>
          </div>
        </div>

        <div className="sp-kpi-card info">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Excess / Slow Moving</span>
            <span className="sp-badge sp-badge-info">
              <span className="sp-badge-dot" />
              Capital Tied
            </span>
          </div>
          <div className="sp-kpi-value">{(summary?.excessInventory || 0) + (summary?.slowMoving || 0)}</div>
          <div className="sp-kpi-meta">
            <span>{summary?.excessInventory || 0} excess · {summary?.potentialDeadStock || 0} dead stock</span>
          </div>
        </div>

        <div className="sp-kpi-card">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Active Catalog</span>
            <span className="sp-badge sp-badge-neutral">
              <span className="sp-badge-dot" />
              Store Size
            </span>
          </div>
          <div className="sp-kpi-value">{stats?.variants || 0}</div>
          <div className="sp-kpi-meta">
            <span>{stats?.products || 0} products across {stats?.locations || 0} location(s)</span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="sp-tabs-nav">
        <button
          type="button"
          className={`sp-tab-btn ${activeTab === "findings" ? "active" : ""}`}
          onClick={() => setActiveTab("findings")}
        >
          <span>Inventory Findings & AI Insights</span>
          <span className="sp-tab-count">{findings.length}</span>
        </button>

        <button
          type="button"
          className={`sp-tab-btn ${activeTab === "health" ? "active" : ""}`}
          onClick={() => setActiveTab("health")}
        >
          <span>Inventory Health Breakdown</span>
          <span className="sp-tab-count">7 Metrics</span>
        </button>

        <button
          type="button"
          className={`sp-tab-btn ${activeTab === "sync" ? "active" : ""}`}
          onClick={() => setActiveTab("sync")}
        >
          <span>Data Sync & Status</span>
          <span className="sp-tab-count">{syncHistory?.length || 0}</span>
        </button>
      </div>

      {/* TAB 1: FINDINGS & AI INSIGHTS */}
      {activeTab === "findings" && (
        <div className="sp-card">
          {/* AI Status Banner if explanations available */}
          {aiExplanations && (
            <div style={{ padding: "16px 20px 0" }}>
              <div className="sp-ai-card">
                <div className="sp-ai-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span className="sp-badge sp-badge-ai">✨ Groq AI Intelligence</span>
                    <span style={{ fontSize: "12px", color: "var(--p-color-ai-text)", fontWeight: 500 }}>
                      Model: {aiExplanations.model}
                    </span>
                  </div>
                  <span style={{ fontSize: "12px", color: "var(--p-color-text-subdued)" }}>
                    {aiExplanations.explanations.length} insights generated · {aiExplanations.totalTokensUsed} tokens
                  </span>
                </div>
                <div style={{ fontSize: "13px", color: "var(--p-color-text-secondary)", lineHeight: 1.4 }}>
                  AI explanations provide automated root-cause analysis, demand projection reasoning, and replenishment recommendations for every detected inventory anomaly.
                </div>
                {aiExplanations.warnings.length > 0 && (
                  <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--p-color-warning-text)" }}>
                    ⚠ {aiExplanations.warnings.join("; ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Findings Filter Toolbar */}
          <div className="sp-toolbar">
            <div className="sp-toolbar-left">
              <div className="sp-search-box">
                <span className="sp-search-icon">🔍</span>
                <input
                  type="text"
                  className="sp-input"
                  placeholder="Filter by product title, variant, or SKU..."
                  value={findingSearch}
                  onChange={(e) => setFindingSearch(e.target.value)}
                />
              </div>

              <select
                className="sp-select"
                style={{ width: "auto" }}
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
              >
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </div>

            <div className="sp-toolbar-right">
              <span className="subdued-text">
                Showing {filteredFindings.length} of {findings.length} findings
              </span>
              <Link to="/app/reorder" className="sp-btn sp-btn-primary sp-btn-slim">
                Go to Reorder Planning →
              </Link>
            </div>
          </div>

          {/* Findings Table */}
          {filteredFindings.length > 0 ? (
            <div className="sp-table-wrapper">
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>Product / Variant</th>
                    <th>SKU</th>
                    <th>Finding</th>
                    <th>Severity</th>
                    <th style={{ textAlign: "right" }}>Available</th>
                    <th style={{ textAlign: "right" }}>Days Left</th>
                    <th style={{ textAlign: "right" }}>Reorder Qty</th>
                    <th>Evidence</th>
                    <th style={{ textAlign: "center" }}>AI Insight</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFindings.map((finding) => {
                    const aiExplanation = aiExplanations?.explanations.find((e) => e.findingId === finding.id);
                    const isExpanded = expandedFindings.has(finding.id);

                    return (
                      <FindingItem
                        key={finding.id}
                        finding={finding}
                        aiExplanation={aiExplanation}
                        isExpanded={isExpanded}
                        onToggleExpand={() => toggleExpand(finding.id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="sp-empty-state">
              <span className="sp-empty-icon">✓</span>
              <h3 className="sp-empty-title">
                {findings.length === 0 ? "No inventory issues detected!" : "No findings match your filter"}
              </h3>
              <p className="sp-empty-desc">
                {findings.length === 0
                  ? "All analyzed inventory items are within healthy stock thresholds and normal demand patterns."
                  : "Try clearing your search query or choosing another severity level."}
              </p>
              {findings.length === 0 ? (
                <button
                  type="button"
                  className="sp-btn sp-btn-secondary"
                  onClick={() => triggerSync("full")}
                  disabled={isLoading}
                >
                  Refresh Inventory Analysis
                </button>
              ) : (
                <button
                  type="button"
                  className="sp-btn sp-btn-plain"
                  onClick={() => {
                    setFindingSearch("");
                    setSeverityFilter("all");
                  }}
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: INVENTORY HEALTH BREAKDOWN */}
      {activeTab === "health" && (
        <div>
          {/* Detailed Severity Breakdown */}
          <div className="sp-card">
            <div className="sp-card-header">
              <h3 className="sp-card-title">Inventory Risk Classification</h3>
              <span className="sp-badge sp-badge-neutral">{stats?.variants || 0} Variants Analyzed</span>
            </div>
            <div className="sp-card-body">
              <div className="sp-kpi-grid" style={{ marginBottom: 0 }}>
                <div className="sp-kpi-card critical">
                  <div className="sp-kpi-label">Out of Stock</div>
                  <div className="sp-kpi-value">{summary?.outOfStock || 0}</div>
                  <div className="sp-kpi-meta">Variants at 0 or negative quantity</div>
                </div>

                <div className="sp-kpi-card critical">
                  <div className="sp-kpi-label">Stockout Risk</div>
                  <div className="sp-kpi-value">{summary?.stockoutRisk || 0}</div>
                  <div className="sp-kpi-meta">Stock will run out before supplier lead time</div>
                </div>

                <div className="sp-kpi-card warning">
                  <div className="sp-kpi-label">Low Stock</div>
                  <div className="sp-kpi-value">{summary?.lowStock || 0}</div>
                  <div className="sp-kpi-meta">Below safety stock threshold</div>
                </div>

                <div className="sp-kpi-card warning">
                  <div className="sp-kpi-label">Reorder Recommended</div>
                  <div className="sp-kpi-value">{summary?.reorderRecommended || 0}</div>
                  <div className="sp-kpi-meta">Optimal reorder trigger reached</div>
                </div>

                <div className="sp-kpi-card info">
                  <div className="sp-kpi-label">Slow Moving</div>
                  <div className="sp-kpi-value">{summary?.slowMoving || 0}</div>
                  <div className="sp-kpi-meta">Low velocity over analysis window</div>
                </div>

                <div className="sp-kpi-card warning">
                  <div className="sp-kpi-label">Potential Dead Stock</div>
                  <div className="sp-kpi-value">{summary?.potentialDeadStock || 0}</div>
                  <div className="sp-kpi-meta">Zero sales in the last 60+ days</div>
                </div>

                <div className="sp-kpi-card info">
                  <div className="sp-kpi-label">Excess Inventory</div>
                  <div className="sp-kpi-value">{summary?.excessInventory || 0}</div>
                  <div className="sp-kpi-meta">More than 90 days of forward cover</div>
                </div>
              </div>
            </div>
          </div>

          {/* Data Quality & Hygiene Diagnostics */}
          {dataQuality && (
            <div className="sp-card">
              <div className="sp-card-header">
                <h3 className="sp-card-title">Data Quality & Analysis Diagnostics</h3>
                <span className="sp-badge sp-badge-info">{dataQuality.analysisPeriodDays} Days Window</span>
              </div>
              <div className="sp-card-body">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                  <div>
                    <div className="sp-kpi-label">Variants Analyzed</div>
                    <div style={{ fontSize: "20px", fontWeight: 600 }}>{dataQuality.totalVariantsAnalyzed}</div>
                  </div>
                  <div>
                    <div className="sp-kpi-label">With Demand History</div>
                    <div style={{ fontSize: "20px", fontWeight: 600 }}>{dataQuality.variantsWithDemandData}</div>
                  </div>
                  <div>
                    <div className="sp-kpi-label">Inventory Tracked</div>
                    <div style={{ fontSize: "20px", fontWeight: 600 }}>{dataQuality.variantsWithInventoryData}</div>
                  </div>
                  <div>
                    <div className="sp-kpi-label">Oldest Inventory Sync</div>
                    <div style={{ fontSize: "14px", fontWeight: 500, marginTop: "4px" }}>
                      {formatDate(dataQuality.oldestInventorySync)}
                    </div>
                  </div>
                </div>

                {summary && (summary.insufficientHistory > 0 || summary.staleData > 0 || summary.negativeInventory > 0) && (
                  <div style={{ marginTop: "20px" }}>
                    <div className="sp-banner warning" style={{ marginBottom: 0 }}>
                      <div className="sp-banner-icon">⚠</div>
                      <div className="sp-banner-content">
                        <h4 className="sp-banner-title">Data Quality Warnings</h4>
                        <ul style={{ margin: "4px 0 0 16px", padding: 0, fontSize: "13px" }}>
                          {summary.insufficientHistory > 0 && (
                            <li>{summary.insufficientHistory} variant(s) have insufficient sales history for demand-based velocity calculations.</li>
                          )}
                          {summary.staleData > 0 && (
                            <li>{summary.staleData} variant(s) have inventory records older than 24 hours.</li>
                          )}
                          {summary.negativeInventory > 0 && (
                            <li>{summary.negativeInventory} variant(s) report negative quantities at one or more locations.</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: DATA SYNC & STATUS */}
      {activeTab === "sync" && (
        <div>
          {/* Last Sync Summary Card */}
          <div className="sp-card">
            <div className="sp-card-header">
              <h3 className="sp-card-title">Shopify Store Synchronization Status</h3>
              {lastSuccessfulSync && (
                <span className="sp-badge sp-badge-success">
                  <span className="sp-badge-dot" /> Connected & Synced
                </span>
              )}
            </div>
            <div className="sp-card-body">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px", marginBottom: "20px" }}>
                <div>
                  <div className="sp-kpi-label">Last Successful Sync</div>
                  <div style={{ fontSize: "16px", fontWeight: 600, marginTop: "4px" }}>
                    {lastSuccessfulSync ? formatDate(lastSuccessfulSync.completedAt) : "Never"}
                  </div>
                  <div className="subdued-text">Sync Type: {lastSuccessfulSync?.type || "N/A"}</div>
                </div>

                <div>
                  <div className="sp-kpi-label">Records Processed</div>
                  <div style={{ fontSize: "16px", fontWeight: 600, marginTop: "4px" }}>
                    {lastSuccessfulSync?.recordsProcessed ?? 0}
                  </div>
                  <div className="subdued-text">Products, variants, and levels</div>
                </div>

                <div>
                  <div className="sp-kpi-label">Synced Shop Domain</div>
                  <div style={{ fontSize: "14px", fontWeight: 600, fontFamily: "var(--p-font-mono)", marginTop: "4px" }}>
                    {shop.domain}
                  </div>
                  <div className="subdued-text">Store ID: {shop.id.substring(0, 8)}...</div>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--p-color-border-subdued)", paddingTop: "16px" }}>
                <div className="sp-kpi-label" style={{ marginBottom: "10px" }}>Trigger On-Demand Sync</div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="sp-btn sp-btn-secondary"
                    onClick={() => triggerSync("products")}
                    disabled={isLoading}
                  >
                    Sync Products & Variants
                  </button>
                  <button
                    type="button"
                    className="sp-btn sp-btn-secondary"
                    onClick={() => triggerSync("locations")}
                    disabled={isLoading}
                  >
                    Sync Fulfillment Locations
                  </button>
                  <button
                    type="button"
                    className="sp-btn sp-btn-secondary"
                    onClick={() => triggerSync("inventory_levels")}
                    disabled={isLoading}
                  >
                    Sync Inventory Levels
                  </button>
                  <button
                    type="button"
                    className="sp-btn sp-btn-primary"
                    onClick={() => triggerSync("full")}
                    disabled={isLoading}
                  >
                    {isLoading ? "Running Full Sync..." : "Sync Everything Now"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Sync History Table */}
          <div className="sp-card">
            <div className="sp-card-header">
              <h3 className="sp-card-title">Recent Sync Execution Log</h3>
              <span className="subdued-text">Last 10 sync jobs</span>
            </div>
            {syncHistory && syncHistory.length > 0 ? (
              <div className="sp-table-wrapper">
                <table className="sp-table">
                  <thead>
                    <tr>
                      <th>Sync Type</th>
                      <th>Status</th>
                      <th>Started</th>
                      <th>Completed</th>
                      <th style={{ textAlign: "right" }}>Processed</th>
                      <th style={{ textAlign: "right" }}>Created</th>
                      <th style={{ textAlign: "right" }}>Updated</th>
                      <th style={{ textAlign: "right" }}>Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncHistory.map((sync) => (
                      <tr key={sync.id}>
                        <td className="primary-cell" style={{ textTransform: "capitalize" }}>
                          {sync.syncType.replace(/_/g, " ")}
                        </td>
                        <td>
                          <span
                            className={`sp-badge ${
                              sync.status === "completed"
                                ? "sp-badge-success"
                                : sync.status === "failed"
                                ? "sp-badge-critical"
                                : "sp-badge-info"
                            }`}
                          >
                            <span className="sp-badge-dot" />
                            {sync.status}
                          </span>
                        </td>
                        <td className="subdued-text">{formatDate(sync.startedAt)}</td>
                        <td className="subdued-text">{formatDate(sync.completedAt)}</td>
                        <td className="mono" style={{ textAlign: "right" }}>
                          {sync.recordsProcessed}
                        </td>
                        <td className="mono" style={{ textAlign: "right", color: "var(--p-color-success-text)" }}>
                          {sync.recordsCreated}
                        </td>
                        <td className="mono" style={{ textAlign: "right" }}>
                          {sync.recordsUpdated}
                        </td>
                        <td
                          className="mono"
                          style={{
                            textAlign: "right",
                            color: sync.recordsFailed > 0 ? "var(--p-color-critical-text)" : undefined,
                            fontWeight: sync.recordsFailed > 0 ? 600 : undefined,
                          }}
                        >
                          {sync.recordsFailed}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="sp-empty-state">
                <span className="sp-empty-icon">ℹ</span>
                <h3 className="sp-empty-title">No Sync History Yet</h3>
                <p className="sp-empty-desc">
                  Run your first store synchronization to populate catalog and inventory tracking records.
                </p>
                <button
                  type="button"
                  className="sp-btn sp-btn-primary"
                  onClick={() => triggerSync("full")}
                  disabled={isLoading}
                >
                  Start First Full Sync
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FindingItem({
  finding,
  aiExplanation,
  isExpanded,
  onToggleExpand,
}: {
  finding: AnalysisResult["findings"][0];
  aiExplanation: AIExplanation | undefined;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const hasAI = !!aiExplanation;

  const severityBadgeClass =
    finding.severity === "critical"
      ? "sp-badge-critical"
      : finding.severity === "warning"
      ? "sp-badge-warning"
      : "sp-badge-info";

  return (
    <>
      <tr style={{ backgroundColor: isExpanded ? "var(--p-color-bg-subdued)" : undefined }}>
        <td>
          <div className="primary-cell">{finding.productTitle}</div>
          <div className="subdued-text">{finding.variantTitle}</div>
        </td>
        <td className="mono">{finding.sku || "—"}</td>
        <td>
          <span style={{ fontWeight: 500 }}>{getFindingTypeLabel(finding.findingType)}</span>
        </td>
        <td>
          <span className={`sp-badge ${severityBadgeClass}`}>
            <span className="sp-badge-dot" />
            {finding.severity}
          </span>
        </td>
        <td
          className="mono"
          style={{
            textAlign: "right",
            fontWeight: 600,
            color: finding.availableQuantity <= 0 ? "var(--p-color-critical-text)" : undefined,
          }}
        >
          {finding.availableQuantity}
        </td>
        <td className="mono" style={{ textAlign: "right" }}>
          {finding.daysRemaining !== null ? (
            <span
              style={{
                fontWeight: finding.daysRemaining < 7 ? 600 : 400,
                color: finding.daysRemaining < 7 ? "var(--p-color-critical-text)" : undefined,
              }}
            >
              {finding.daysRemaining} d
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>
          {finding.suggestedReorderQuantity !== null && finding.suggestedReorderQuantity > 0 ? (
            <span style={{ color: "var(--p-color-text-primary)" }}>{finding.suggestedReorderQuantity}</span>
          ) : (
            "—"
          )}
        </td>
        <td style={{ maxWidth: "220px" }}>
          <div className="subdued-text" style={{ whiteSpace: "normal", lineHeight: 1.3 }}>
            {finding.evidence.slice(0, 2).join("; ")}
          </div>
        </td>
        <td style={{ textAlign: "center" }}>
          {hasAI ? (
            <button
              type="button"
              className={`sp-btn sp-btn-slim ${isExpanded ? "sp-btn-secondary" : "sp-btn-plain"}`}
              onClick={onToggleExpand}
              style={{ fontSize: "11px", fontWeight: 600 }}
            >
              {isExpanded ? "Hide AI" : "AI Insight ✨"}
            </button>
          ) : (
            <span className="subdued-text" style={{ fontSize: "11px" }}>—</span>
          )}
        </td>
      </tr>

      {/* Expanded AI Insight Panel */}
      {hasAI && isExpanded && aiExplanation && (
        <tr>
          <td colSpan={9} style={{ padding: "0 16px 16px 16px", backgroundColor: "var(--p-color-bg-subdued)" }}>
            <div className="sp-ai-card">
              <div className="sp-ai-header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className="sp-badge sp-badge-ai">✨ AI Analysis</span>
                  <span className={`sp-badge ${aiExplanation.urgency === "high" ? "sp-badge-critical" : "sp-badge-warning"}`}>
                    {aiExplanation.urgency} urgency
                  </span>
                  <span style={{ fontSize: "12px", color: "var(--p-color-text-subdued)" }}>
                    Confidence: <strong>{aiExplanation.confidence}%</strong>
                  </span>
                </div>
                <Link to="/app/reorder" className="sp-btn sp-btn-primary sp-btn-slim">
                  Plan Reorder →
                </Link>
              </div>

              <div style={{ fontSize: "13px", lineHeight: 1.5, color: "var(--p-color-text-primary)", marginBottom: "12px" }}>
                {aiExplanation.explanation}
              </div>

              <div className="sp-ai-recommendation-box">
                <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "var(--p-color-ai-text)", marginBottom: "4px" }}>
                  Recommended Action
                </div>
                <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--p-color-text-primary)" }}>
                  {aiExplanation.recommendedAction}
                </div>
              </div>

              {(aiExplanation.assumptions.length > 0 || aiExplanation.limitations.length > 0) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "12px", paddingTop: "10px", borderTop: "1px dashed var(--p-color-border-subdued)" }}>
                  {aiExplanation.assumptions.length > 0 && (
                    <div>
                      <div className="sp-kpi-label" style={{ marginBottom: "4px" }}>Assumptions</div>
                      <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", color: "var(--p-color-text-subdued)" }}>
                        {aiExplanation.assumptions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiExplanation.limitations.length > 0 && (
                    <div>
                      <div className="sp-kpi-label" style={{ marginBottom: "4px" }}>Limitations</div>
                      <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", color: "var(--p-color-text-subdued)" }}>
                        {aiExplanation.limitations.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
