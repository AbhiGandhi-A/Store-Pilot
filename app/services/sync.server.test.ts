import { describe, it, expect, vi } from "vitest";
import {
  parseShopifyId,
  sanitizeError,
  executeGraphQL,
  fetchAllProducts,
  fetchAllLocations,
  fetchAllInventoryLevels,
  type AdminGraphQL,
} from "./shopify.admin.server";
import {
  GET_PRODUCTS,
  GET_LOCATIONS,
  GET_INVENTORY_LEVELS,
  GET_INVENTORY_LEVELS_BY_LOCATION,
} from "./shopify.graphql";

describe("Shopify Sync & GraphQL Regression Tests", () => {
  describe("parseShopifyId", () => {
    it("correctly extracts ID from Shopify GID strings", () => {
      expect(parseShopifyId("gid://shopify/Product/8273645192")).toBe("8273645192");
      expect(parseShopifyId("gid://shopify/ProductVariant/9918273645")).toBe("9918273645");
      expect(parseShopifyId("gid://shopify/Location/6628192837")).toBe("6628192837");
      expect(parseShopifyId("gid://shopify/InventoryItem/4455667788")).toBe("4455667788");
    });

    it("handles plain numeric strings and edge cases", () => {
      expect(parseShopifyId("8273645192")).toBe("8273645192");
      expect(parseShopifyId("")).toBe("");
      expect(parseShopifyId(null)).toBe("");
      expect(parseShopifyId(undefined)).toBe("");
    });
  });

  describe("sanitizeError", () => {
    it("redacts Shopify API secrets, database credentials, and Bearer tokens", () => {
      const secretError =
        "Failed with token shpat_abc1234567890def and shpss_secret987654321 on postgresql://neondb_owner:npg_suX9bg4NwFJS@ep-lucky-sound.aws.neon.tech/neondb?sslmode=require with Bearer ya29.abcdef";
      const sanitized = sanitizeError(secretError);

      expect(sanitized).not.toContain("shpat_abc1234567890def");
      expect(sanitized).not.toContain("shpss_secret987654321");
      expect(sanitized).not.toContain("neondb_owner:npg_suX9bg4NwFJS@");
      expect(sanitized).not.toContain("ya29.abcdef");
      expect(sanitized).toContain("[REDACTED_SECRET]");
      expect(sanitized).toContain("[REDACTED_USER_INFO]");
    });

    it("preserves actionable GraphQL error messages", () => {
      const msg = "Field 'legacy' doesn't exist on type 'Location'";
      expect(sanitizeError(msg)).toBe(msg);
    });
  });

  describe("GraphQL Query Validations", () => {
    it("GET_PRODUCTS does not query deprecated bodyHtml or removed variant weight/requiresShipping directly", () => {
      expect(GET_PRODUCTS).toContain("descriptionHtml");
      expect(GET_PRODUCTS).not.toMatch(/bodyHtml/);
      // requiresShipping and weight should be under inventoryItem
      expect(GET_PRODUCTS).toContain("inventoryItem");
      expect(GET_PRODUCTS).toContain("requiresShipping");
      expect(GET_PRODUCTS).toContain("measurement");
      expect(GET_PRODUCTS).toContain("weight");
    });

    it("GET_LOCATIONS does not query removed legacy, createdAt, or updatedAt on Location", () => {
      expect(GET_LOCATIONS).not.toContain("legacy");
      expect(GET_LOCATIONS).not.toContain("createdAt");
      expect(GET_LOCATIONS).not.toContain("updatedAt");
      expect(GET_LOCATIONS).toContain("address");
      expect(GET_LOCATIONS).toContain("isActive");
    });

    it("GET_INVENTORY_LEVELS queries quantities(names: ['available']) instead of removed available field", () => {
      expect(GET_INVENTORY_LEVELS).toContain('quantities(names: ["available"])');
      expect(GET_INVENTORY_LEVELS).toContain("quantity");
      // Top-level available on inventoryLevel node should not exist
      expect(GET_INVENTORY_LEVELS).not.toMatch(/node\s*\{[^}]*\bavailable\b/);
    });

    it("GET_INVENTORY_LEVELS_BY_LOCATION queries location.inventoryLevels with quantities", () => {
      expect(GET_INVENTORY_LEVELS_BY_LOCATION).toContain("location(id: $locationId)");
      expect(GET_INVENTORY_LEVELS_BY_LOCATION).toContain('quantities(names: ["available"])');
    });
  });

  describe("executeGraphQL", () => {
    it("handles GraphQL errors array safely", async () => {
      const mockAdmin: AdminGraphQL = {
        graphql: vi.fn().mockResolvedValue({
          status: 200,
          statusText: "OK",
          json: async () => ({
            errors: [
              { message: "Field 'legacy' doesn't exist on type 'Location'" },
              { message: "Field 'available' doesn't exist on type 'InventoryLevel'" },
            ],
          }),
        } as unknown as Response),
      };

      await expect(executeGraphQL(mockAdmin, "query { test }")).rejects.toThrow(
        "Shopify GraphQL Error: Field 'legacy' doesn't exist on type 'Location'; Field 'available' doesn't exist on type 'InventoryLevel'"
      );
    });

    it("handles non-array errors string (e.g., auth failure) without crashing with .map is not a function", async () => {
      const mockAdmin: AdminGraphQL = {
        graphql: vi.fn().mockResolvedValue({
          status: 401,
          statusText: "Unauthorized",
          json: async () => ({
            errors: "Unauthorized action requires read_products scope",
          }),
        } as unknown as Response),
      };

      await expect(executeGraphQL(mockAdmin, "query { test }")).rejects.toThrow(
        "Shopify GraphQL Error: Unauthorized action requires read_products scope"
      );
    });

    it("throws error when response contains no data", async () => {
      const mockAdmin: AdminGraphQL = {
        graphql: vi.fn().mockResolvedValue({
          status: 200,
          statusText: "OK",
          json: async () => ({}),
        } as unknown as Response),
      };

      await expect(executeGraphQL(mockAdmin, "query { test }")).rejects.toThrow(
        "Shopify GraphQL response contained no data"
      );
    });
  });

  describe("fetchAllProducts response parsing", () => {
    it("correctly parses products when variants is a GraphQL connection ({ edges: [...] })", async () => {
      const mockAdmin: AdminGraphQL = {
        graphql: vi.fn().mockResolvedValue({
          status: 200,
          statusText: "OK",
          json: async () => ({
            data: {
              products: {
                edges: [
                  {
                    cursor: "cur1",
                    node: {
                      id: "gid://shopify/Product/1001",
                      title: "Premium Ceramic Mug",
                      handle: "premium-ceramic-mug",
                      vendor: "Ceramics Co",
                      productType: "Kitchenware",
                      status: "ACTIVE",
                      tags: ["mug", "ceramic"],
                      descriptionHtml: "<p>Handcrafted ceramic mug</p>",
                      createdAt: "2026-01-01T00:00:00Z",
                      updatedAt: "2026-01-02T00:00:00Z",
                      variants: {
                        edges: [
                          {
                            node: {
                              id: "gid://shopify/ProductVariant/2001",
                              title: "Matte Black",
                              sku: "MUG-BLK",
                              barcode: "123456789",
                              price: "18.50",
                              compareAtPrice: "24.00",
                              inventoryPolicy: "DENY",
                              position: 1,
                              taxable: true,
                              createdAt: "2026-01-01T00:00:00Z",
                              updatedAt: "2026-01-02T00:00:00Z",
                              inventoryItem: {
                                id: "gid://shopify/InventoryItem/3001",
                                requiresShipping: true,
                                measurement: {
                                  weight: {
                                    value: 0.45,
                                    unit: "KILOGRAMS",
                                  },
                                },
                              },
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
                pageInfo: {
                  hasNextPage: false,
                  endCursor: "cur1",
                },
              },
            },
          }),
        } as unknown as Response),
      };

      const products = await fetchAllProducts(mockAdmin);
      expect(products).toHaveLength(1);

      const p = products[0];
      expect(p.id).toBe("gid://shopify/Product/1001");
      expect(p.title).toBe("Premium Ceramic Mug");
      expect(p.bodyHtml).toBe("<p>Handcrafted ceramic mug</p>");
      expect(p.variants).toHaveLength(1);

      const v = p.variants[0];
      expect(v.id).toBe("gid://shopify/ProductVariant/2001");
      expect(v.sku).toBe("MUG-BLK");
      expect(v.price).toBe("18.50");
      expect(v.inventoryItemId).toBe("3001");
      expect(v.weight).toBe(0.45);
      expect(v.weightUnit).toBe("KILOGRAMS");
      expect(v.requiresShipping).toBe(true);
    });
  });

  describe("fetchAllLocations response parsing", () => {
    it("flattens location address correctly into top-level fields", async () => {
      const mockAdmin: AdminGraphQL = {
        graphql: vi.fn().mockResolvedValue({
          status: 200,
          statusText: "OK",
          json: async () => ({
            data: {
              locations: {
                edges: [
                  {
                    cursor: "loc-cur1",
                    node: {
                      id: "gid://shopify/Location/9001",
                      name: "Central Distribution Center",
                      isActive: true,
                      address: {
                        address1: "742 Evergreen Terrace",
                        address2: "Suite 100",
                        city: "Springfield",
                        province: "Oregon",
                        provinceCode: "OR",
                        country: "United States",
                        countryCode: "US",
                        zip: "97477",
                        phone: "555-0199",
                      },
                    },
                  },
                ],
                pageInfo: {
                  hasNextPage: false,
                  endCursor: "loc-cur1",
                },
              },
            },
          }),
        } as unknown as Response),
      };

      const locations = await fetchAllLocations(mockAdmin);
      expect(locations).toHaveLength(1);

      const loc = locations[0];
      expect(loc.id).toBe("gid://shopify/Location/9001");
      expect(loc.name).toBe("Central Distribution Center");
      expect(loc.address1).toBe("742 Evergreen Terrace");
      expect(loc.city).toBe("Springfield");
      expect(loc.provinceCode).toBe("OR");
      expect(loc.countryCode).toBe("US");
      expect(loc.zip).toBe("97477");
      expect(loc.isActive).toBe(true);
      expect(loc.legacy).toBe(false);
    });
  });

  describe("fetchAllInventoryLevels response parsing", () => {
    it("extracts available inventory quantities from quantities connection", async () => {
      const mockAdmin: AdminGraphQL = {
        graphql: vi.fn().mockResolvedValue({
          status: 200,
          statusText: "OK",
          json: async () => ({
            data: {
              inventoryItems: {
                edges: [
                  {
                    cursor: "inv-cur1",
                    node: {
                      id: "gid://shopify/InventoryItem/3001",
                      tracked: true,
                      inventoryLevels: {
                        edges: [
                          {
                            node: {
                              id: "gid://shopify/InventoryLevel/4001?inventory_item_id=3001",
                              updatedAt: "2026-02-01T12:00:00Z",
                              location: {
                                id: "gid://shopify/Location/9001",
                              },
                              quantities: [
                                {
                                  name: "available",
                                  quantity: 42,
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
                pageInfo: {
                  hasNextPage: false,
                  endCursor: "inv-cur1",
                },
              },
            },
          }),
        } as unknown as Response),
      };

      const levels = await fetchAllInventoryLevels(mockAdmin);
      expect(levels).toHaveLength(1);

      const lvl = levels[0];
      expect(lvl.inventoryItemId).toBe("3001");
      expect(lvl.locationId).toBe("9001");
      expect(lvl.available).toBe(42);
      expect(lvl.updatedAt).toBe("2026-02-01T12:00:00Z");
    });
  });
});

