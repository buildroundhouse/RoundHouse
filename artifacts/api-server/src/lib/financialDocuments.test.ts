import { describe, expect, it } from "vitest";
import { financialAuthority, isFinancialOperator, validateDocumentInput, checkDocumentAction } from "./financialDocuments";
const pending = { kind: "estimate", status: "pending", convertedInvoiceId: null };
describe("financial permission and document transitions", () => {
  it.each(["owner", "admin"])("recognizes %s financial authority but honors explicit restriction", role => {
    expect(financialAuthority({ role, status: "approved" })).toBe(true);
    expect(financialAuthority({ role, status: "approved", permissions: { seeBilling: false } })).toBe(false);
  });
  it.each(["manager", "employee", "worker"])("%s needs financial permission independently of work permission", role => {
    expect(financialAuthority({ role, status: "approved" })).toBe(false);
    expect(financialAuthority({ role, status: "approved", permissions: { seeBilling: true } })).toBe(true);
    expect(financialAuthority({ role, status: "removed", permissions: { seeBilling: true } })).toBe(false);
  });
  it.each(["collab", "viewer", "trade_pro_collab", "facilities_collab"])("%s cannot change financial documents", kind => expect(isFinancialOperator(kind)).toBe(false));
  it("rejects decimal cents, negative, missing and excessive amounts", () => {
    for (const amountCents of [0, -1, 1.5, Infinity, null, "100", 100000001]) expect(() => validateDocumentInput({ description: "Work", amountCents })).toThrow();
    expect(validateDocumentInput({ description: " Work ", amountCents: 12599 })).toEqual({ description: "Work", amountCents: 12599 });
  });
  it("requires named-client approval and approved status before conversion", () => {
    expect(() => checkDocumentAction(pending, "approve", { manage: true, approve: false }, true)).toThrow();
    expect(() => checkDocumentAction(pending, "approve", { manage: false, approve: true }, true)).not.toThrow();
    expect(() => checkDocumentAction(pending, "convert", { manage: true, approve: false }, true)).toThrow();
  });
  it("locks approved, converted and paid records", () => {
    for (const doc of [{ ...pending, status: "approved" }, { ...pending, convertedInvoiceId: 2 }, { ...pending, kind: "invoice", status: "paid" }]) {
      expect(() => checkDocumentAction(doc, "edit", { manage: true, approve: true }, true)).toThrow();
    }
  });
  it("check collection requires an invoice and explicit confirmation", () => {
    expect(() => checkDocumentAction(pending, "check_collected", { manage: true, approve: false }, true)).toThrow();
    expect(() => checkDocumentAction({ ...pending, kind: "invoice" }, "check_collected", { manage: true, approve: false }, false)).toThrow();
    expect(() => checkDocumentAction({ ...pending, kind: "invoice" }, "check_collected", { manage: true, approve: false }, true)).not.toThrow();
    expect(() => checkDocumentAction({ ...pending, kind: "invoice" }, "apple_pay", { manage: true, approve: false }, true)).toThrow();
  });
});
