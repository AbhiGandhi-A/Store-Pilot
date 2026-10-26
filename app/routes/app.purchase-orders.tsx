/* eslint-disable @typescript-eslint/no-explicit-any, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions */
import React, { useEffect, useState, useMemo } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useFetcher, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  listPurchaseOrders,
  createPurchaseOrder,
  submitPurchaseOrder,
  cancelPurchaseOrder,
  type PurchaseOrderInput,
} from "~/services/supplier.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const shopRecord = await prisma.shop.findUnique({ where: { domain: shop }, select: { id: true } });
    if (!shopRecord) return { orders: [], suppliers: [], shopId: null };

    const orders = await listPurchaseOrders(shopRecord.id);
    const suppliers = await prisma.supplier.findMany({
      where: { shopId: shopRecord.id, isActive: true },
      orderBy: { name: "asc" },
    });

    return { orders, suppliers, shopId: shopRecord.id };
  } finally {
    await prisma.$disconnect();
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const shopRecord = await prisma.shop.findUnique({ where: { domain: shop }, select: { id: true } });
    if (!shopRecord) return { success: false, error: "Shop not found" };

    const formData = await request.formData();
    const actionType = formData.get("actionType") as string;

    if (actionType === "create") {
      const input: PurchaseOrderInput = {
        supplierId: formData.get("supplierId") as string,
        expectedDate: formData.get("expectedDate") ? new Date(formData.get("expectedDate") as string) : undefined,
        currency: (formData.get("currency") as string) || "USD",
        notes: (formData.get("notes") as string) || undefined,
      };

      const po = await createPurchaseOrder(shopRecord.id, input);
      return { success: true, purchaseOrder: po };
    }

    if (actionType === "submit") {
      const poId = formData.get("poId") as string;
      await submitPurchaseOrder(shopRecord.id, poId);
      return { success: true };
    }

    if (actionType === "cancel") {
      const poId = formData.get("poId") as string;
      await cancelPurchaseOrder(shopRecord.id, poId);
      return { success: true };
    }

    return { success: false, error: "Invalid action" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  } finally {
    await prisma.$disconnect();
  }
};

