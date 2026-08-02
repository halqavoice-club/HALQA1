-- Add MODERATOR to VoiceParticipantRole enum
-- MySQL requires modifying the ENUM column directly

ALTER TABLE `voice_participants`
  MODIFY COLUMN `role`
    ENUM('HOST','MODERATOR','SPEAKER','AUDIENCE')
    NOT NULL DEFAULT 'AUDIENCE';
