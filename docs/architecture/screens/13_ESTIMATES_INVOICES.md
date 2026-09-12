# ROUNDHOUSE — ESTIMATES / INVOICES

## Purpose

**Estimates / Invoices is a dedicated destination page for creating and managing customer estimates and invoices.**

It should stay intentionally simple. Roundhouse is not trying to become full accounting software.

The core workflow is:

**Estimate → Approval → Invoice → Payment**

The page opens from the fourth bottom Command Center button and includes a **back arrow in the upper-left** to return to the Command Center.

---

## Main Page

The page shows the newest activity first.

Primary actions:

**Create Estimate**  
**Create Invoice**  
**Convert Estimate to Invoice**

Below those actions is a combined newest-first list of recent estimates and invoices.

Each row shows only the essentials:

- Estimate or Invoice number
- Client
- Property
- Amount
- Date
- Status

---

## Estimates

Roundhouse maintains a sequential estimate number for every estimate created.

An estimate is associated with:

**Client → Property → Estimate**

Estimate status remains deliberately simple:

**Pending**  
**Approved**

Once approved, that approval becomes part of the permanent record.

An approved estimate can be converted directly into an invoice.

---

## Estimate Locking

Once an estimate has been converted into an invoice, the estimate becomes **read-only**.

It cannot be edited afterward.

This preserves the document the customer actually approved and prevents the underlying agreement from being changed after invoicing.

If the work changes afterward, it should be handled through a new estimate, change, or other appropriate record rather than rewriting the original estimate.

---

## Invoices

Invoices can be created directly or generated from an approved estimate.

Invoice numbering uses a running sequential counter beginning with:

**Invoice #100**

Then:

**#101 → #102 → #103 → etc.**

An invoice created from an estimate retains that relationship.

Example:

**Invoice #108**  
Created from **Estimate #42**

Invoice status remains simple:

**Pending**  
**Paid**

---

## Payments

For MVP, a pending invoice should support three payment outcomes:

**Apple Pay**  
**Google Pay**  
**Check Collected**

Successful Apple Pay or Google Pay payment changes the invoice automatically from **Pending → Paid** and records the payment timestamp.

If **Check Collected** is selected, the worker confirms that the check was received. Roundhouse records **Check Collected**, records the date/time, and changes the invoice to **Paid**.

The goal is direct, simple payment from the invoice without requiring Roundhouse to become a full accounting platform.

---

## Client Portfolio

Every estimate and invoice automatically becomes part of the appropriate client’s **Portfolio** and remains associated with the relevant Property.

For example:

**Estimate #42 — Approved**  
**Invoice #108 — Pending**

Both remain visible as separate but related historical records.

The approved estimate remains preserved even after conversion so the Portfolio retains the original agreement alongside the resulting invoice.

---

## CAPTURE Integration

Estimates and invoices participate in the Property work-session workflow.

After the initial task checklist is established, CAPTURE may prompt the worker to create the appropriate **Estimate** while the live work session is active.

Near the end of the job, after the physical work is essentially complete but before final **Cleanup / Pack Out**, CAPTURE can prompt the worker to prepare the **Invoice**.

This keeps estimate preparation, invoicing, client review, payment discussion, and other legitimate business activity inside the work session rather than turning it into unpaid administrative time.

---

## QuickBooks Integration

Roundhouse should operate independently and should not require QuickBooks.

The page should contain a secondary inactive option:

**QuickBooks Integration — Coming Soon**

Future integration may allow Roundhouse estimates, invoices, customers, payments, and related accounting information to synchronize with QuickBooks.

Roundhouse remains the job-facing system. QuickBooks can later serve as the deeper accounting system for businesses that want tax reporting, payroll, W-2s, and other accounting functions beyond Roundhouse’s intended scope.

---

## Governing Rule

**Keep Estimates / Invoices simple.**

Roundhouse should make it easy to:

**Create → Approve → Convert → Invoice → Pay → Preserve**

without turning the page into a full accounting application.
