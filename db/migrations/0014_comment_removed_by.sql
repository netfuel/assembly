-- Who removed a comment, so the placeholder can say so. NULL on rows removed before this column existed (shown as a plain "Comment removed.").
ALTER TABLE comments ADD COLUMN removed_by TEXT CHECK (removed_by IN ('author', 'organizer', 'moderator'));
