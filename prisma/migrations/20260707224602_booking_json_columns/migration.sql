-- Converts hand-serialized JSON-in-a-TEXT-column fields to native jsonb.
-- USING ...::jsonb parses each existing row's TEXT value as JSON - safe
-- here because every existing value was always written via JSON.stringify
-- (see the application code these columns backed before this migration),
-- so no row should contain non-JSON text. If any row's text ever fails to
-- parse as JSON, this migration will fail loudly rather than silently
-- truncating/corrupting data - that's the desired failure mode.
ALTER TABLE "Booking" ALTER COLUMN "offerSnapshot" TYPE JSONB USING "offerSnapshot"::jsonb;
ALTER TABLE "Booking" ALTER COLUMN "searchParams" TYPE JSONB USING "searchParams"::jsonb;
ALTER TABLE "Booking" ALTER COLUMN "passengerNames" TYPE JSONB USING "passengerNames"::jsonb;
ALTER TABLE "TrackedSearch" ALTER COLUMN "passengers" TYPE JSONB USING "passengers"::jsonb;