export default function PurchaseOrdersPage() {
  const { orders, suppliers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const isLoading = fetcher.state === "submitting";

  useEffect(() => {
    if (fetcher.data?.success) {
      setShowCreateModal(false);
      setSelectedSupplierId("");
      setExpectedDate("");
      shopify.toast.show("Purchase order updated successfully");
    }
    if (fetcher.data?.error) {
      shopify.toast.show(`Error: ${fetcher.data.error}`);
    }
  }, [fetcher.data, shopify]);

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("actionType", "create");
    fetcher.submit(formData, { method: "POST" });
  };

  const handleSubmit = (po: any) => {
    if (!confirm(`Submit purchase order "${po.poNumber}"? Once submitted, the order is locked and awaiting receipt.`)) {
      return;
    }
    const formData = new FormData();
    formData.set("actionType", "submit");
    formData.set("poId", po.id);
    fetcher.submit(formData, { method: "POST" });
  };

  const handleCancel = (po: any) => {
    if (!confirm(`Cancel purchase order "${po.poNumber}"? This cannot be undone.`)) {
      return;
    }
    const formData = new FormData();
    formData.set("actionType", "cancel");
    formData.set("poId", po.id);
    fetcher.submit(formData, { method: "POST" });
  };

  // When supplier selection changes in modal, auto-populate expected date based on lead time
  const handleSupplierChange = (supId: string) => {
    setSelectedSupplierId(supId);
    const sup = suppliers.find((s) => s.id === supId);
    if (sup && sup.defaultLeadTime) {
      const target = new Date();
      target.setDate(target.getDate() + sup.defaultLeadTime);
      setExpectedDate(target.toISOString().split("T")[0]);
    }
  };

  // Filtered orders
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        o.poNumber.toLowerCase().includes(q) ||
        (o.supplier?.name && o.supplier.name.toLowerCase().includes(q));

      const matchesStatus = statusFilter === "all" || o.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [orders, searchQuery, statusFilter]);

  const draftCount = orders.filter((o) => o.status === "draft").length;
  const inTransitCount = orders.filter((o) => ["submitted", "partially_received"].includes(o.status)).length;
  const receivedCount = orders.filter((o) => o.status === "received").length;
  const totalSpend = orders
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + Number(o.total), 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return <span className="sp-badge sp-badge-info"><span className="sp-badge-dot" /> Draft</span>;
      case "submitted":
        return <span className="sp-badge sp-badge-warning"><span className="sp-badge-dot" /> In Transit</span>;
      case "partially_received":
        return <span className="sp-badge sp-badge-warning"><span className="sp-badge-dot" /> Partial Receipt</span>;
      case "received":
        return <span className="sp-badge sp-badge-success"><span className="sp-badge-dot" /> Received</span>;
      case "cancelled":
        return <span className="sp-badge sp-badge-neutral">Cancelled</span>;
      default:
        return <span className="sp-badge sp-badge-neutral">{status}</span>;
    }
  };

  const formatDate = (dateStr: Date | string | null | undefined) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="sp-page-layout">
      {/* Page Header */}
      <div className="sp-page-header">
        <div className="sp-page-title-group">
          <h1 className="sp-page-title">Purchase Orders</h1>
          <p className="sp-page-subtitle">
            Manage replenishment orders, track delivery milestones, and record partial or full shipments.
          </p>
        </div>

        <div className="sp-header-actions">
          <Link to="/app/reorder" className="sp-btn sp-btn-secondary">
            ⚡ Reorder Planning
          </Link>
          <button
            type="button"
            className="sp-btn sp-btn-primary"
            onClick={() => setShowCreateModal(true)}
            disabled={isLoading}
          >
            + Create Purchase Order
          </button>
        </div>
      </div>

      {actionData?.error && (
        <div className="sp-banner critical">
          <div className="sp-banner-icon">⚠</div>
          <div className="sp-banner-content">
            <h4 className="sp-banner-title">Error</h4>
            <p className="sp-banner-message">{actionData.error}</p>
          </div>
        </div>
      )}

      {/* KPI Overview Grid */}
      <div className="sp-kpi-grid">
        <div className="sp-kpi-card info">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Draft Orders</span>
            <span className="sp-badge sp-badge-info">Building</span>
          </div>
          <div className="sp-kpi-value">{draftCount}</div>
          <div className="sp-kpi-meta">Awaiting submission to vendor</div>
        </div>

        <div className="sp-kpi-card warning">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">In Transit / Pending</span>
            <span className="sp-badge sp-badge-warning">
              <span className="sp-badge-dot" /> Awaiting Delivery
            </span>
          </div>
          <div className="sp-kpi-value">{inTransitCount}</div>
          <div className="sp-kpi-meta">Ready to receive inventory</div>
        </div>

        <div className="sp-kpi-card success">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Received & Stocked</span>
            <span className="sp-badge sp-badge-success">Completed</span>
          </div>
          <div className="sp-kpi-value">{receivedCount}</div>
          <div className="sp-kpi-meta">Fulfilled orders</div>
        </div>

        <div className="sp-kpi-card">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Committed Spend</span>
            <span className="sp-badge sp-badge-neutral">Pipeline</span>
          </div>
          <div className="sp-kpi-value">
            ${totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="sp-kpi-meta">Across {orders.length} total orders</div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="sp-card">
        {/* Toolbar */}
        <div className="sp-toolbar">
          <div className="sp-toolbar-left">
            <div className="sp-search-box">
              <span className="sp-search-icon">🔍</span>
              <input
                type="text"
                className="sp-input"
                placeholder="Search by PO number or supplier name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              className="sp-select"
              style={{ width: "auto" }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses ({orders.length})</option>
              <option value="draft">Drafts ({draftCount})</option>
              <option value="submitted">Submitted / In Transit ({orders.filter(o => o.status === "submitted").length})</option>
              <option value="partially_received">Partially Received ({orders.filter(o => o.status === "partially_received").length})</option>
              <option value="received">Received ({receivedCount})</option>
              <option value="cancelled">Cancelled ({orders.filter(o => o.status === "cancelled").length})</option>
            </select>
          </div>

          <div className="sp-toolbar-right">
            <span className="subdued-text">
              Showing {filteredOrders.length} of {orders.length} orders
            </span>
          </div>
        </div>

        {/* Orders Table */}
        {filteredOrders.length > 0 ? (
          <div className="sp-table-wrapper">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Created Date</th>
                  <th>Expected Delivery</th>
                  <th style={{ textAlign: "center" }}>Items</th>
                  <th style={{ textAlign: "right" }}>Total Amount</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const isOverdue =
                    order.expectedDate &&
                    new Date(order.expectedDate) < new Date() &&
                    ["draft", "submitted", "partially_received"].includes(order.status);

                  return (
                    <tr key={order.id}>
                      <td>
                        <Link
                          to={`/app/purchase-orders/${order.id}`}
                          className="mono"
                          style={{ fontWeight: 700, color: "#2563eb", textDecoration: "none" }}
                        >
                          {order.poNumber}
                        </Link>
                      </td>
                      <td>
                        {order.supplier ? (
                          <Link
                            to={`/app/suppliers/${order.supplier.id}`}
                            style={{ fontWeight: 500, color: "inherit", textDecoration: "none" }}
                          >
                            {order.supplier.name}
                          </Link>
                        ) : (
                          <span className="subdued-text">—</span>
                        )}
                      </td>
                      <td>{getStatusBadge(order.status)}</td>
                      <td className="subdued-text">{formatDate(order.createdAt)}</td>
                      <td>
                        <span
                          style={{
                            fontWeight: isOverdue ? 600 : 400,
                            color: isOverdue ? "var(--p-color-critical-text)" : undefined,
                          }}
                        >
                          {formatDate(order.expectedDate)}
                          {isOverdue && <span className="sp-badge sp-badge-critical" style={{ marginLeft: "6px", fontSize: "10px" }}>Overdue</span>}
                        </span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span className="sp-badge sp-badge-neutral">{order._count?.items || 0} line(s)</span>
                      </td>
                      <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>
                        ${Number(order.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {order.currency}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                          <Link
                            to={`/app/purchase-orders/${order.id}`}
                            className="sp-btn sp-btn-secondary sp-btn-slim"
                          >
                            {["submitted", "partially_received"].includes(order.status) ? "Receive" : "View"}
                          </Link>

                          {order.status === "draft" && (
                            <>
                              <button
                                type="button"
                                className="sp-btn sp-btn-primary sp-btn-slim"
                                onClick={() => handleSubmit(order)}
                              >
                                Submit
                              </button>
                              <button
                                type="button"
                                className="sp-btn sp-btn-destructive sp-btn-slim"
                                onClick={() => handleCancel(order)}
                              >
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sp-empty-state">
            <span className="sp-empty-icon">📄</span>
            <h3 className="sp-empty-title">
              {orders.length === 0 ? "No purchase orders created yet" : "No purchase orders match this filter"}
            </h3>
            <p className="sp-empty-desc">
              {orders.length === 0
                ? "Generate purchase orders directly from Reorder Planning or create a manual replenishment order."
                : "Try selecting a different status filter or clearing your search term."}
            </p>
            {orders.length === 0 ? (
              <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
                <Link to="/app/reorder" className="sp-btn sp-btn-secondary">
                  ⚡ View Reorder Planning
                </Link>
                <button
                  type="button"
                  className="sp-btn sp-btn-primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  + Create Manual Order
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="sp-btn sp-btn-plain"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                }}
              >
                Clear filter
              </button>
            )}
          </div>
        )}
      </div>

      {/* CREATE PURCHASE ORDER MODAL */}
      {showCreateModal && (
        <div
          className="sp-modal-backdrop"
          style={{ alignItems: "flex-start", paddingTop: "32px", paddingBottom: "96px", overflowY: "auto" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-create-po-title"
          onClick={() => setShowCreateModal(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowCreateModal(false);
          }}
        >
          <div
            className="sp-modal-content"
            style={{ maxHeight: "calc(100vh - 140px)", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="sp-modal-header" style={{ flexShrink: 0 }}>
              <h3 id="modal-create-po-title">Create Purchase Order</h3>
              <button type="button" className="sp-modal-close-btn" onClick={() => setShowCreateModal(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <div className="sp-modal-body" style={{ overflowY: "auto", flex: "1 1 auto", minHeight: 0, maxHeight: "calc(100vh - 270px)" }}>
                <div className="sp-form-grid">
                  <div className="sp-form-group full-width">
                    <label htmlFor="create-po-supplier" className="sp-label">Supplier Partner *</label>
                    <select
                      id="create-po-supplier"
                      name="supplierId"
                      className="sp-select"
                      required
                      value={selectedSupplierId}
                      onChange={(e) => handleSupplierChange(e.target.value)}
                    >
                      <option value="" disabled>
                        Choose a supplier...
                      </option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} (Lead Time: {s.defaultLeadTime}d)
                        </option>
                      ))}
                    </select>
                    {suppliers.length === 0 && (
                      <span className="sp-form-hint" style={{ color: "var(--p-color-critical-text)" }}>
                        No suppliers found. Please add a supplier first.
                      </span>
                    )}
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="create-po-date" className="sp-label">Expected Delivery Date</label>
                    <input
                      id="create-po-date"
                      type="date"
                      name="expectedDate"
                      className="sp-input"
                      value={expectedDate}
                      onChange={(e) => setExpectedDate(e.target.value)}
                    />
                    <span className="sp-form-hint">Automatically calculated from supplier lead time.</span>
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="create-po-currency" className="sp-label">Currency</label>
                    <select id="create-po-currency" name="currency" className="sp-select" defaultValue="USD">
                      <option value="USD">USD ($)</option>
                      <option value="CAD">CAD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                    </select>
                  </div>

                  <div className="sp-form-group full-width">
                    <label htmlFor="create-po-notes" className="sp-label">Order Notes & Procurement Instructions</label>
                    <textarea
                      id="create-po-notes"
                      name="notes"
                      className="sp-input"
                      rows={3}
                      placeholder="Add shipping terms, warehouse bay delivery instructions, or reference codes..."
                    />
                  </div>
                </div>
              </div>

              <div className="sp-modal-footer" style={{ flexShrink: 0, position: "sticky", bottom: 0, zIndex: 10 }}>
                <button type="button" className="sp-btn sp-btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="sp-btn sp-btn-primary"
                  disabled={isLoading || !selectedSupplierId}
                >
                  {isLoading ? "Creating..." : "Create Draft Order"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
