import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanItems, lineRate, nightsBetween, stayLine, totals, ukDate } from "../src/lib/invoices.ts";

test("a stay agreed at £4,000 for 30 nights totals £4,000, not £4,000.20", () => {
  const line = stayLine("2026-11-06", "2026-12-06", 4000);
  assert.equal(line.qty, 30);
  assert.equal(line.description, "Nightly Rate (6/11/2026 - 6/12/2026)");
  assert.equal(lineRate(line), 133.33);
  assert.deepEqual(totals([line]), { subtotal: 4000, vat: 0, total: 4000 });
});

test("the sample invoice adds up the same as the old tool when priced by rate", () => {
  const items = [
    { description: "Nightly Rate", qty: 30, unit: "Nights", rate: 133.34, vatRate: 0 },
    { description: "Cancellation Fee", qty: 1, unit: "Service", rate: 124, vatRate: 0 },
    { description: "Refundable Deposit", qty: 1, unit: "Service", rate: 300, vatRate: 0 },
  ];
  assert.deepEqual(totals(items), { subtotal: 4424.2, vat: 0, total: 4424.2 });
});

test("VAT is worked per line in pence", () => {
  const t = totals([
    { description: "Cleaning", qty: 1, unit: "Service", rate: 40, vatRate: 20 },
    { description: "Linen", qty: 3, unit: "Item", rate: 0.1, vatRate: 20 },
  ]);
  assert.deepEqual(t, { subtotal: 40.3, vat: 8.06, total: 48.36 });
});

test("empty rows are dropped and numbers are cleaned", () => {
  const items = cleanItems([{ description: "", qty: "", rate: "" }, { description: " Fee ", qty: "1", rate: "40", vatRate: "0", fixedTotal: "" }]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { description: "Fee", qty: 1, unit: "", rate: 40, vatRate: 0, fixedTotal: null });
});

test("dates", () => {
  assert.equal(nightsBetween("2026-11-01", "2026-11-05"), 4);
  assert.equal(nightsBetween("2026-11-05", "2026-11-01"), 0);
  assert.equal(ukDate("2026-01-09"), "9/1/2026");
});
