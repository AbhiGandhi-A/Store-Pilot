import { describe, it, expect } from "vitest";

function calculateDaysRemaining(available: number, dailyDemand: number): number | null {
  if (dailyDemand <= 0) return null;
  if (available <= 0) return 0;
  return Math.floor(available / dailyDemand);
}

function calculateReorderPoint(
  averageDailyDemand: number,
  leadTimeDays: number,
  safetyStock: number
): number {
  return Math.ceil(averageDailyDemand * leadTimeDays + safetyStock);
}

function calculateSafetyStock(averageDailyDemand: number, safetyStockDays: number): number {
  return Math.ceil(averageDailyDemand * safetyStockDays);
}

function calculateTargetStock(
  averageDailyDemand: number,
  coverageDays: number,
  safetyStock: number
): number {
  return Math.ceil(averageDailyDemand * coverageDays + safetyStock);
}

function calculateSuggestedReorderQuantity(
  targetStock: number,
  availableQuantity: number,
  minimumOrderQuantity: number
): number {
  const needed = Math.max(0, targetStock - availableQuantity);
  return Math.max(needed, minimumOrderQuantity);
}

function isStaleData(lastSyncedAt: Date, maxAgeHours: number = 24): boolean {
  const ageMs = Date.now() - lastSyncedAt.getTime();
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}

describe("Inventory Intelligence Formulas", () => {
  describe("calculateDaysRemaining", () => {
    it("returns 0 when available is 0", () => {
      expect(calculateDaysRemaining(0, 5)).toBe(0);
    });

    it("returns 0 when available is negative", () => {
      expect(calculateDaysRemaining(-5, 5)).toBe(0);
    });

    it("returns null when daily demand is 0", () => {
      expect(calculateDaysRemaining(100, 0)).toBeNull();
    });

    it("returns null when daily demand is negative", () => {
      expect(calculateDaysRemaining(100, -1)).toBeNull();
    });

    it("calculates correct days remaining", () => {
      expect(calculateDaysRemaining(100, 10)).toBe(10);
      expect(calculateDaysRemaining(95, 10)).toBe(9);
      expect(calculateDaysRemaining(50, 7)).toBe(7);
    });

    it("handles fractional results by flooring", () => {
      expect(calculateDaysRemaining(10, 3)).toBe(3);
      expect(calculateDaysRemaining(7, 2)).toBe(3);
    });
  });

  describe("calculateReorderPoint", () => {
    it("calculates reorder point with safety stock", () => {
      expect(calculateReorderPoint(10, 7, 20)).toBe(90);
      expect(calculateReorderPoint(5.5, 14, 10)).toBe(87);
    });

    it("handles zero safety stock", () => {
      expect(calculateReorderPoint(10, 7, 0)).toBe(70);
    });

    it("handles zero lead time", () => {
      expect(calculateReorderPoint(10, 0, 20)).toBe(20);
    });

    it("handles zero demand", () => {
      expect(calculateReorderPoint(0, 7, 20)).toBe(20);
    });
  });

  describe("calculateSafetyStock", () => {
    it("calculates safety stock correctly", () => {
      expect(calculateSafetyStock(10, 7)).toBe(70);
      expect(calculateSafetyStock(5.5, 3)).toBe(17);
    });

    it("handles zero demand", () => {
      expect(calculateSafetyStock(0, 7)).toBe(0);
    });

    it("handles zero safety stock days", () => {
      expect(calculateSafetyStock(10, 0)).toBe(0);
    });
  });

  describe("calculateTargetStock", () => {
    it("calculates target stock correctly", () => {
      expect(calculateTargetStock(10, 60, 20)).toBe(620);
      expect(calculateTargetStock(5.5, 30, 10)).toBe(175);
    });

    it("handles zero coverage days", () => {
      expect(calculateTargetStock(10, 0, 20)).toBe(20);
    });

    it("handles zero demand", () => {
      expect(calculateTargetStock(0, 60, 20)).toBe(20);
    });
  });

  describe("calculateSuggestedReorderQuantity", () => {
    it("returns minimum order quantity when target <= available", () => {
      expect(calculateSuggestedReorderQuantity(100, 150, 10)).toBe(10);
    });

    it("calculates needed quantity when target > available", () => {
      expect(calculateSuggestedReorderQuantity(200, 150, 10)).toBe(50);
    });

    it("returns minimum order quantity when needed is less than minimum", () => {
      expect(calculateSuggestedReorderQuantity(160, 150, 25)).toBe(25);
    });

    it("handles zero available", () => {
      expect(calculateSuggestedReorderQuantity(100, 0, 10)).toBe(100);
    });

    it("handles zero minimum order quantity", () => {
      expect(calculateSuggestedReorderQuantity(100, 80, 0)).toBe(20);
    });
  });

  describe("isStaleData", () => {
    it("returns false for recent data", () => {
      const recent = new Date(Date.now() - 60 * 60 * 1000);
      expect(isStaleData(recent, 24)).toBe(false);
    });

    it("returns true for old data", () => {
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
      expect(isStaleData(old, 24)).toBe(true);
    });

    it("handles exact boundary", () => {
      const boundary = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1);
      expect(isStaleData(boundary, 24)).toBe(true);
    });

    it("respects custom max age", () => {
      const recent = new Date(Date.now() - 2 * 60 * 60 * 1000);
      expect(isStaleData(recent, 1)).toBe(true);
      expect(isStaleData(recent, 3)).toBe(false);
    });
  });
});

describe("Edge Cases", () => {
  it("handles very high demand", () => {
    expect(calculateDaysRemaining(100, 1000)).toBe(0);
    expect(calculateReorderPoint(1000, 7, 50)).toBe(7050);
    expect(calculateSuggestedReorderQuantity(70000, 100, 1)).toBe(69900);
  });

  it("handles very low demand", () => {
    expect(calculateDaysRemaining(100, 0.01)).toBe(10000);
    expect(calculateReorderPoint(0.01, 14, 1)).toBe(2);
    expect(calculateSafetyStock(0.01, 7)).toBe(1);
  });

  it("handles zero minimum order quantity edge case", () => {
    expect(calculateSuggestedReorderQuantity(100, 50, 0)).toBe(50);
  });

  it("handles negative available with positive demand", () => {
    expect(calculateDaysRemaining(-10, 5)).toBe(0);
  });

  it("handles negative demand edge case", () => {
    expect(calculateDaysRemaining(100, -5)).toBeNull();
    expect(calculateReorderPoint(-5, 7, 10)).toBe(-25);
  });
});