# Estimates / Invoices implementation

Implements the dedicated workspace in main's
`docs/architecture/screens/13_ESTIMATES_INVOICES.md` on the hosted branch.

## Implemented

- Persistent Back to Command Center on the main page, document detail and editor;
  unsaved forms ask before discarding. Account changes reset the workspace.
- Create Estimate, Create Invoice, and Convert Estimate to Invoice, according to
  current financial authority. A combined newest-activity-first list shows document
  number, client, Property, amount, date and Pending / Approved / Paid status.
- Real persisted documents with Business, client and Property identity snapshots,
  description, USD amount stored in integer cents, actor IDs and timestamped events.
- Sequential numbering per issuing Business: estimates start at 1, invoices at 100.
  Transactional counters and unique constraints prevent collisions. Request keys
  make repeat create submissions idempotent. A locked estimate and unique source
  constraint prevent double conversion, including concurrent requests.
- Only the named client, acting with current Property financial authority, can
  approve an estimate. Approval is permanent. Approved and converted estimates
  are read-only; later work changes require a new document.
- Conversion copies the approved amount and scope into a separate linked invoice;
  both records remain in the client's Portfolio. Client Portfolio is reachable
  from document detail and the person’s profile; its results retain all server
  financial-access checks.
- Check Collected requires explicit confirmation by an authorized issuer. It records
  the actor and timestamp and marks the invoice Paid. This is a record of receipt,
  not confirmation of bank clearance.
- QuickBooks Integration — Coming Soon is inactive. Receipts keep their separate
  Command Center overlay instead of opening the new invoicing workflow.

## Account permissions

Business ownership/admin authority or an explicit financial grant is required to
issue documents. Manager or teammate status alone grants no financial permission.
Creation also requires current contribution permission at the selected Property.
Clients may review and approve documents addressed to their selected account when
financially authorized. Viewers cannot create, approve, edit, convert or record
payment; explicitly authorized financial visibility and legitimate personal
historical records remain read-only. Removed participation ends future authority
without deleting previously authored documents.

## Remaining integrations

Apple Pay and Google Pay are visibly disabled until customer-payment processing
and merchant settlement are configured. Subscription billing is not reused to
collect a contractor’s customer payments. No wallet action can mark a document
Paid. A future wallet integration must verify provider completion and webhook
idempotency before recording payment.

The current CAPTURE implementation has no live work-session/checklist lifecycle.
Automatic estimate/invoice prompts at those work-session milestones therefore
remain a separate integration. This change does not pretend those prompts exist.

## Validation and deployment

32 focused tests pass, including the actual API and deployment DDL against an
isolated PGlite PostgreSQL database, repeatable migration, concurrent conversion,
permission boundaries, client approval, immutable history, check confirmation,
numbering, role-specific page rendering, navigation and exact amount parsing.
No external database is used by the tests. PGlite is a root development dependency
so workspace packages share one Drizzle peer dependency graph.

Production web export and API build pass. Changed files have no TypeScript errors;
pre-existing errors elsewhere still block the full app/API type checks. A signed-in
handset walkthrough was not available. Deployment adds only the financial document
and counter tables and indexes through the existing additive migration runner.
