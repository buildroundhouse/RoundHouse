export const FINANCIAL_DOCUMENT_STEPS: { name: string; sql: string }[] = [
  { name: "financial_document_counters", sql: `CREATE TABLE IF NOT EXISTS financial_document_counters (
    issuer_entity_id integer NOT NULL, kind text NOT NULL, last_number integer NOT NULL,
    PRIMARY KEY (issuer_entity_id, kind));` },
  { name: "financial_documents", sql: `CREATE TABLE IF NOT EXISTS financial_documents (
    id serial PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('estimate','invoice')), number integer NOT NULL,
    issuer_entity_id integer NOT NULL, issuer_account_id integer NOT NULL, issuer_name text NOT NULL,
    property_entity_id integer NOT NULL, property_name text NOT NULL,
    client_clerk_id text NOT NULL, client_account_id integer NOT NULL, client_name text NOT NULL, created_by text NOT NULL, request_key text,
    description text NOT NULL, amount_cents integer NOT NULL CHECK (amount_cents > 0),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid')),
    source_estimate_id integer, converted_invoice_id integer, approved_at timestamptz, paid_at timestamptz,
    payment_method text, events jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());` },
  { name: "financial_documents_number_unique", sql: `CREATE UNIQUE INDEX IF NOT EXISTS financial_documents_number_unique ON financial_documents (issuer_entity_id, kind, number);` },
  { name: "financial_documents_source_unique", sql: `CREATE UNIQUE INDEX IF NOT EXISTS financial_documents_source_unique ON financial_documents (source_estimate_id);` },
  { name: "financial_documents_request_unique", sql: `CREATE UNIQUE INDEX IF NOT EXISTS financial_documents_request_unique ON financial_documents (issuer_account_id, request_key);` },
  { name: "financial_documents_client", sql: `CREATE INDEX IF NOT EXISTS financial_documents_client ON financial_documents (client_clerk_id, client_account_id);` },
];
