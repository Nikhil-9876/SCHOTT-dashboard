-- Migration to add linkedin_tokens table

CREATE TABLE linkedin_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ,
    refresh_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- We only need one active token usually, but keeping it flexible.
-- To ensure only one row, we can just upsert a specific ID or have a check constraint, 
-- but for simplicity we will just query the latest one.

-- Enable RLS (only service role can read/write by default, or you can explicitly restrict)
ALTER TABLE linkedin_tokens ENABLE ROW LEVEL SECURITY;

-- Allow anon to read? No, this is sensitive.
-- We want Edge Functions (service role) to read/write it.
-- We want authenticated users (if we had them) to read/write.
-- In this app, there is no auth, so to allow the frontend to check if a token exists
-- without exposing the token itself, we should create an RPC or a view, but maybe
-- we can just expose a boolean column or let the edge function handle the check.
-- For now, let's create a policy that allows anon to SELECT but not the tokens.
-- Actually, let's not expose the table to anon at all.
-- Edge Functions use the service role key and bypass RLS.

-- To allow the frontend to check if connected without exposing tokens:
CREATE OR REPLACE FUNCTION has_linkedin_connection()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM linkedin_tokens WHERE access_token IS NOT NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
