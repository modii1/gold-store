-- Reset repaired flag so all notifications get re-rendered with corrected templates.
-- Admin templates use admin-facing language; customer templates use customer-facing language.
UPDATE notifications
SET metadata = metadata - 'repaired'
WHERE metadata ? 'repaired';
