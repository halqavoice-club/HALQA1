-- AddSocialNotificationTypes
-- Additive migration: extends NotificationType enum with social platform values.
-- Existing notifications with SYSTEM, ATTENDANCE etc. are completely unaffected.
-- MySQL ENUM extension is backward compatible — new values are added, none removed.

ALTER TABLE `notifications`
  MODIFY COLUMN `type` ENUM(
    'ATTENDANCE',
    'GRADE',
    'BEHAVIOR',
    'MESSAGE',
    'ANNOUNCEMENT',
    'REMINDER',
    'SYSTEM',
    'FOLLOW',
    'LIKE',
    'COMMENT',
    'COMMENT_REPLY',
    'FRIEND_REQUEST',
    'FRIEND_ACCEPTED',
    'COMMUNITY_JOIN',
    'COMMUNITY_INVITE',
    'GIFT_RECEIVED',
    'TIP_RECEIVED',
    'NEW_SUBSCRIBER',
    'MENTION',
    'VOICE_ROOM_LIVE',
    'LIVE_CLASS_START',
    'COINS_PURCHASED'
  ) NOT NULL;
