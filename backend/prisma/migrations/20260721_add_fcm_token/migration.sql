-- AddFcmToken
-- Additive migration: adds nullable fcmToken column to users table.
-- Used for Firebase Cloud Messaging push notifications on mobile.
-- Existing users get NULL — they receive push only after the mobile app
-- registers the token (on login or permission grant).

ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `fcmToken` VARCHAR(512) NULL AFTER `email`;
