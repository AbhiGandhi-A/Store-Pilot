/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState, useMemo } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getReorderSuggestions, type ReorderSuggestion } from "~/services/reorder.server";
import { AdminGraphQL } from "~/services/shopify.admin.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const adminGraphQL = admin as unknown as AdminGraphQL;
  const { shop } = session;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const shopRecord = await prisma.shop.findUnique({ where: { domain: shop }, select: { id: true } });
    if (!shopRecord) {
      return {
        suggestions: [],
        summary: { totalSuggestions: 0, highPriority: 0, estimatedTotal: 0, withSupplier: 0, withoutSupplier: 0 },
      };
    }

    const result = await getReorderSuggestions(shopRecord.id, adminGraphQL);
    return result;
  } finally {
    await prisma.$disconnect();
  }
};

export default function ReorderPlanningPage() {
  const { suggestions, summary } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expectedDate, setExpectedDate] = useState("");
  const [viewMode, setViewMode] = useState<"grouped" | "table">("grouped");
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [createdOrders, setCreatedOrders] = useState<Array<{ purchaseOrderId: string; poNumber: string; itemsAdded: number }> | null>(null);

  const isLoading = fetcher.state === "submitting";

  useEffect(() => {
    if (fetcher.data?.success) {
      setCreatedOrders(fetcher.data.results || []);
      setSelectedItems(new Set());
      shopify.toast.show(`Created ${fetcher.data.results?.length || 0} purchase order(s) successfully`);
    }
    if (fetcher.data?.error) {
      shopify.toast.show(`Error: ${fetcher.data.error}`);
    }
  }, [fetcher.data, shopify]);

  const handleSelectionChange = (findingId: string, checked: boolean) => {
    const next = new Set(selectedItems);
    if (checked) next.add(findingId);
    else next.delete(findingId);
    setSelectedItems(next);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // Select only items that have a supplier mapped
      const eligible = suggestions.filter((s) => s.supplierProduct).map((s) => s.finding.id);
      setSelectedItems(new Set(eligible));
    } else {
      setSelectedItems(new Set());
    }
  };

  const handleSelectSupplierGroup = (supplierId: string, checked: boolean) => {
    const next = new Set(selectedItems);
    suggestions
      .filter((s) => s.supplierProduct && s.supplierProduct.supplier.id === supplierId)
      .forEach((s) => {
        if (checked) next.add(s.finding.id);
        else next.delete(s.finding.id);
      });
    setSelectedItems(next);
  };

  const handleCreatePO = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedItems.size === 0) return;

    const items = Array.from(selectedItems)
      .map((findingId) => {
        const suggestion = suggestions.find((s) => s.finding.id === findingId);
        if (!suggestion || !suggestion.supplierProduct) return null;
        return {
          findingId: suggestion.finding.id,
          supplierProductId: suggestion.supplierProduct.id,
          orderedQty: suggestion.suggestedOrderQty,
        };
      })
      .filter(Boolean);

    const formData = new FormData();
    formData.set("suggestions", JSON.stringify(items));
    if (expectedDate) formData.set("expectedDate", expectedDate);
    fetcher.submit(formData, { method: "POST", action: "/app/reorder/create-po" });
  };

  // Filtered suggestions
  const filteredSuggestions = useMemo(() => {
    return suggestions.filter((s) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        s.finding.productTitle.toLowerCase().includes(q) ||
        s.finding.variantTitle.toLowerCase().includes(q) ||
        (s.finding.sku && s.finding.sku.toLowerCase().includes(q)) ||
        (s.supplierProduct && s.supplierProduct.supplier.name.toLowerCase().includes(q));

      const matchesPriority = priorityFilter === "all" || s.priority === priorityFilter;
      return matchesSearch && matchesPriority;
    });
  }, [suggestions, searchQuery, priorityFilter]);

  // Group filtered suggestions by supplier
  const supplierGroups = useMemo(() => {
    const groups = new Map<string, { supplier: ReorderSuggestion["supplierProduct"] extends null ? never : any; items: ReorderSuggestion[] }>();
    const unassigned: ReorderSuggestion[] = [];

    filteredSuggestions.forEach((s) => {
      if (!s.supplierProduct) {
        unassigned.push(s);
      } else {
        const supId = s.supplierProduct.supplier.id;
        if (!groups.has(supId)) {
          groups.set(supId, { supplier: s.supplierProduct.supplier, items: [] });
        }
        groups.get(supId)!.items.push(s);
      }
    });

    return {
      assigned: Array.from(groups.values()),
      unassigned,
    };
  }, [filteredSuggestions]);

  // Calculate selected items total value
  const selectedCostTotal = useMemo(() => {
    let sum = 0;
    selectedItems.forEach((findingId) => {
      const s = suggestions.find((x) => x.finding.id === findingId);
      if (s && s.estimatedCost) {
        sum += Number(s.estimatedCost);
      }
    });
    return sum;
  }, [selectedItems, suggestions]);

  return (
    <div className="sp-page-layout">
      {/* Page Header */}
      <div className="sp-page-header">
        <div className="sp-page-title-group">
          <h1 className="sp-page-title">Reorder Planning</h1>
          <p className="sp-page-subtitle">
            AI-driven demand projections, automated stockout prevention, and 1-click supplier purchase order generation.
          </p>
        </div>

        <div className="sp-header-actions">
          <Link to="/app/purchase-orders" className="sp-btn sp-btn-secondary">
            View Existing Purchase Orders →
          </Link>
        </div>
      </div>

      {/* Success Notification after generating POs */}
      {createdOrders && createdOrders.length > 0 && (
        <div className="sp-banner success">
          <div className="sp-banner-icon">✓</div>
          <div className="sp-banner-content">
            <h4 className="sp-banner-title">
              Successfully Created {createdOrders.length} Purchase Order(s)
            </h4>
            <p className="sp-banner-message" style={{ marginBottom: "8px" }}>
              New purchase orders have been drafted and are ready for review:
            </p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {createdOrders.map((co) => (
                <Link
                  key={co.purchaseOrderId}
                  to={`/app/purchase-orders/${co.purchaseOrderId}`}
                  className="sp-badge sp-badge-neutral"
                  style={{ textDecoration: "none", padding: "4px 10px", fontSize: "12px" }}
                >
                  📄 {co.poNumber} ({co.itemsAdded} items) →
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* KPI Overview Cards */}
      <div className="sp-kpi-grid">
        <div className="sp-kpi-card">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Reorder Items</span>
            <span className="sp-badge sp-badge-neutral">Candidates</span>
          </div>
          <div className="sp-kpi-value">{summary.totalSuggestions}</div>
          <div className="sp-kpi-meta">Variants requiring replenishment</div>
        </div>

        <div className="sp-kpi-card critical">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Critical / Stockouts</span>
            <span className="sp-badge sp-badge-critical">
              <span className="sp-badge-dot" /> High Risk
            </span>
          </div>
          <div className="sp-kpi-value">{summary.highPriority}</div>
          <div className="sp-kpi-meta">Immediate replenishment needed</div>
        </div>

        <div className="sp-kpi-card success">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Ready to Order</span>
            <span className="sp-badge sp-badge-success">
              <span className="sp-badge-dot" /> Mapped
            </span>
          </div>
          <div className="sp-kpi-value">{summary.withSupplier}</div>
          <div className="sp-kpi-meta">Suppliers configured & ready</div>
        </div>

        <div className={`sp-kpi-card ${summary.withoutSupplier > 0 ? "warning" : "info"}`}>
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Missing Supplier</span>
            <span className="sp-badge sp-badge-warning">Action Req</span>
          </div>
          <div className="sp-kpi-value">{summary.withoutSupplier}</div>
          <div className="sp-kpi-meta">
            {summary.withoutSupplier > 0 ? (
              <Link to="/app/suppliers" className="sp-btn-plain" style={{ padding: 0 }}>
                Map suppliers now →
              </Link>
            ) : (
              "All items mapped"
            )}
          </div>
        </div>
      </div>

      {/* Sticky / Dedicated Action Bar for PO Creation */}
      {suggestions.length > 0 && (
        <div
          className="sp-card"
          style={{
            borderColor: selectedItems.size > 0 ? "#1a1a1a" : "var(--p-color-border-subdued)",
            background: selectedItems.size > 0 ? "#ffffff" : "var(--p-color-bg-surface-secondary)",
          }}
        >
          <div className="sp-card-body" style={{ padding: "14px 20px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "16px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                <label className="sp-checkbox-row">
                  <input
                    type="checkbox"
                    checked={
                      selectedItems.size > 0 &&
                      selectedItems.size === suggestions.filter((s) => s.supplierProduct).length
                    }
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    disabled={suggestions.filter((s) => s.supplierProduct).length === 0}
                  />
                  <span style={{ fontWeight: 600, fontSize: "13px" }}>
                    Select All Ready ({suggestions.filter((s) => s.supplierProduct).length})
                  </span>
                </label>

                {selectedItems.size > 0 && (
                  <span className="sp-badge sp-badge-neutral" style={{ fontSize: "12px", padding: "4px 10px" }}>
                    ✓ {selectedItems.size} items selected · Est. Total:{" "}
                    <strong>${selectedCostTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  </span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="sp-label" style={{ whiteSpace: "nowrap" }}>
                    Expected Delivery:
                  </span>
                  <input
                    type="date"
                    className="sp-input"
                    style={{ width: "auto" }}
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                  />
                </div>

                <button
                  type="button"
                  className="sp-btn sp-btn-primary"
                  onClick={handleCreatePO}
                  disabled={selectedItems.size === 0 || isLoading}
                >
                  {isLoading ? "Generating Orders..." : `Create ${selectedItems.size} Purchase Order(s)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Reorder Recommendations Container */}
      <div className="sp-card">
        {/* Toolbar with Views and Filters */}
        <div className="sp-toolbar">
          <div className="sp-toolbar-left">
            <div className="sp-search-box">
              <span className="sp-search-icon">🔍</span>
              <input
                type="text"
                className="sp-input"
                placeholder="Search reorder items by product, SKU, or supplier..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              className="sp-select"
              style={{ width: "auto" }}
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as any)}
            >
              <option value="all">All Priorities</option>
              <option value="high">High Priority Only</option>
              <option value="medium">Medium Priority</option>
              <option value="low">Low Priority</option>
            </select>
          </div>

          <div className="sp-toolbar-right">
            <div style={{ display: "inline-flex", background: "var(--p-color-bg-surface-secondary)", padding: "2px", borderRadius: "var(--p-radius-md)" }}>
              <button
                type="button"
                className={`sp-btn sp-btn-slim ${viewMode === "grouped" ? "sp-btn-secondary" : "sp-btn-plain"}`}
                style={{ fontWeight: viewMode === "grouped" ? 600 : 400 }}
                onClick={() => setViewMode("grouped")}
              >
                Grouped by Supplier
              </button>
              <button
                type="button"
                className={`sp-btn sp-btn-slim ${viewMode === "table" ? "sp-btn-secondary" : "sp-btn-plain"}`}
                style={{ fontWeight: viewMode === "table" ? 600 : 400 }}
                onClick={() => setViewMode("table")}
              >
                All Items Table
              </button>
            </div>
          </div>
        </div>

        {/* VIEW 1: GROUPED BY SUPPLIER */}
        {viewMode === "grouped" && (
          <div className="sp-card-body" style={{ padding: "16px 20px" }}>
            {supplierGroups.assigned.length > 0 || supplierGroups.unassigned.length > 0 ? (
              <>
                {/* Supplier Groups */}
                {supplierGroups.assigned.map(({ supplier, items }) => {
                  const allGroupSelected = items.every((i) => selectedItems.has(i.finding.id));
                  const groupTotalEst = items.reduce((sum, i) => sum + (Number(i.estimatedCost) || 0), 0);

                  return (
                    <div
                      key={supplier.id}
                      style={{
                        border: "1px solid var(--p-color-border-subdued)",
                        borderRadius: "var(--p-radius-lg)",
                        marginBottom: "16px",
                        overflow: "hidden",
                      }}
                    >
                      {/* Supplier Group Header */}
                      <div
                        style={{
                          padding: "12px 18px",
                          background: "var(--p-color-bg-surface-secondary)",
                          borderBottom: "1px solid var(--p-color-border-subdued)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: "10px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <input
                            type="checkbox"
                            checked={allGroupSelected}
                            onChange={(e) => handleSelectSupplierGroup(supplier.id, e.target.checked)}
                          />
                          <div>
                            <Link
                              to={`/app/suppliers/${supplier.id}`}
                              style={{ fontWeight: 600, fontSize: "14px", color: "inherit", textDecoration: "none" }}
                            >
                              {supplier.name}
                            </Link>
                            <span className="subdued-text" style={{ marginLeft: "8px" }}>
                              Lead Time: {supplier.defaultLeadTime} days · {items.length} item(s)
                            </span>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span className="sp-badge sp-badge-neutral">
                            Est. PO Value: <strong>${groupTotalEst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                          </span>
                        </div>
                      </div>

                      {/* Items for this supplier */}
                      <div className="sp-table-wrapper">
                        <table className="sp-table">
                          <thead>
                            <tr>
                              <th style={{ width: "36px" }}></th>
                              <th>Product & Variant</th>
                              <th>SKU</th>
                              <th>Priority</th>
                              <th style={{ textAlign: "right" }}>Available</th>
                              <th style={{ textAlign: "right" }}>Suggested Qty</th>
                              <th style={{ textAlign: "right" }}>Est. Unit Cost</th>
                              <th style={{ textAlign: "right" }}>Est. Line Total</th>
                              <th>Reorder Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((s) => (
                              <tr key={s.finding.id}>
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={selectedItems.has(s.finding.id)}
                                    onChange={(e) => handleSelectionChange(s.finding.id, e.target.checked)}
                                  />
                                </td>
                                <td>
                                  <div className="primary-cell">{s.finding.productTitle}</div>
                                  <div className="subdued-text">{s.finding.variantTitle}</div>
                                </td>
                                <td className="mono">{s.finding.sku || "—"}</td>
                                <td>
                                  <span
                                    className={`sp-badge ${
                                      s.priority === "high"
                                        ? "sp-badge-critical"
                                        : s.priority === "medium"
                                        ? "sp-badge-warning"
                                        : "sp-badge-info"
                                    }`}
                                  >
                                    <span className="sp-badge-dot" />
                                    {s.priority}
                                  </span>
                                </td>
                                <td
                                  className="mono"
                                  style={{
                                    textAlign: "right",
                                    color: s.finding.availableQuantity <= 0 ? "var(--p-color-critical-text)" : undefined,
                                    fontWeight: s.finding.availableQuantity <= 0 ? 600 : 400,
                                  }}
                                >
                                  {s.finding.availableQuantity}
                                </td>
                                <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>
                                  {s.suggestedOrderQty}
                                </td>
                                <td className="mono" style={{ textAlign: "right" }}>
                                  {s.supplierProduct?.unitCost !== null
                                    ? `$${Number(s.supplierProduct?.unitCost).toFixed(2)}`
                                    : "—"}
                                </td>
                                <td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>
                                  {s.estimatedCost !== null
                                    ? `$${Number(s.estimatedCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                    : "—"}
                                </td>
                                <td style={{ maxWidth: "240px" }}>
                                  <div className="subdued-text" style={{ whiteSpace: "normal", lineHeight: 1.3 }}>
                                    {s.reason}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}

                {/* Unassigned Items section */}
                {supplierGroups.unassigned.length > 0 && (
                  <div
                    style={{
                      border: "1px dashed var(--p-color-warning-border)",
                      borderRadius: "var(--p-radius-lg)",
                      backgroundColor: "var(--p-color-warning-bg)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        padding: "12px 18px",
                        borderBottom: "1px dashed var(--p-color-warning-border)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "10px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className="sp-badge sp-badge-warning">⚠ Supplier Unassigned</span>
                        <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--p-color-warning-text)" }}>
                          {supplierGroups.unassigned.length} item(s) require supplier mapping
                        </span>
                      </div>
                      <Link to="/app/suppliers" className="sp-btn sp-btn-secondary sp-btn-slim">
                        Map Suppliers →
                      </Link>
                    </div>

                    <div className="sp-table-wrapper">
                      <table className="sp-table">
                        <thead>
                          <tr>
                            <th>Product & Variant</th>
                            <th>SKU</th>
                            <th>Priority</th>
                            <th style={{ textAlign: "right" }}>Available</th>
                            <th style={{ textAlign: "right" }}>Suggested Qty</th>
                            <th>Missing Configuration</th>
                            <th>Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {supplierGroups.unassigned.map((s) => (
                            <tr key={s.finding.id}>
                              <td>
                                <div className="primary-cell">{s.finding.productTitle}</div>
                                <div className="subdued-text">{s.finding.variantTitle}</div>
                              </td>
                              <td className="mono">{s.finding.sku || "—"}</td>
                              <td>
                                <span className={`sp-badge ${s.priority === "high" ? "sp-badge-critical" : "sp-badge-warning"}`}>
                                  {s.priority}
                                </span>
                              </td>
                              <td className="mono" style={{ textAlign: "right" }}>
                                {s.finding.availableQuantity}
                              </td>
                              <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>
                                {s.suggestedOrderQty}
                              </td>
                              <td>
                                <Link to="/app/suppliers" className="sp-btn-plain" style={{ padding: 0 }}>
                                  + Assign Supplier & Cost
                                </Link>
                              </td>
                              <td className="subdued-text">{s.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="sp-empty-state">
                <span className="sp-empty-icon">✓</span>
                <h3 className="sp-empty-title">All Products Adequately Stocked</h3>
                <p className="sp-empty-desc">
                  Based on current inventory levels and velocity, no products require reordering at this time.
                </p>
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: ALL ITEMS TABLE */}
        {viewMode === "table" && (
          <div>
            {filteredSuggestions.length > 0 ? (
              <div className="sp-table-wrapper">
                <table className="sp-table">
                  <thead>
                    <tr>
                      <th style={{ width: "36px" }}></th>
                      <th>Product / Variant</th>
                      <th>SKU</th>
                      <th>Urgency</th>
                      <th style={{ textAlign: "right" }}>Available</th>
                      <th style={{ textAlign: "right" }}>Suggested Qty</th>
                      <th>Assigned Supplier</th>
                      <th style={{ textAlign: "right" }}>Est. Total</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSuggestions.map((s) => (
                      <tr key={s.finding.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedItems.has(s.finding.id)}
                            onChange={(e) => handleSelectionChange(s.finding.id, e.target.checked)}
                            disabled={!s.supplierProduct}
                          />
                        </td>
                        <td>
                          <div className="primary-cell">{s.finding.productTitle}</div>
                          <div className="subdued-text">{s.finding.variantTitle}</div>
                        </td>
                        <td className="mono">{s.finding.sku || "—"}</td>
                        <td>
                          <span
                            className={`sp-badge ${
                              s.priority === "high"
                                ? "sp-badge-critical"
                                : s.priority === "medium"
                                ? "sp-badge-warning"
                                : "sp-badge-info"
                            }`}
                          >
                            <span className="sp-badge-dot" />
                            {s.priority}
                          </span>
                        </td>
                        <td className="mono" style={{ textAlign: "right" }}>
                          {s.finding.availableQuantity}
                        </td>
                        <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>
                          {s.suggestedOrderQty}
                        </td>
                        <td>
                          {s.supplierProduct ? (
                            <div>
                              <Link to={`/app/suppliers/${s.supplierProduct.supplier.id}`} style={{ fontWeight: 500, color: "inherit", textDecoration: "none" }}>
                                {s.supplierProduct.supplier.name}
                              </Link>
                              <div className="subdued-text">
                                Lead: {s.supplierProduct.leadTimeDays ?? s.supplierProduct.supplier.defaultLeadTime}d
                              </div>
                            </div>
                          ) : (
                            <Link to="/app/suppliers" className="sp-btn-plain" style={{ padding: 0 }}>
                              + Map Supplier
                            </Link>
                          )}
                        </td>
                        <td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>
                          {s.estimatedCost !== null
                            ? `$${Number(s.estimatedCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : "—"}
                        </td>
                        <td style={{ maxWidth: "240px" }}>
                          <div className="subdued-text" style={{ whiteSpace: "normal", lineHeight: 1.3 }}>
                            {s.reason}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="sp-empty-state">
                <span className="sp-empty-icon">✓</span>
                <h3 className="sp-empty-title">No Reorder Suggestions Found</h3>
                <p className="sp-empty-desc">
                  Inventory levels are optimal or no items match your selected filter criteria.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Priority Legend */}
      <div style={{ display: "flex", gap: "20px", marginTop: "16px", padding: "12px 16px", background: "var(--p-color-bg-surface)", borderRadius: "var(--p-radius-lg)", border: "1px solid var(--p-color-border-subdued)", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--p-color-text-secondary)" }}>Priority Legend:</span>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span className="sp-badge sp-badge-critical"><span className="sp-badge-dot" /> High</span>
          <span className="subdued-text">Out of stock or imminent stockout risk</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span className="sp-badge sp-badge-warning"><span className="sp-badge-dot" /> Medium</span>
          <span className="subdued-text">Low stock or optimal reorder point reached</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span className="sp-badge sp-badge-info"><span className="sp-badge-dot" /> Low</span>
          <span className="subdued-text">Stock below ideal cover but not immediate</span>
        </div>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
