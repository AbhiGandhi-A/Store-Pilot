import React, { useEffect, useState, useMemo } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useFetcher, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  listSuppliers,
  createSupplier,
  updateSupplier,
  setSupplierActive,
  deleteSupplier,
  type SupplierInput,
} from "~/services/supplier.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const shopRecord = await prisma.shop.findUnique({ where: { domain: shop }, select: { id: true } });
    if (!shopRecord) return { suppliers: [], shopId: null };

    const suppliers = await listSuppliers(shopRecord.id, false);
    return { suppliers, shopId: shopRecord.id };
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
      const input: SupplierInput = {
        name: formData.get("name") as string,
        contactName: (formData.get("contactName") as string) || undefined,
        email: (formData.get("email") as string) || undefined,
        phone: (formData.get("phone") as string) || undefined,
        address: (formData.get("address") as string) || undefined,
        city: (formData.get("city") as string) || undefined,
        province: (formData.get("province") as string) || undefined,
        country: (formData.get("country") as string) || undefined,
        postalCode: (formData.get("postalCode") as string) || undefined,
        defaultLeadTime: formData.get("defaultLeadTime")
          ? parseInt(formData.get("defaultLeadTime") as string, 10)
          : undefined,
        minOrderValue: formData.get("minOrderValue")
          ? parseFloat(formData.get("minOrderValue") as string)
          : undefined,
        minOrderQty: formData.get("minOrderQty")
          ? parseInt(formData.get("minOrderQty") as string, 10)
          : undefined,
        notes: (formData.get("notes") as string) || undefined,
        isActive: formData.get("isActive") === "true",
      };

      const supplier = await createSupplier(shopRecord.id, input);
      return { success: true, supplier };
    }

    if (actionType === "update") {
      const supplierId = formData.get("supplierId") as string;
      const input: Partial<SupplierInput> = {
        name: formData.get("name") as string,
        contactName: (formData.get("contactName") as string) || undefined,
        email: (formData.get("email") as string) || undefined,
        phone: (formData.get("phone") as string) || undefined,
        address: (formData.get("address") as string) || undefined,
        city: (formData.get("city") as string) || undefined,
        province: (formData.get("province") as string) || undefined,
        country: (formData.get("country") as string) || undefined,
        postalCode: (formData.get("postalCode") as string) || undefined,
        defaultLeadTime: formData.get("defaultLeadTime")
          ? parseInt(formData.get("defaultLeadTime") as string, 10)
          : undefined,
        minOrderValue: formData.get("minOrderValue")
          ? parseFloat(formData.get("minOrderValue") as string)
          : undefined,
        minOrderQty: formData.get("minOrderQty")
          ? parseInt(formData.get("minOrderQty") as string, 10)
          : undefined,
        notes: (formData.get("notes") as string) || undefined,
        isActive: formData.get("isActive") === "true",
      };

      await updateSupplier(shopRecord.id, supplierId, input);
      return { success: true };
    }

    if (actionType === "toggleActive") {
      const supplierId = formData.get("supplierId") as string;
      const isActive = formData.get("isActive") === "true";
      await setSupplierActive(shopRecord.id, supplierId, isActive);
      return { success: true };
    }

    if (actionType === "delete") {
      const supplierId = formData.get("supplierId") as string;
      await deleteSupplier(shopRecord.id, supplierId);
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

export default function SuppliersPage() {
  const { suppliers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const isLoading = fetcher.state === "submitting";

  useEffect(() => {
    if (fetcher.data?.success) {
      setShowCreateModal(false);
      setEditingSupplier(null);
      shopify.toast.show("Supplier saved successfully");
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

  const handleEditSubmit = (e: React.FormEvent<HTMLFormElement>, supplierId: string) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("actionType", "update");
    formData.set("supplierId", supplierId);
    fetcher.submit(formData, { method: "POST" });
  };

  const handleToggle = (supplierId: string, isActive: boolean) => {
    const formData = new FormData();
    formData.set("actionType", "toggleActive");
    formData.set("supplierId", supplierId);
    formData.set("isActive", String(isActive));
    fetcher.submit(formData, { method: "POST" });
  };

  const handleDelete = (supplier: any) => {
    if ((supplier._count?.purchaseOrders || 0) > 0) {
      shopify.toast.show("Cannot delete supplier with existing purchase orders. Deactivate instead.");
      return;
    }
    if (!confirm(`Delete supplier "${supplier.name}"? This will remove all associated product mappings.`)) {
      return;
    }
    const formData = new FormData();
    formData.set("actionType", "delete");
    formData.set("supplierId", supplier.id);
    fetcher.submit(formData, { method: "POST" });
  };

  // Filtered suppliers
  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((s) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        s.name.toLowerCase().includes(q) ||
        (s.contactName && s.contactName.toLowerCase().includes(q)) ||
        (s.email && s.email.toLowerCase().includes(q)) ||
        (s.city && s.city.toLowerCase().includes(q));

      const matchesStatus =
        statusFilter === "all" || (statusFilter === "active" ? s.isActive : !s.isActive);

      return matchesSearch && matchesStatus;
    });
  }, [suppliers, searchQuery, statusFilter]);

  const totalActive = suppliers.filter((s) => s.isActive).length;
  const totalMapped = suppliers.reduce((sum, s) => sum + (s._count?.supplierProducts || 0), 0);
  const totalOrders = suppliers.reduce((sum, s) => sum + (s._count?.purchaseOrders || 0), 0);

  return (
    <div className="sp-page-layout">
      {/* Page Header */}
      <div className="sp-page-header">
        <div className="sp-page-title-group">
          <h1 className="sp-page-title">Suppliers</h1>
          <p className="sp-page-subtitle">
            Manage vendor profiles, procurement lead times, order minimums, and product catalog mappings.
          </p>
        </div>

        <div className="sp-header-actions">
          <button
            type="button"
            className="sp-btn sp-btn-primary"
            onClick={() => setShowCreateModal(true)}
            disabled={isLoading}
          >
            + Add Supplier
          </button>
        </div>
      </div>

      {actionData?.error && (
        <div className="sp-banner critical">
          <div className="sp-banner-icon">⚠</div>
          <div className="sp-banner-content">
            <h4 className="sp-banner-title">Action Error</h4>
            <p className="sp-banner-message">{actionData.error}</p>
          </div>
        </div>
      )}

      {/* Supplier Metrics Grid */}
      <div className="sp-kpi-grid">
        <div className="sp-kpi-card">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Total Suppliers</span>
            <span className="sp-badge sp-badge-neutral">Directory</span>
          </div>
          <div className="sp-kpi-value">{suppliers.length}</div>
          <div className="sp-kpi-meta">{totalActive} active partners</div>
        </div>

        <div className="sp-kpi-card success">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Active Suppliers</span>
            <span className="sp-badge sp-badge-success">
              <span className="sp-badge-dot" /> Live
            </span>
          </div>
          <div className="sp-kpi-value">{totalActive}</div>
          <div className="sp-kpi-meta">Eligible for automated reorders</div>
        </div>

        <div className="sp-kpi-card info">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Mapped Variants</span>
            <span className="sp-badge sp-badge-info">Catalog</span>
          </div>
          <div className="sp-kpi-value">{totalMapped}</div>
          <div className="sp-kpi-meta">Products linked to vendors</div>
        </div>

        <div className="sp-kpi-card">
          <div className="sp-kpi-header">
            <span className="sp-kpi-label">Purchase Orders</span>
            <span className="sp-badge sp-badge-neutral">History</span>
          </div>
          <div className="sp-kpi-value">{totalOrders}</div>
          <div className="sp-kpi-meta">
            <Link to="/app/purchase-orders" className="sp-btn-plain" style={{ padding: 0 }}>
              View all orders →
            </Link>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="sp-card">
        {/* Search & Filter Toolbar */}
        <div className="sp-toolbar">
          <div className="sp-toolbar-left">
            <div className="sp-search-box">
              <span className="sp-search-icon">🔍</span>
              <input
                type="text"
                className="sp-input"
                placeholder="Search suppliers by name, contact, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              className="sp-select"
              style={{ width: "auto" }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>
          </div>

          <div className="sp-toolbar-right">
            <span className="subdued-text">
              Showing {filteredSuppliers.length} of {suppliers.length} suppliers
            </span>
          </div>
        </div>

        {/* Suppliers Table */}
        {filteredSuppliers.length > 0 ? (
          <div className="sp-table-wrapper">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Supplier Name</th>
                  <th>Contact Info</th>
                  <th>Location</th>
                  <th>Lead Time</th>
                  <th>Min Order</th>
                  <th style={{ textAlign: "center" }}>Products</th>
                  <th style={{ textAlign: "center" }}>Orders</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <Link
                        to={`/app/suppliers/${supplier.id}`}
                        style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}
                      >
                        {supplier.name}
                      </Link>
                      {supplier.notes && (
                        <div className="subdued-text" style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {supplier.notes}
                        </div>
                      )}
                    </td>
                    <td>
                      {supplier.contactName && <div style={{ fontWeight: 500 }}>{supplier.contactName}</div>}
                      {supplier.email && (
                        <div className="subdued-text">
                          <a href={`mailto:${supplier.email}`} style={{ color: "inherit", textDecoration: "none" }}>
                            {supplier.email}
                          </a>
                        </div>
                      )}
                      {supplier.phone && <div className="subdued-text">{supplier.phone}</div>}
                      {!supplier.contactName && !supplier.email && !supplier.phone && <span className="subdued-text">—</span>}
                    </td>
                    <td>
                      <div className="subdued-text">
                        {[supplier.city, supplier.province, supplier.country].filter(Boolean).join(", ") || "—"}
                      </div>
                    </td>
                    <td>
                      <span className="sp-badge sp-badge-neutral">{supplier.defaultLeadTime} days</span>
                    </td>
                    <td>
                      <div className="subdued-text">
                        {supplier.minOrderValue ? `$${Number(supplier.minOrderValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                        {supplier.minOrderQty ? ` (${supplier.minOrderQty} units)` : ""}
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <Link
                        to={`/app/suppliers/${supplier.id}`}
                        className="sp-badge sp-badge-info"
                        style={{ textDecoration: "none" }}
                      >
                        {supplier._count?.supplierProducts || 0} mapped
                      </Link>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className="mono">{supplier._count?.purchaseOrders || 0}</span>
                    </td>
                    <td>
                      <span className={`sp-badge ${supplier.isActive ? "sp-badge-success" : "sp-badge-neutral"}`}>
                        <span className="sp-badge-dot" />
                        {supplier.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                        <Link
                          to={`/app/suppliers/${supplier.id}`}
                          className="sp-btn sp-btn-secondary sp-btn-slim"
                        >
                          Catalog
                        </Link>
                        <button
                          type="button"
                          className="sp-btn sp-btn-secondary sp-btn-slim"
                          onClick={() => setEditingSupplier(supplier)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="sp-btn sp-btn-plain sp-btn-slim"
                          onClick={() => handleToggle(supplier.id, !supplier.isActive)}
                        >
                          {supplier.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          className="sp-btn sp-btn-destructive sp-btn-slim"
                          onClick={() => handleDelete(supplier)}
                          disabled={(supplier._count?.purchaseOrders || 0) > 0}
                          title={(supplier._count?.purchaseOrders || 0) > 0 ? "Cannot delete supplier with orders" : "Delete supplier"}
                        >
                          Delete
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
            <span className="sp-empty-icon">🏢</span>
            <h3 className="sp-empty-title">
              {suppliers.length === 0 ? "No suppliers added yet" : "No suppliers match your search"}
            </h3>
            <p className="sp-empty-desc">
              {suppliers.length === 0
                ? "Add your first supplier to configure lead times, map product variants, and generate automated purchase orders."
                : "Try clearing your search query or selecting all statuses."}
            </p>
            {suppliers.length === 0 ? (
              <button
                type="button"
                className="sp-btn sp-btn-primary"
                onClick={() => setShowCreateModal(true)}
              >
                + Add First Supplier
              </button>
            ) : (
              <button
                type="button"
                className="sp-btn sp-btn-plain"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                }}
              >
                Reset filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* CREATE SUPPLIER MODAL */}
      {showCreateModal && (
        <div
          className="sp-modal-backdrop"
          style={{ alignItems: "flex-start", paddingTop: "32px", paddingBottom: "96px", overflowY: "auto" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-create-title"
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
              <h3 id="modal-create-title">Add New Supplier</h3>
              <button type="button" className="sp-modal-close-btn" onClick={() => setShowCreateModal(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <div className="sp-modal-body" style={{ overflowY: "auto", flex: "1 1 auto", minHeight: 0, maxHeight: "calc(100vh - 270px)" }}>
                <div className="sp-form-grid">
                  <div className="sp-form-group">
                    <label htmlFor="create-supplier-name" className="sp-label">Supplier / Company Name *</label>
                    <input id="create-supplier-name" type="text" name="name" className="sp-input" required placeholder="e.g. Acme Manufacturing" />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="create-contact-name" className="sp-label">Primary Contact Person</label>
                    <input id="create-contact-name" type="text" name="contactName" className="sp-input" placeholder="e.g. Jane Doe" />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="create-email" className="sp-label">Email Address</label>
                    <input id="create-email" type="email" name="email" className="sp-input" placeholder="orders@supplier.com" />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="create-phone" className="sp-label">Phone Number</label>
                    <input id="create-phone" type="tel" name="phone" className="sp-input" placeholder="+1 (555) 123-4567" />
                  </div>

                  <div className="sp-form-group full-width">
                    <label htmlFor="create-address" className="sp-label">Street Address</label>
                    <input id="create-address" type="text" name="address" className="sp-input" placeholder="123 Warehouse Way, Suite 400" />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="create-city" className="sp-label">City</label>
                    <input id="create-city" type="text" name="city" className="sp-input" placeholder="Chicago" />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="create-province" className="sp-label">State / Province</label>
                    <input id="create-province" type="text" name="province" className="sp-input" placeholder="IL" />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="create-country" className="sp-label">Country</label>
                    <input id="create-country" type="text" name="country" className="sp-input" placeholder="United States" />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="create-postal" className="sp-label">Postal / ZIP Code</label>
                    <input id="create-postal" type="text" name="postalCode" className="sp-input" placeholder="60601" />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="create-lead-time" className="sp-label">Default Lead Time (Days)</label>
                    <input id="create-lead-time" type="number" name="defaultLeadTime" className="sp-input" defaultValue="14" min="0" />
                    <span className="sp-form-hint">Used to calculate stockout risk and reorder deadlines.</span>
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="create-min-val" className="sp-label">Minimum Order Value ($)</label>
                    <input id="create-min-val" type="number" name="minOrderValue" className="sp-input" step="0.01" min="0" placeholder="0.00" />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="create-min-qty" className="sp-label">Minimum Order Quantity (Units)</label>
                    <input id="create-min-qty" type="number" name="minOrderQty" className="sp-input" min="0" placeholder="e.g. 50" />
                  </div>

                  <div className="sp-form-group" style={{ justifyContent: "center" }}>
                    <label htmlFor="create-is-active" className="sp-checkbox-row">
                      <input id="create-is-active" type="checkbox" name="isActive" defaultChecked value="true" />
                      <span className="sp-label" style={{ marginBottom: 0 }}>Active Supplier</span>
                    </label>
                    <span className="sp-form-hint">Active suppliers can be selected for purchase orders.</span>
                  </div>

                  <div className="sp-form-group full-width">
                    <label htmlFor="create-notes" className="sp-label">Notes & Instructions</label>
                    <textarea id="create-notes" name="notes" className="sp-input" rows={3} placeholder="Account numbers, special shipping instructions, or terms..." />
                  </div>
                </div>
              </div>

              <div className="sp-modal-footer" style={{ flexShrink: 0, position: "sticky", bottom: 0, zIndex: 10 }}>
                <button type="button" className="sp-btn sp-btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="sp-btn sp-btn-primary" disabled={isLoading}>
                  {isLoading ? "Saving..." : "Create Supplier"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT SUPPLIER MODAL */}
      {editingSupplier && (
        <div
          className="sp-modal-backdrop"
          style={{ alignItems: "flex-start", paddingTop: "32px", paddingBottom: "96px", overflowY: "auto" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-edit-title"
          onClick={() => setEditingSupplier(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditingSupplier(null);
          }}
        >
          <div
            className="sp-modal-content"
            style={{ maxHeight: "calc(100vh - 140px)", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="sp-modal-header" style={{ flexShrink: 0 }}>
              <h3 id="modal-edit-title">Edit Supplier: {editingSupplier.name}</h3>
              <button type="button" className="sp-modal-close-btn" onClick={() => setEditingSupplier(null)}>
                ✕
              </button>
            </div>

            <form onSubmit={(e) => handleEditSubmit(e, editingSupplier.id)} style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <div className="sp-modal-body" style={{ overflowY: "auto", flex: "1 1 auto", minHeight: 0, maxHeight: "calc(100vh - 270px)" }}>
                <div className="sp-form-grid">
                  <div className="sp-form-group">
                    <label htmlFor="edit-name" className="sp-label">Supplier / Company Name *</label>
                    <input id="edit-name" type="text" name="name" className="sp-input" required defaultValue={editingSupplier.name} />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-contact" className="sp-label">Primary Contact Person</label>
                    <input id="edit-contact" type="text" name="contactName" className="sp-input" defaultValue={editingSupplier.contactName || ""} />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-email" className="sp-label">Email Address</label>
                    <input id="edit-email" type="email" name="email" className="sp-input" defaultValue={editingSupplier.email || ""} />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-phone" className="sp-label">Phone Number</label>
                    <input id="edit-phone" type="tel" name="phone" className="sp-input" defaultValue={editingSupplier.phone || ""} />
                  </div>

                  <div className="sp-form-group full-width">
                    <label htmlFor="edit-address" className="sp-label">Street Address</label>
                    <input id="edit-address" type="text" name="address" className="sp-input" defaultValue={editingSupplier.address || ""} />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-city" className="sp-label">City</label>
                    <input id="edit-city" type="text" name="city" className="sp-input" defaultValue={editingSupplier.city || ""} />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-province" className="sp-label">State / Province</label>
                    <input id="edit-province" type="text" name="province" className="sp-input" defaultValue={editingSupplier.province || ""} />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-country" className="sp-label">Country</label>
                    <input id="edit-country" type="text" name="country" className="sp-input" defaultValue={editingSupplier.country || ""} />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-postal" className="sp-label">Postal / ZIP Code</label>
                    <input id="edit-postal" type="text" name="postalCode" className="sp-input" defaultValue={editingSupplier.postalCode || ""} />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-lead-time" className="sp-label">Default Lead Time (Days)</label>
                    <input id="edit-lead-time" type="number" name="defaultLeadTime" className="sp-input" defaultValue={editingSupplier.defaultLeadTime} min="0" />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-min-val" className="sp-label">Minimum Order Value ($)</label>
                    <input id="edit-min-val" type="number" name="minOrderValue" className="sp-input" step="0.01" min="0" defaultValue={editingSupplier.minOrderValue ? String(editingSupplier.minOrderValue) : ""} />
                  </div>

                  <div className="sp-form-group">
                    <label htmlFor="edit-min-qty" className="sp-label">Minimum Order Quantity (Units)</label>
                    <input id="edit-min-qty" type="number" name="minOrderQty" className="sp-input" min="0" defaultValue={editingSupplier.minOrderQty ? String(editingSupplier.minOrderQty) : ""} />
                  </div>

                  <div className="sp-form-group" style={{ justifyContent: "center" }}>
                    <label htmlFor="edit-is-active" className="sp-checkbox-row">
                      <input id="edit-is-active" type="checkbox" name="isActive" defaultChecked={editingSupplier.isActive} value="true" />
                      <span className="sp-label" style={{ marginBottom: 0 }}>Active Supplier</span>
                    </label>
                  </div>

                  <div className="sp-form-group full-width">
                    <label htmlFor="edit-notes" className="sp-label">Notes & Instructions</label>
                    <textarea id="edit-notes" name="notes" className="sp-input" rows={3} defaultValue={editingSupplier.notes || ""} />
                  </div>
                </div>
              </div>

              <div className="sp-modal-footer" style={{ flexShrink: 0, position: "sticky", bottom: 0, zIndex: 10 }}>
                <button type="button" className="sp-btn sp-btn-secondary" onClick={() => setEditingSupplier(null)}>
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
