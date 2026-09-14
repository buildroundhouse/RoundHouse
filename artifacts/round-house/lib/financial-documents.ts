export type FinancialDocument = {
  id: number; kind: "estimate" | "invoice"; number: number; issuerName: string; propertyEntityId: number; propertyName: string;
  clientAccountId: number; clientName: string; description: string; amountCents: number; status: "pending" | "approved" | "paid";
  sourceEstimateId: number | null; convertedInvoiceId: number | null; approvedAt: string | null; paidAt: string | null; paymentMethod: string | null;
  createdAt: string; updatedAt: string; events: { action: string; actorId: string; at: string }[];
  canEdit: boolean; canApprove: boolean; canConvert: boolean; canCollectCheck: boolean;
};
export type FinancialContexts = { issuers: { id: number; name: string }[]; properties: { id: number; name: string; clients: { accountId: number; name: string }[] }[] };
export function amountInCents(text: string): number | null {
  const clean = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100000000 ? amount : null;
}
export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export const documentTitle = (d: Pick<FinancialDocument, "kind" | "number">) => `${d.kind === "estimate" ? "Estimate" : "Invoice"} #${d.number}`;
