ALTER TABLE posts ADD COLUMN meta_title TEXT;
ALTER TABLE posts ADD COLUMN meta_description TEXT;
ALTER TABLE posts ADD COLUMN og_title TEXT;
ALTER TABLE posts ADD COLUMN og_description TEXT;
ALTER TABLE posts ADD COLUMN og_image_url TEXT;
ALTER TABLE posts ADD COLUMN schema_type TEXT CHECK (schema_type IN ('BlogPosting', 'Service'));
