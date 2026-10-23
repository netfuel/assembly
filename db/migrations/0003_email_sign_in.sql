-- Email sign-in: allow 'email' identities and record whether each identity's email is verified,
-- so a verified address can link Google, Apple, and email sign-ins to one account.
-- SQLite can't change a CHECK constraint in place, so the table is rebuilt.
CREATE TABLE identities_new (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple', 'email')),
  provider_subject TEXT NOT NULL,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (provider, provider_subject)
);

-- Existing Google and Apple emails came from the provider; local test accounts (dev-*) are not verified.
INSERT INTO identities_new (user_id, provider, provider_subject, email, email_verified, created_at)
SELECT user_id, provider, provider_subject, email,
       CASE WHEN provider_subject LIKE 'dev-%' OR email IS NULL THEN 0 ELSE 1 END,
       created_at
FROM identities;

DROP TABLE identities;
ALTER TABLE identities_new RENAME TO identities;
CREATE INDEX identities_user ON identities(user_id);
CREATE INDEX identities_email ON identities(lower(email));
