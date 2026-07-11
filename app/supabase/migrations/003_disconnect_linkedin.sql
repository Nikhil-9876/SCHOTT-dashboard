-- Removes the stored LinkedIn connection for this single-account dashboard.
-- The function runs with definer privileges so the anon frontend can trigger it
-- without direct access to the sensitive token table.
CREATE OR REPLACE FUNCTION disconnect_linkedin()
RETURNS void AS $$
BEGIN
  DELETE FROM linkedin_tokens;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION disconnect_linkedin() TO anon;
