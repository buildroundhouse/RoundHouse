/** Financial permission is separate from general work or management permission. */
export function financialAuthority(member: { role: string; status: string; archivedAt?: unknown; permissions?: { seeBilling?: boolean } } | null | undefined) {
  if (!member || member.status !== "approved" || member.archivedAt || ["viewer", "collaborator"].includes(member.role)) return false;
  if (member.permissions?.seeBilling === false) return false;
  return ["owner", "admin"].includes(member.role) || member.permissions?.seeBilling === true;
}
export function isFinancialOperator(kind: string | undefined) {
  return !!kind && !["viewer", "collab", "trade_pro_collab", "facilities_collab"].includes(kind);
}
export function validateDocumentInput(body: unknown) {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.description !== "string" || !b.description.trim() || b.description.length > 10000
    || !Number.isSafeInteger(b.amountCents) || Number(b.amountCents) < 1 || Number(b.amountCents) > 100000000) {
    throw new FinancialError(400, "Enter the work description and an amount from $0.01 to $1,000,000.");
  }
  return { description: b.description.trim(), amountCents: Number(b.amountCents) };
}
export class FinancialError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function checkDocumentAction(doc: { kind: string; status: string; convertedInvoiceId: number | null }, action: string, permission: { manage: boolean; approve: boolean }, confirmed: boolean) {
  if (action === "approve") {
    if (!permission.approve) throw new FinancialError(403, "Only the named client with financial authority can approve this estimate.");
    if (doc.kind !== "estimate" || doc.status !== "pending") throw new FinancialError(409, "This estimate is no longer pending.");
  } else {
    if (!permission.manage) throw new FinancialError(403, "Financial permission is required for this Business and Property.");
    if (action === "edit" && (doc.status !== "pending" || doc.convertedInvoiceId)) throw new FinancialError(409, "Approved, converted and paid records are read-only.");
    if (action === "convert" && (doc.kind !== "estimate" || doc.status !== "approved")) throw new FinancialError(409, "Approve the estimate before converting it.");
    if (action === "check_collected" && (doc.kind !== "invoice" || doc.status !== "pending" || !confirmed)) throw new FinancialError(400, "Confirm that the check was received for this pending invoice.");
    if (!["edit", "convert", "check_collected"].includes(action)) throw new FinancialError(400, "Unknown financial action.");
  }
}
