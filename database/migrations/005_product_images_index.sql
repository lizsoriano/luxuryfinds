-- Luxury Finds - migration 005: missing index on product_images.product_id
--
-- RUN THIS MANUALLY in the Supabase SQL editor, after 000-004.
--
-- WHY
-- product_variants has ix_variants_product (product_variants.product_id) from
-- the original schema.sql, but product_images never got the equivalent index.
-- Every admin page that lists products embeds product_images(storage_key,
-- sort_order) to show a thumbnail, and PostgREST resolves that as a query
-- filtered by product_id per page of results. With no index and 15,000+ rows
-- in product_images, that embed alone measured ~3.9s for a 20-row page versus
-- ~400ms for the equivalent product_variants embed (which IS indexed) -
-- reproduced directly against the production database. This is the fix.
--
-- Plain (non-concurrent) CREATE INDEX briefly locks writes on product_images.
-- At ~15,700 rows this completes in well under a second - safe to run as-is.

BEGIN;

SET search_path TO luxury_finds, public;

CREATE INDEX IF NOT EXISTS ix_product_images_product
  ON product_images (product_id);

COMMIT;
