-- Reset repaired flag so all notifications get re-rendered with corrected templates
-- (Admin templates now use admin-facing language, customer templates use customer-facing)
UPDATE notifications
SET metadata = metadata - 'repaired'
WHERE metadata ? 'repaired';
