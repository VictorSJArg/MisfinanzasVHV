ALTER TABLE "Category"
ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

WITH ordered AS (
    SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY type ORDER BY name ASC) AS rn
    FROM "Category"
    WHERE "sortOrder" = 0
)
UPDATE "Category" c
SET "sortOrder" = ordered.rn
FROM ordered
WHERE c.id = ordered.id;
