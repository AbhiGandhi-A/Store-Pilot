/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions */
import React, { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useFetcher, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getPurchaseOrder,
  updatePurchaseOrder,
  addPurchaseOrderItem,
  updatePurchaseOrderItem,
  removePurchaseOrderItem,
  submitPurchaseOrder,
  cancelPurchaseOrder,
  receivePurchaseOrderItems,
  type PurchaseOrderItemInput,
  type PurchaseOrderItem,
} from "~/services/supplier.server";
import { Decimal } from "@prisma/client/runtime/library";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = session;
  const poId = params.poId;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const shopRecord = await prisma.shop.findUnique({ where: { domain: shop }, select: { id: true } });
    if (!shopRecord || !poId) return { order: null, supplierProducts: [], storeVariants: [] };

    const order = await getPurchaseOrder(shopRecord.id, poId);
    if (!order) return { order: null, supplierProducts: [], storeVariants: [] };

    const supplierProducts = await prisma.supplierProduct.findMany({
      where: { shopId: shopRecord.id, supplierId: order.supplierId },
      include: { productVariant: { include: { product: true } } },
    });

    const storeVariants = await prisma.productVariant.findMany({
      where: { shopId: shopRecord.id },
      include: { product: true },
      take: 150,
      orderBy: { product: { title: "asc" } },
    });

    return { order, supplierProducts, storeVariants };
  } finally {
    await prisma.$disconnect();
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = session;
  const poId = params.poId;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const shopRecord = await prisma.shop.findUnique({ where: { domain: shop }, select: { id: true } });
    if (!shopRecord) return { success: false, error: "Shop not found" };

    if (!poId) return { success: false, error: "Purchase order ID required" };

    const formData = await request.formData();
    const actionType = formData.get("actionType") as string;

    if (actionType === "updateOrder") {
      const input = {
        expectedDate: formData.get("expectedDate") ? new Date(formData.get("expectedDate") as string) : null,
        notes: (formData.get("notes") as string) || null,
        currency: (formData.get("currency") as string) || undefined,
      };
      await updatePurchaseOrder(shopRecord.id, poId, input);
      return { success: true };
    }

    if (actionType === "addItem") {
      const input: PurchaseOrderItemInput = {
        productVariantId: formData.get("productVariantId") as string,
        supplierProductId: (formData.get("supplierProductId") as string) || undefined,
        orderedQty: parseInt(formData.get("orderedQty") as string, 10),
        unitCost: parseFloat(formData.get("unitCost") as string),
        supplierSkuSnapshot: (formData.get("supplierSkuSnapshot") as string) || undefined,
        productTitleSnapshot: formData.get("productTitleSnapshot") as string,
        variantTitleSnapshot: formData.get("variantTitleSnapshot") as string,
        skuSnapshot: (formData.get("skuSnapshot") as string) || undefined,
      };
      await addPurchaseOrderItem(shopRecord.id, poId, input);
      return { success: true };
    }

    if (actionType === "updateItem") {
      const itemId = formData.get("itemId") as string;
      const input = {
        orderedQty: formData.get("orderedQty") ? parseInt(formData.get("orderedQty") as string, 10) : undefined,
        unitCost: formData.get("unitCost") ? parseFloat(formData.get("unitCost") as string) : undefined,
      };
      await updatePurchaseOrderItem(shopRecord.id, itemId, input);
      return { success: true };
    }

    if (actionType === "removeItem") {
      const itemId = formData.get("itemId") as string;
      await removePurchaseOrderItem(shopRecord.id, itemId);
      return { success: true };
    }

    if (actionType === "submit") {
      await submitPurchaseOrder(shopRecord.id, poId);
      return { success: true };
    }

    if (actionType === "cancel") {
      await cancelPurchaseOrder(shopRecord.id, poId);
      return { success: true };
    }

    if (actionType === "receive") {
      const itemsJson = formData.get("items") as string;
      const items = JSON.parse(itemsJson);
      await receivePurchaseOrderItems(shopRecord.id, poId, items);
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

export default function PurchaseOrderDetailsPage() {
  const { order, supplierProducts, storeVariants } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<PurchaseOrderItem | null>(null);
  const [receivingItems, setReceivingItems] = useState<Record<string, number>>({});
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);

  const isLoading = fetcher.state === "submitting";

  useEffect(() => {
    if (fetcher.data?.success) {
      setShowAddItemModal(false);
      setEditingItem(null);
      setIsEditingMetadata(false);
      shopify.toast.show("Order updated successfully");
    }
    if (fetcher.data?.error) {
      shopify.toast.show(`Error: ${fetcher.data.error}`);
    }
  }, [fetcher.data, shopify]);

  if (!order) {
    return (
      <div className="sp-page-layout">
        <div className="sp-banner critical">
          <div className="sp-banner-icon">⚠</div>
          <div className="sp-banner-content">
            <h4 className="sp-banner-title">Purchase Order Not Found</h4>
            <p className="sp-banner-message">The requested purchase order could not be located.</p>
          </div>
        </div>
        <Link to="/app/purchase-orders" className="sp-btn sp-btn-secondary">
          ← Back to Purchase Orders
        </Link>
      </div>
    );
  }

  const isDraft = order.status === "draft";
  const isSubmitted = order.status === "submitted";
  const isPartiallyReceived = order.status === "partially_received";
  const isReceived = order.status === "received";
  const isCancelled = order.status === "cancelled";
  const canReceive = isSubmitted || isPartiallyReceived;

  const formatDate = (date: Date | string | null | undefined) => {
    if (!date) return "—";
    const d = new Date(date);
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const formatCurrency = (val: Decimal | number | string | null | undefined) => {
    if (val === null || val === undefined) return "$0.00";
    return `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Receiving calculations
  const totalItemsOrdered = order.items.reduce((sum, item) => sum + item.orderedQty, 0);
  const totalItemsReceived = order.items.reduce((sum, item) => sum + item.receivedQty, 0);
  const totalItemsRemaining = totalItemsOrdered - totalItemsReceived;
  const fulfillmentPercentage = totalItemsOrdered > 0 ? Math.round((totalItemsReceived / totalItemsOrdered) * 100) : 0;

  const handleReceiveAll = () => {
    const allRemaining: Record<string, number> = {};
    order.items.forEach((item) => {
      const rem = item.orderedQty - item.receivedQty;
      if (rem > 0) allRemaining[item.id] = rem;
    });
    setReceivingItems(allRemaining);
  };

  const handleConfirmReceive = () => {
    const payload = Object.entries(receivingItems)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, qty]) => ({ itemId, receivedQty: qty }));

    if (payload.length === 0) {
      shopify.toast.show("Please enter received quantities for at least one item");
      return;
    }

    const formData = new FormData();
    formData.set("actionType", "receive");
    formData.set("items", JSON.stringify(payload));
    fetcher.submit(formData, { method: "POST" });
    setReceivingItems({});
  };

  const handleSubmitOrder = () => {
    if (order.items.length === 0) {
      shopify.toast.show("Add at least one product before submitting this order");
      return;
    }
    if (!confirm(`Submit "${order.poNumber}"? Once submitted, the order is locked and ready for receiving.`)) {
      return;
    }
    const formData = new FormData();
    formData.set("actionType", "submit");
    fetcher.submit(formData, { method: "POST" });
  };

  const handleCancelOrder = () => {
    if (!confirm(`Cancel purchase order "${order.poNumber}"? This cannot be undone.`)) {
      return;
    }
    const formData = new FormData();
    formData.set("actionType", "cancel");
    fetcher.submit(formData, { method: "POST" });
  };

  const handleUpdateOrder = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("actionType", "updateOrder");
    fetcher.submit(formData, { method: "POST" });
  };

  const handleAddItem = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("actionType", "addItem");
    fetcher.submit(formData, { method: "POST" });
  };

  const handleSaveItem = (e: React.FormEvent<HTMLFormElement>, itemId: string) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("actionType", "updateItem");
    formData.set("itemId", itemId);
    fetcher.submit(formData, { method: "POST" });
  };

  const handleRemoveItem = (item: PurchaseOrderItem) => {
    if (!confirm(`Remove "${item.productTitleSnapshot}" from this purchase order?`)) {
      return;
    }
    const formData = new FormData();
    formData.set("actionType", "removeItem");
    formData.set("itemId", item.id);
    fetcher.submit(formData, { method: "POST" });
  };

  return (
    <div className="sp-page-layout">
      {/* Breadcrumb Navigation */}
      <div style={{ marginBottom: "12px" }}>
        <Link to="/app/purchase-orders" className="sp-btn-plain" style={{ padding: 0, fontSize: "13px" }}>
          ← Back to Purchase Orders
        </Link>
      </div>

      {/* Page Header */}
      <div className="sp-page-header">
        <div className="sp-page-title-group">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h1 className="sp-page-title mono">{order.poNumber}</h1>
            <span
              className={`sp-badge ${
                isReceived
                  ? "sp-badge-success"
                  : isCancelled
                  ? "sp-badge-neutral"
                  : canReceive
                  ? "sp-badge-warning"
                  : "sp-badge-info"
              }`}
            >
              <span className="sp-badge-dot" />
              {order.status.replace(/_/g, " ")}
            </span>
          </div>
          <p className="sp-page-subtitle">
            Vendor:{" "}
            {order.supplier ? (
              <Link to={`/app/suppliers/${order.supplier.id}`} style={{ color: "inherit", fontWeight: 600 }}>
                {order.supplier.name}
              </Link>
            ) : (
              "Unassigned"
            )}
            {order.expectedDate && ` · Expected by ${formatDate(order.expectedDate)}`}
          </p>
        </div>

        <div className="sp-header-actions">
          {isDraft && (
            <>
              <button
                type="button"
                className="sp-btn sp-btn-secondary"
                onClick={() => setShowAddItemModal(true)}
              >
                + Add Item
              </button>
              <button
                type="button"
                className="sp-btn sp-btn-primary"
                onClick={handleSubmitOrder}
                disabled={isLoading || order.items.length === 0}
              >
                Submit Order to Vendor
              </button>
              <button
                type="button"
                className="sp-btn sp-btn-destructive"
                onClick={handleCancelOrder}
                disabled={isLoading}
              >
                Cancel Order
              </button>
            </>
          )}

          {canReceive && (
            <>
              <button
                type="button"
                className="sp-btn sp-btn-secondary"
                onClick={handleReceiveAll}
                disabled={isLoading || totalItemsRemaining === 0}
              >
                Fill All Remaining ({totalItemsRemaining})
              </button>
              <button
                type="button"
                className="sp-btn sp-btn-primary"
                onClick={handleConfirmReceive}
                disabled={isLoading || Object.values(receivingItems).every((v) => v === 0)}
              >
                Confirm Receipt ({Object.values(receivingItems).reduce((a, b) => a + b, 0)} items)
              </button>
              <button
                type="button"
                className="sp-btn sp-btn-destructive sp-btn-slim"
                onClick={handleCancelOrder}
                disabled={isLoading}
              >
                Cancel Order
              </button>
            </>
          )}
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

      {/* Lifecycle Progress Stepper */}
      <div className="sp-card" style={{ marginBottom: "20px" }}>
        <div className="sp-stepper">
          <div className={`sp-step ${!isDraft ? "completed" : "active"}`}>
            <div className="sp-step-icon">{!isDraft ? "✓" : "1"}</div>
            <span>1. Draft Order</span>
          </div>

          <div className={`sp-step ${isReceived ? "completed" : canReceive ? "active" : ""}`}>
            <div className="sp-step-icon">{isReceived ? "✓" : "2"}</div>
            <span>2. Submitted / In Transit</span>
          </div>

          <div className={`sp-step ${isReceived ? "completed" : isPartiallyReceived ? "active" : ""}`}>
            <div className="sp-step-icon">{isReceived ? "✓" : "3"}</div>
            <span>3. Receiving Items ({fulfillmentPercentage}%)</span>
          </div>

          <div className={`sp-step ${isReceived ? "completed active" : ""}`}>
            <div className="sp-step-icon">{isReceived ? "✓" : "4"}</div>
            <span>4. Fully Stocked</span>
          </div>
        </div>
      </div>

      {/* Main Content & Sidebar Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "20px", alignItems: "start" }}>
        {/* Left Column: Items Table */}
        <div>
          <div className="sp-card">
            <div className="sp-card-header">
              <h3 className="sp-card-title">Order Line Items ({order.items.length})</h3>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className="sp-badge sp-badge-neutral">
                  {totalItemsReceived} of {totalItemsOrdered} units received ({fulfillmentPercentage}%)
                </span>
                {isDraft && (
                  <button
                    type="button"
                    className="sp-btn sp-btn-primary sp-btn-slim"
                    onClick={() => setShowAddItemModal(true)}
                  >
                    + Add Item
                  </button>
                )}
              </div>
            </div>

            {/* Items Table */}
            {order.items.length > 0 ? (
              <div className="sp-table-wrapper">
                <table className="sp-table">
                  <thead>
                    <tr>
                      <th>Product & Variant</th>
                      <th>SKU</th>
                      <th style={{ textAlign: "right" }}>Unit Cost</th>
                      <th style={{ textAlign: "right" }}>Ordered</th>
                      <th style={{ textAlign: "right" }}>Received</th>
                      <th style={{ textAlign: "right" }}>Remaining</th>
                      <th style={{ textAlign: "right" }}>Line Total</th>
                      {canReceive && <th style={{ textAlign: "center", width: "110px" }}>Receive Now</th>}
                      {isDraft && <th style={{ textAlign: "right" }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => {
                      const remaining = item.orderedQty - item.receivedQty;
                      const linePercent = Math.round((item.receivedQty / item.orderedQty) * 100);

                      return (
                        <tr key={item.id}>
                          <td>
                            <div className="primary-cell">{item.productTitleSnapshot}</div>
                            <div className="subdued-text">
                              {item.variantTitleSnapshot}
                              {item.supplierSkuSnapshot ? ` · Vendor SKU: ${item.supplierSkuSnapshot}` : ""}
                            </div>
                          </td>
                          <td className="mono">{item.skuSnapshot || "—"}</td>
                          <td className="mono" style={{ textAlign: "right" }}>
                            {formatCurrency(item.unitCost)}
                          </td>
                          <td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>
                            {item.orderedQty}
                          </td>
                          <td className="mono" style={{ textAlign: "right" }}>
                            <span style={{ color: item.receivedQty > 0 ? "var(--p-color-success-text)" : undefined }}>
                              {item.receivedQty}
                            </span>
                            <div className="sp-progress-container">
                              <div className="sp-progress-fill" style={{ width: `${linePercent}%` }} />
                            </div>
                          </td>
                          <td className="mono" style={{ textAlign: "right", fontWeight: remaining > 0 ? 600 : 400 }}>
                            {remaining === 0 ? (
                              <span className="sp-badge sp-badge-success" style={{ fontSize: "10px" }}>Done</span>
                            ) : (
                              remaining
                            )}
                          </td>
                          <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>
                            {formatCurrency(item.lineTotal)}
                          </td>

                          {/* Receiving Mode Input */}
                          {canReceive && (
                            <td style={{ textAlign: "center" }}>
                              {remaining > 0 ? (
                                <input
                                  type="number"
                                  min="0"
                                  max={remaining}
                                  className="sp-input mono"
                                  style={{ width: "70px", textAlign: "center", padding: "4px" }}
                                  value={receivingItems[item.id] ?? ""}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const val = Math.max(0, Math.min(remaining, parseInt(e.target.value, 10) || 0));
                                    setReceivingItems({ ...receivingItems, [item.id]: val });
                                  }}
                                />
                              ) : (
                                <span className="subdued-text">Fully received</span>
                              )}
                            </td>
                          )}

                          {/* Draft Mode Actions */}
                          {isDraft && (
                            <td style={{ textAlign: "right" }}>
                              <div style={{ display: "inline-flex", gap: "6px" }}>
                                <button
                                  type="button"
                                  className="sp-btn sp-btn-secondary sp-btn-slim"
                                  onClick={() => setEditingItem(item)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="sp-btn sp-btn-destructive sp-btn-slim"
                                  onClick={() => handleRemoveItem(item)}
                                >
                                  Remove
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="sp-empty-state">
                <span className="sp-empty-icon">📦</span>
                <h3 className="sp-empty-title">No items in this purchase order</h3>
                <p className="sp-empty-desc">
                  Add product variants from your supplier catalog to build this purchase order.
                </p>
                {isDraft && (
                  <button
                    type="button"
                    className="sp-btn sp-btn-primary"
                    onClick={() => setShowAddItemModal(true)}
                  >
                    + Add Product Variant
                  </button>
                )}
              </div>
            )}

            {/* Quick Receive Summary Bar */}
            {canReceive && order.items.length > 0 && (
              <div className="sp-card-footer" style={{ justifyContent: "space-between" }}>
                <span className="subdued-text">
                  Enter quantities to receive in the column above or click Fill All Remaining.
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    className="sp-btn sp-btn-secondary"
                    onClick={handleReceiveAll}
                    disabled={isLoading || totalItemsRemaining === 0}
                  >
                    Receive All ({totalItemsRemaining} units)
                  </button>
                  <button
                    type="button"
                    className="sp-btn sp-btn-primary"
                    onClick={handleConfirmReceive}
                    disabled={isLoading || Object.values(receivingItems).every((v) => v === 0)}
                  >
                    Record Received Inventory
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Order Details & Financials */}
        <div>
          {/* Financial Summary Card */}
          <div className="sp-card">
            <div className="sp-card-header">
              <h3 className="sp-card-title">Order Financials</h3>
              <span className="sp-badge sp-badge-neutral">{order.currency}</span>
            </div>
            <div className="sp-card-body">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span className="subdued-text">Total Line Items:</span>
                <span style={{ fontWeight: 600 }}>{order.items.length}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span className="subdued-text">Total Quantity:</span>
                <span style={{ fontWeight: 600 }}>{totalItemsOrdered} units</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span className="subdued-text">Units Received:</span>
                <span style={{ fontWeight: 600, color: "var(--p-color-success-text)" }}>
                  {totalItemsReceived} ({fulfillmentPercentage}%)
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingTop: "12px",
                  marginTop: "8px",
                  borderTop: "1px solid var(--p-color-border-subdued)",
                }}
              >
                <span style={{ fontWeight: 700, fontSize: "15px" }}>Total Amount:</span>
                <span className="mono" style={{ fontWeight: 700, fontSize: "18px", color: "var(--p-color-text-primary)" }}>
                  {formatCurrency(order.total)}
                </span>
              </div>
            </div>
          </div>

          {/* Supplier Info Card */}
          {order.supplier && (
            <div className="sp-card">
              <div className="sp-card-header">
                <h3 className="sp-card-title">Vendor Details</h3>
                <Link to={`/app/suppliers/${order.supplier.id}`} className="sp-btn-plain" style={{ padding: 0, fontSize: "12px" }}>
                  View Profile →
                </Link>
              </div>
              <div className="sp-card-body">
                <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>
                  {order.supplier.name}
                </div>
                {order.supplier.contactName && (
                  <div className="subdued-text" style={{ marginBottom: "2px" }}>
                    Contact: {order.supplier.contactName}
                  </div>
                )}
                {order.supplier.email && (
                  <div className="subdued-text" style={{ marginBottom: "2px" }}>
                    <a href={`mailto:${order.supplier.email}`} style={{ color: "inherit" }}>
                      {order.supplier.email}
                    </a>
                  </div>
                )}
                {order.supplier.phone && (
                  <div className="subdued-text" style={{ marginBottom: "2px" }}>
                    {order.supplier.phone}
                  </div>
                )}
                <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px solid var(--p-color-border-subdued)" }}>
                  <span className="subdued-text">Default Lead Time: </span>
                  <span style={{ fontWeight: 600 }}>{order.supplier.defaultLeadTime} days</span>
                </div>
              </div>
            </div>
          )}

          {/* Metadata & Timeline Card */}
          <div className="sp-card">
            <div className="sp-card-header">
              <h3 className="sp-card-title">Delivery & Timeline</h3>
              {isDraft && (
                <button
                  type="button"
                  className="sp-btn sp-btn-plain sp-btn-slim"
                  onClick={() => setIsEditingMetadata(!isEditingMetadata)}
                >
                  {isEditingMetadata ? "Cancel" : "Edit"}
                </button>
              )}
            </div>
            <div className="sp-card-body">
              {isEditingMetadata ? (
                <form onSubmit={handleUpdateOrder}>
                  <div className="sp-form-group">
                    <label htmlFor="po-edit-expected-date" className="sp-label">Expected Delivery Date</label>
                    <input
                      id="po-edit-expected-date"
                      type="date"
                      name="expectedDate"
                      className="sp-input"
                      defaultValue={order.expectedDate ? new Date(order.expectedDate).toISOString().split("T")[0] : ""}
                    />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="po-edit-currency" className="sp-label">Currency</label>
                    <select id="po-edit-currency" name="currency" className="sp-select" defaultValue={order.currency}>
                      <option value="USD">USD ($)</option>
                      <option value="CAD">CAD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                    </select>
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="po-edit-notes" className="sp-label">Order Notes</label>
                    <textarea id="po-edit-notes" name="notes" className="sp-input" rows={3} defaultValue={order.notes || ""} />
                  </div>

                  <button type="submit" className="sp-btn sp-btn-primary sp-btn-slim" style={{ width: "100%" }} disabled={isLoading}>
                    Save Order Details
                  </button>
                </form>
              ) : (
                <>
                  <div style={{ marginBottom: "10px" }}>
                    <div className="sp-kpi-label">Expected Delivery</div>
                    <div style={{ fontWeight: 600, fontSize: "14px", marginTop: "2px" }}>
                      {formatDate(order.expectedDate)}
                    </div>
                  </div>

                  <div style={{ marginBottom: "10px" }}>
                    <div className="sp-kpi-label">Created Date</div>
                    <div className="subdued-text">{formatDate(order.createdAt)}</div>
                  </div>

                  {order.submittedAt && (
                    <div style={{ marginBottom: "10px" }}>
                      <div className="sp-kpi-label">Submitted Date</div>
                      <div className="subdued-text">{formatDate(order.submittedAt)}</div>
                    </div>
                  )}

                  {order.receivedAt && (
                    <div style={{ marginBottom: "10px" }}>
                      <div className="sp-kpi-label">Completed Date</div>
                      <div className="subdued-text">{formatDate(order.receivedAt)}</div>
                    </div>
                  )}

                  {order.notes && (
                    <div style={{ marginTop: "12px", paddingTop: "8px", borderTop: "1px solid var(--p-color-border-subdued)" }}>
                      <div className="sp-kpi-label">Order Notes</div>
                      <div className="subdued-text" style={{ marginTop: "2px", lineHeight: 1.4 }}>
                        {order.notes}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ADD ITEM MODAL */}
      {showAddItemModal && (
        <div
          className="sp-modal-backdrop"
          style={{ alignItems: "flex-start", paddingTop: "32px", paddingBottom: "96px", overflowY: "auto" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-add-item-title"
          onClick={() => setShowAddItemModal(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowAddItemModal(false);
          }}
        >
          <div
            className="sp-modal-content"
            style={{ maxHeight: "calc(100vh - 140px)", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="sp-modal-header" style={{ flexShrink: 0 }}>
              <h3 id="modal-add-item-title">Add Product Variant to {order.poNumber}</h3>
              <button type="button" className="sp-modal-close-btn" onClick={() => setShowAddItemModal(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleAddItem} style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <div className="sp-modal-body" style={{ overflowY: "auto", flex: "1 1 auto", minHeight: 0, maxHeight: "calc(100vh - 270px)" }}>
                <div className="sp-form-grid">
                  <div className="sp-form-group full-width">
                    <label htmlFor="po-add-variant" className="sp-label">Choose Product Variant *</label>
                    <select
                      id="po-add-variant"
                      name="productVariantId"
                      className="sp-select"
                      required
                      defaultValue=""
                      onChange={(e) => {
                        const form = e.currentTarget.form;
                        if (!form) return;
                        const vId = e.currentTarget.value;
                        const supProd = supplierProducts.find((sp) => sp.productVariantId === vId);
                        const storeVar = storeVariants.find((v) => v.id === vId);

                        const pTitle = supProd?.productVariant.product.title || storeVar?.product.title || "";
                        const vTitle = supProd?.productVariant.title || storeVar?.title || "";
                        const sku = supProd?.productVariant.sku || storeVar?.sku || "";
                        const cost = supProd?.unitCost ? String(supProd.unitCost) : "10.00";
                        const sSku = supProd?.supplierSku || "";

                        (form.elements.namedItem("productTitleSnapshot") as HTMLInputElement).value = pTitle;
                        (form.elements.namedItem("variantTitleSnapshot") as HTMLInputElement).value = vTitle;
                        (form.elements.namedItem("skuSnapshot") as HTMLInputElement).value = sku;
                        (form.elements.namedItem("unitCost") as HTMLInputElement).value = cost;
                        (form.elements.namedItem("supplierSkuSnapshot") as HTMLInputElement).value = sSku;
                        if (supProd) {
                          (form.elements.namedItem("supplierProductId") as HTMLInputElement).value = supProd.id;
                        }
                      }}
                    >
                      <option value="" disabled>Select a variant...</option>
                      {supplierProducts.length > 0 && (
                        <optgroup label="Vendor Catalog (Pre-Configured)">
                          {supplierProducts.map((sp) => (
                            <option key={sp.productVariantId} value={sp.productVariantId}>
                              {sp.productVariant.product.title} — {sp.productVariant.title} (${Number(sp.unitCost || 0).toFixed(2)})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="All Store Catalog Variants">
                        {storeVariants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.product.title} — {v.title} {v.sku ? `(${v.sku})` : ""}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>

                  <input type="hidden" name="productTitleSnapshot" defaultValue="" />
                  <input type="hidden" name="variantTitleSnapshot" defaultValue="" />
                  <input type="hidden" name="skuSnapshot" defaultValue="" />
                  <input type="hidden" name="supplierProductId" defaultValue="" />

                  <div className="sp-form-group">
                    <label htmlFor="po-add-qty" className="sp-label">Ordered Quantity *</label>
                    <input id="po-add-qty" type="number" name="orderedQty" className="sp-input" min="1" defaultValue="1" required />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="po-add-cost" className="sp-label">Unit Cost ($) *</label>
                    <input id="po-add-cost" type="number" name="unitCost" className="sp-input" step="0.01" min="0" defaultValue="10.00" required />
                  </div>

                  <div className="sp-form-group full-width">
                    <label htmlFor="po-add-sku" className="sp-label">Supplier SKU (Optional)</label>
                    <input id="po-add-sku" type="text" name="supplierSkuSnapshot" className="sp-input" placeholder="Vendor catalog SKU" />
                  </div>
                </div>
              </div>

              <div className="sp-modal-footer" style={{ flexShrink: 0, position: "sticky", bottom: 0, zIndex: 10 }}>
                <button type="button" className="sp-btn sp-btn-secondary" onClick={() => setShowAddItemModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="sp-btn sp-btn-primary" disabled={isLoading}>
                  {isLoading ? "Adding..." : "Add to Purchase Order"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT ITEM MODAL */}
      {editingItem && (
        <div
          className="sp-modal-backdrop"
          style={{ alignItems: "flex-start", paddingTop: "32px", paddingBottom: "96px", overflowY: "auto" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-edit-item-title"
          onClick={() => setEditingItem(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditingItem(null);
          }}
        >
          <div
            className="sp-modal-content"
            style={{ maxHeight: "calc(100vh - 140px)", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="sp-modal-header" style={{ flexShrink: 0 }}>
              <h3 id="modal-edit-item-title">Edit Line Item</h3>
              <button type="button" className="sp-modal-close-btn" onClick={() => setEditingItem(null)}>
                ✕
              </button>
            </div>

            <form onSubmit={(e) => handleSaveItem(e, editingItem.id)} style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <div className="sp-modal-body" style={{ overflowY: "auto", flex: "1 1 auto", minHeight: 0, maxHeight: "calc(100vh - 270px)" }}>
                <div style={{ marginBottom: "16px", padding: "10px 14px", background: "var(--p-color-bg-subdued)", borderRadius: "var(--p-radius-md)" }}>
                  <div style={{ fontWeight: 600 }}>{editingItem.productTitleSnapshot}</div>
                  <div className="subdued-text">
                    {editingItem.variantTitleSnapshot} {editingItem.skuSnapshot ? `· SKU: ${editingItem.skuSnapshot}` : ""}
                  </div>
                </div>

                <div className="sp-form-grid">
                  <div className="sp-form-group">
                    <label htmlFor="po-edit-item-qty" className="sp-label">Ordered Quantity *</label>
                    <input
                      id="po-edit-item-qty"
                      type="number"
                      name="orderedQty"
                      className="sp-input"
                      min="1"
                      defaultValue={editingItem.orderedQty}
                      required
                    />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="po-edit-item-cost" className="sp-label">Unit Cost ($) *</label>
                    <input
                      id="po-edit-item-cost"
                      type="number"
                      name="unitCost"
                      className="sp-input"
                      step="0.01"
                      min="0"
                      defaultValue={Number(editingItem.unitCost)}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="sp-modal-footer" style={{ flexShrink: 0, position: "sticky", bottom: 0, zIndex: 10 }}>
                <button type="button" className="sp-btn sp-btn-secondary" onClick={() => setEditingItem(null)}>
                  Cancel
                </button>
                <button type="submit" className="sp-btn sp-btn-primary" disabled={isLoading}>
                  {isLoading ? "Saving..." : "Update Item"}
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
