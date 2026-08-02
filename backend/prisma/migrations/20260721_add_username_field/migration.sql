-- AddUsernameField
-- Additive migration: adds nullable username column to users table.
-- Existing users get NULL and are not affected.
-- The UNIQUE constraint prevents duplicate usernames once users set them.
-- Index added for fast @mention lookup queries.

ALTER TABLE `users`
  ADD COLUMN `username` VARCHAR(30) NULL AFTER `bio`;

CREATE UNIQUE INDEX `users_username_key`
  ON `users` (`username`);

CREATE INDEX `users_username_idx`
  ON `users` (`username`);
