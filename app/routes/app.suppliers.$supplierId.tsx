/* eslint-disable @typescript-eslint/no-explicit-any, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions, react-hooks/rules-of-hooks */
import React, { useEffect, useState, useMemo } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getSupplier,
  listSupplierProducts,
  createSupplierProduct,
  updateSupplierProduct,
  deleteSupplierProduct,
  setPreferredSupplierProduct,
  type SupplierProductInput,
} from "~/services/supplier.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = session;
  const supplierId = params.supplierId;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const shopRecord = await prisma.shop.findUnique({ where: { domain: shop }, select: { id: true } });
    if (!shopRecord) return { supplier: null, products: [], storeVariants: [], shopId: null };

    if (!supplierId) return { supplier: null, products: [], storeVariants: [], shopId: shopRecord.id };

    const supplier = await getSupplier(shopRecord.id, supplierId);
    if (!supplier) return { supplier: null, products: [], storeVariants: [], shopId: shopRecord.id };

    const products = await listSupplierProducts(shopRecord.id, supplierId);

    const storeVariants = await prisma.productVariant.findMany({
      where: { shopId: shopRecord.id },
      include: { product: true },
      orderBy: { product: { title: "asc" } },
      take: 200,
    });

    return { supplier, products, storeVariants, shopId: shopRecord.id };
  } finally {
    await prisma.$disconnect();
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = session;
  const supplierId = params.supplierId;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const shopRecord = await prisma.shop.findUnique({ where: { domain: shop }, select: { id: true } });
    if (!shopRecord) return { success: false, error: "Shop not found" };

    if (!supplierId) return { success: false, error: "Supplier ID required" };

    const formData = await request.formData();
    const actionType = formData.get("actionType") as string;

    if (actionType === "addProduct") {
      const input: SupplierProductInput = {
        supplierId,
        productVariantId: formData.get("productVariantId") as string,
        supplierSku: (formData.get("supplierSku") as string) || undefined,
        unitCost: formData.get("unitCost") ? parseFloat(formData.get("unitCost") as string) : undefined,
        currency: (formData.get("currency") as string) || undefined,
        leadTimeDays: formData.get("leadTimeDays") ? parseInt(formData.get("leadTimeDays") as string, 10) : undefined,
        minOrderQty: formData.get("minOrderQty") ? parseInt(formData.get("minOrderQty") as string, 10) : undefined,
        isPreferred: formData.get("isPreferred") === "true",
      };

      await createSupplierProduct(shopRecord.id, input);
      return { success: true };
    }

    if (actionType === "updateProduct") {
      const mappingId = formData.get("mappingId") as string;
      const input: Partial<SupplierProductInput> = {
        supplierSku: (formData.get("supplierSku") as string) || undefined,
        unitCost: formData.get("unitCost") ? parseFloat(formData.get("unitCost") as string) : undefined,
        currency: (formData.get("currency") as string) || undefined,
        leadTimeDays: formData.get("leadTimeDays") ? parseInt(formData.get("leadTimeDays") as string, 10) : undefined,
        minOrderQty: formData.get("minOrderQty") ? parseInt(formData.get("minOrderQty") as string, 10) : undefined,
        isPreferred: formData.get("isPreferred") === "true",
      };

      await updateSupplierProduct(shopRecord.id, mappingId, input);
      return { success: true };
    }

    if (actionType === "deleteProduct") {
      const mappingId = formData.get("mappingId") as string;
      await deleteSupplierProduct(shopRecord.id, mappingId);
      return { success: true };
    }

    if (actionType === "setPreferred") {
      const mappingId = formData.get("mappingId") as string;
      await setPreferredSupplierProduct(shopRecord.id, mappingId, true);
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

export default function SupplierDetailsPage() {
  const { supplier, products, storeVariants } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingMapping, setEditingMapping] = useState<any | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [preferredFilter, setPreferredFilter] = useState<"all" | "preferred">("all");

  const isLoading = fetcher.state === "submitting";

  useEffect(() => {
    if (fetcher.data?.success) {
      setShowAddModal(false);
      setEditingMapping(null);
      shopify.toast.show("Product mapping updated successfully");
    }
    if (fetcher.data?.error) {
      shopify.toast.show(`Error: ${fetcher.data.error}`);
    }
  }, [fetcher.data, shopify]);

  if (!supplier) {
    return (
      <div className="sp-page-layout">
        <div className="sp-banner critical">
          <div className="sp-banner-icon">⚠</div>
          <div className="sp-banner-content">
            <h4 className="sp-banner-title">Supplier Not Found</h4>
            <p className="sp-banner-message">The requested supplier does not exist or has been removed.</p>
          </div>
        </div>
        <Link to="/app/suppliers" className="sp-btn sp-btn-secondary">
          ← Back to Suppliers
        </Link>
      </div>
    );
  }

  // Set of already mapped variant IDs
  const mappedVariantIds = new Set(products.map((p) => p.productVariantId));
  const unmappedStoreVariants = storeVariants.filter((v) => !mappedVariantIds.has(v.id));

  // Filtered mapped products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const q = productSearch.toLowerCase();
      const matchesSearch =
        !productSearch ||
        p.productVariant.product.title.toLowerCase().includes(q) ||
        p.productVariant.title.toLowerCase().includes(q) ||
        (p.productVariant.sku && p.productVariant.sku.toLowerCase().includes(q)) ||
        (p.supplierSku && p.supplierSku.toLowerCase().includes(q));

      const matchesPreferred = preferredFilter === "all" || p.isPreferred;
      return matchesSearch && matchesPreferred;
    });
  }, [products, productSearch, preferredFilter]);

  const handleAddSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("actionType", "addProduct");
    fetcher.submit(formData, { method: "POST" });
  };

  const handleEditSubmit = (e: React.FormEvent<HTMLFormElement>, mappingId: string) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("actionType", "updateProduct");
    formData.set("mappingId", mappingId);
    fetcher.submit(formData, { method: "POST" });
  };

  const handleSetPreferred = (mappingId: string) => {
    const formData = new FormData();
    formData.set("actionType", "setPreferred");
    formData.set("mappingId", mappingId);
    fetcher.submit(formData, { method: "POST" });
  };

  const handleDelete = (mapping: any) => {
    if (!confirm(`Remove "${mapping.productVariant.product.title} - ${mapping.productVariant.title}" from this supplier?`)) {
      return;
    }
    const formData = new FormData();
    formData.set("actionType", "deleteProduct");
    formData.set("mappingId", mapping.id);
    fetcher.submit(formData, { method: "POST" });
  };

  return (
    <div className="sp-page-layout">
      {/* Breadcrumb Navigation */}
      <div style={{ marginBottom: "12px" }}>
        <Link to="/app/suppliers" className="sp-btn-plain" style={{ padding: 0, fontSize: "13px" }}>
          ← Back to Suppliers
        </Link>
      </div>

      {/* Page Header */}
      <div className="sp-page-header">
        <div className="sp-page-title-group">
          <h1 className="sp-page-title">
            {supplier.name}
            <span className={`sp-badge ${supplier.isActive ? "sp-badge-success" : "sp-badge-neutral"}`}>
              <span className="sp-badge-dot" />
              {supplier.isActive ? "Active Supplier" : "Inactive"}
            </span>
          </h1>
          <p className="sp-page-subtitle">
            {[
              supplier.contactName,
              supplier.email,
              supplier.phone,
              [supplier.city, supplier.province, supplier.country].filter(Boolean).join(", "),
            ]
              .filter(Boolean)
              .join(" · ") || "No contact information recorded"}
          </p>
        </div>

        <div className="sp-header-actions">
          <button
            type="button"
            className="sp-btn sp-btn-primary"
            onClick={() => setShowAddModal(true)}
            disabled={isLoading}
          >
            + Map Product Variant
          </button>
        </div>
      </div>

      {/* Supplier Terms KPI Grid */}
      <div className="sp-kpi-grid">
        <div className="sp-kpi-card">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Default Lead Time</span>
            <span className="sp-badge sp-badge-neutral">Timeline</span>
          </div>
          <div className="sp-kpi-value">{supplier.defaultLeadTime} <span style={{ fontSize: "16px", fontWeight: 500 }}>days</span></div>
          <div className="sp-kpi-meta">Standard delivery duration</div>
        </div>

        <div className="sp-kpi-card info">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Order Minimums</span>
            <span className="sp-badge sp-badge-info">Terms</span>
          </div>
          <div className="sp-kpi-value">
            {supplier.minOrderValue ? `$${Number(supplier.minOrderValue).toFixed(0)}` : "None"}
          </div>
          <div className="sp-kpi-meta">
            {supplier.minOrderQty ? `Min quantity: ${supplier.minOrderQty} units` : "No unit minimum specified"}
          </div>
        </div>

        <div className="sp-kpi-card success">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Mapped Catalog</span>
            <span className="sp-badge sp-badge-success">Products</span>
          </div>
          <div className="sp-kpi-value">{products.length}</div>
          <div className="sp-kpi-meta">
            {products.filter((p) => p.isPreferred).length} preferred supplier mappings
          </div>
        </div>

        <div className="sp-kpi-card">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Purchase Orders</span>
            <span className="sp-badge sp-badge-neutral">Activity</span>
          </div>
          <div className="sp-kpi-value">{supplier._count?.purchaseOrders || 0}</div>
          <div className="sp-kpi-meta">
            <Link to="/app/purchase-orders" className="sp-btn-plain" style={{ padding: 0 }}>
              View orders →
            </Link>
          </div>
        </div>
      </div>

      {/* Mapped Products Card */}
      <div className="sp-card">
        <div className="sp-card-header">
          <h3 className="sp-card-title">Mapped Product Variants ({products.length})</h3>
          <span className="subdued-text">
            Configured cost, supplier SKU, and lead times for replenishment
          </span>
        </div>

        {/* Toolbar */}
        <div className="sp-toolbar">
          <div className="sp-toolbar-left">
            <div className="sp-search-box">
              <span className="sp-search-icon">🔍</span>
              <input
                type="text"
                className="sp-input"
                placeholder="Search mapped products by title, SKU, or supplier SKU..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </div>

            <select
              className="sp-select"
              style={{ width: "auto" }}
              value={preferredFilter}
              onChange={(e) => setPreferredFilter(e.target.value as any)}
            >
              <option value="all">All Mapped Products</option>
              <option value="preferred">Preferred Only</option>
            </select>
          </div>

          <div className="sp-toolbar-right">
            <span className="subdued-text">
              Showing {filteredProducts.length} of {products.length} mappings
            </span>
          </div>
        </div>

        {/* Products Table */}
        {filteredProducts.length > 0 ? (
          <div className="sp-table-wrapper">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Product & Variant</th>
                  <th>Store SKU</th>
                  <th>Supplier SKU</th>
                  <th style={{ textAlign: "right" }}>Unit Cost</th>
                  <th>Lead Time</th>
                  <th>Min Qty</th>
                  <th>Supplier Status</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((mapping) => (
                  <tr key={mapping.id}>
                    <td>
                      <div className="primary-cell">{mapping.productVariant.product.title}</div>
                      <div className="subdued-text">{mapping.productVariant.title}</div>
                    </td>
                    <td className="mono">{mapping.productVariant.sku || "—"}</td>
                    <td className="mono">
                      {mapping.supplierSku ? (
                        <span className="sp-badge sp-badge-neutral">{mapping.supplierSku}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>
                      {mapping.unitCost !== null
                        ? `$${Number(mapping.unitCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${mapping.currency || "USD"}`
                        : "—"}
                    </td>
                    <td>
                      <span className="subdued-text">
                        {mapping.leadTimeDays ? `${mapping.leadTimeDays} days` : `${supplier.defaultLeadTime} days (default)`}
                      </span>
                    </td>
                    <td>
                      <span className="subdued-text">
                        {mapping.minOrderQty ? `${mapping.minOrderQty} units` : "—"}
                      </span>
                    </td>
                    <td>
                      {mapping.isPreferred ? (
                        <span className="sp-badge sp-badge-success">
                          ★ Preferred
                        </span>
                      ) : (
                        <span className="sp-badge sp-badge-neutral">
                          Alternate
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                        <button
                          type="button"
                          className="sp-btn sp-btn-secondary sp-btn-slim"
                          onClick={() => setEditingMapping(mapping)}
                        >
                          Edit
                        </button>
                        {!mapping.isPreferred && (
                          <button
                            type="button"
                            className="sp-btn sp-btn-plain sp-btn-slim"
                            onClick={() => handleSetPreferred(mapping.id)}
                            title="Set as primary supplier for reordering this variant"
                          >
                            Set Preferred
                          </button>
                        )}
                        <button
                          type="button"
                          className="sp-btn sp-btn-destructive sp-btn-slim"
                          onClick={() => handleDelete(mapping)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sp-empty-state">
            <span className="sp-empty-icon">📦</span>
            <h3 className="sp-empty-title">
              {products.length === 0 ? "No products mapped to this supplier yet" : "No mapped products match your search"}
            </h3>
            <p className="sp-empty-desc">
              {products.length === 0
                ? "Connect your store's variants to this supplier to set procurement costs, vendor SKUs, and enable 1-click reorder planning."
                : "Try clearing your search query or choosing All Mapped Products."}
            </p>
            {products.length === 0 ? (
              <button
                type="button"
                className="sp-btn sp-btn-primary"
                onClick={() => setShowAddModal(true)}
              >
                + Map First Product Variant
              </button>
            ) : (
              <button
                type="button"
                className="sp-btn sp-btn-plain"
                onClick={() => {
                  setProductSearch("");
                  setPreferredFilter("all");
                }}
              >
                Clear filter
              </button>
            )}
          </div>
        )}
      </div>

      {/* ADD PRODUCT MAPPING MODAL */}
      {showAddModal && (
        <div
          className="sp-modal-backdrop"
          style={{ alignItems: "flex-start", paddingTop: "32px", paddingBottom: "96px", overflowY: "auto" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-map-title"
          onClick={() => setShowAddModal(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowAddModal(false);
          }}
        >
          <div
            className="sp-modal-content"
            style={{ maxHeight: "calc(100vh - 140px)", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="sp-modal-header" style={{ flexShrink: 0 }}>
              <h3 id="modal-map-title">Map Variant to {supplier.name}</h3>
              <button type="button" className="sp-modal-close-btn" onClick={() => setShowAddModal(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleAddSubmit} style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <div className="sp-modal-body" style={{ overflowY: "auto", flex: "1 1 auto", minHeight: 0, maxHeight: "calc(100vh - 270px)" }}>
                <div className="sp-form-grid">
                  <div className="sp-form-group full-width">
                    <label htmlFor="add-prod-variant" className="sp-label">Select Store Product Variant *</label>
                    <select id="add-prod-variant" name="productVariantId" className="sp-select" required defaultValue="">
                      <option value="" disabled>
                        Choose a variant from your catalog...
                      </option>
                      {unmappedStoreVariants.length > 0 ? (
                        unmappedStoreVariants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.product.title} — {v.title} {v.sku ? `(SKU: ${v.sku})` : ""}
                          </option>
                        ))
                      ) : (
                        <option value="" disabled>
                          All loaded variants are already mapped.
                        </option>
                      )}
                    </select>
                    <span className="sp-form-hint">
                      Variants mapped to this vendor will be automatically assigned during reorder recommendations.
                    </span>
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="add-sup-sku" className="sp-label">Supplier SKU / Part Number</label>
                    <input id="add-sup-sku" type="text" name="supplierSku" className="sp-input" placeholder="e.g. VEND-9821" />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="add-unit-cost" className="sp-label">Unit Cost ($)</label>
                    <input id="add-unit-cost" type="number" name="unitCost" className="sp-input" step="0.01" min="0" placeholder="15.00" />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="add-currency" className="sp-label">Currency</label>
                    <select id="add-currency" name="currency" className="sp-select" defaultValue="USD">
                      <option value="USD">USD ($)</option>
                      <option value="CAD">CAD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                    </select>
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="add-lead-time" className="sp-label">Custom Lead Time (Days)</label>
                    <input
                      id="add-lead-time"
                      type="number"
                      name="leadTimeDays"
                      className="sp-input"
                      defaultValue={supplier.defaultLeadTime}
                      min="0"
                    />
                    <span className="sp-form-hint">Leave default or override for this item.</span>
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="add-min-qty" className="sp-label">Minimum Order Qty</label>
                    <input id="add-min-qty" type="number" name="minOrderQty" className="sp-input" min="0" placeholder="e.g. 10" />
                  </div>

                  <div className="sp-form-group" style={{ justifyContent: "center" }}>
                    <label htmlFor="add-is-pref" className="sp-checkbox-row">
                      <input id="add-is-pref" type="checkbox" name="isPreferred" value="true" defaultChecked={products.length === 0} />
                      <span className="sp-label" style={{ marginBottom: 0 }}>Preferred Supplier for this item</span>
                    </label>
                    <span className="sp-form-hint">Used as default supplier for reorder suggestions.</span>
                  </div>
                </div>
              </div>

              <div className="sp-modal-footer" style={{ flexShrink: 0, position: "sticky", bottom: 0, zIndex: 10 }}>
                <button type="button" className="sp-btn sp-btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="sp-btn sp-btn-primary" disabled={isLoading || unmappedStoreVariants.length === 0}>
                  {isLoading ? "Saving..." : "Add Product Mapping"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT PRODUCT MAPPING MODAL */}
      {editingMapping && (
        <div
          className="sp-modal-backdrop"
          style={{ alignItems: "flex-start", paddingTop: "32px", paddingBottom: "96px", overflowY: "auto" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-edit-map-title"
          onClick={() => setEditingMapping(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditingMapping(null);
          }}
        >
          <div
            className="sp-modal-content"
            style={{ maxHeight: "calc(100vh - 140px)", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="sp-modal-header" style={{ flexShrink: 0 }}>
              <h3 id="modal-edit-map-title">Edit Mapping: {editingMapping.productVariant.product.title}</h3>
              <button type="button" className="sp-modal-close-btn" onClick={() => setEditingMapping(null)}>
                ✕
              </button>
            </div>

            <form onSubmit={(e) => handleEditSubmit(e, editingMapping.id)} style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <div className="sp-modal-body" style={{ overflowY: "auto", flex: "1 1 auto", minHeight: 0, maxHeight: "calc(100vh - 270px)" }}>
                <div style={{ marginBottom: "16px", padding: "10px 14px", background: "var(--p-color-bg-subdued)", borderRadius: "var(--p-radius-md)" }}>
                  <div style={{ fontWeight: 600 }}>{editingMapping.productVariant.product.title}</div>
                  <div className="subdued-text">
                    Variant: {editingMapping.productVariant.title} · Store SKU: {editingMapping.productVariant.sku || "—"}
                  </div>
                </div>

                <div className="sp-form-grid">
                  <div className="sp-form-group">
                    <label htmlFor="edit-sup-sku" className="sp-label">Supplier SKU</label>
                    <input id="edit-sup-sku" type="text" name="supplierSku" className="sp-input" defaultValue={editingMapping.supplierSku || ""} />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-unit-cost" className="sp-label">Unit Cost ($)</label>
                    <input
                      id="edit-unit-cost"
                      type="number"
                      name="unitCost"
                      className="sp-input"
                      step="0.01"
                      min="0"
                      defaultValue={editingMapping.unitCost !== null ? String(editingMapping.unitCost) : ""}
                    />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-currency" className="sp-label">Currency</label>
                    <select id="edit-currency" name="currency" className="sp-select" defaultValue={editingMapping.currency || "USD"}>
                      <option value="USD">USD ($)</option>
                      <option value="CAD">CAD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                    </select>
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-lead-time" className="sp-label">Lead Time (Days)</label>
                    <input
                      id="edit-lead-time"
                      type="number"
                      name="leadTimeDays"
                      className="sp-input"
                      defaultValue={editingMapping.leadTimeDays !== null ? String(editingMapping.leadTimeDays) : String(supplier.defaultLeadTime)}
                      min="0"
                    />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-min-qty" className="sp-label">Min Order Qty</label>
                    <input
                      id="edit-min-qty"
                      type="number"
                      name="minOrderQty"
                      className="sp-input"
                      defaultValue={editingMapping.minOrderQty !== null ? String(editingMapping.minOrderQty) : ""}
                      min="0"
                    />
                  </div>

                  <div className="sp-form-group" style={{ justifyContent: "center" }}>
                    <label htmlFor="edit-is-pref" className="sp-checkbox-row">
                      <input
                        id="edit-is-pref"
                        type="checkbox"
                        name="isPreferred"
                        value="true"
                        defaultChecked={editingMapping.isPreferred}
                      />
                      <span className="sp-label" style={{ marginBottom: 0 }}>Preferred Supplier</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="sp-modal-footer" style={{ flexShrink: 0, position: "sticky", bottom: 0, zIndex: 10 }}>
                <button type="button" className="sp-btn sp-btn-secondary" onClick={() => setEditingMapping(null)}>
                  Cancel
                </button>
                <button type="submit" className="sp-btn sp-btn-primary" disabled={isLoading}>
                  {isLoading ? "Saving..." : "Save Changes"}
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
