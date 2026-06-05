-- Ximendes passa a operar 100% no calendario interno.
UPDATE "clinics"
SET "calendar_mode" = 'internal'
WHERE "slug" = 'ximendes' OR "name" = 'Ximendes Odontologia';
