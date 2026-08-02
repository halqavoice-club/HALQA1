-- Add bio field to users table (already included in init migration, this is a no-op)
ALTER TABLE `users` MODIFY COLUMN `bio` TEXT NULL;
