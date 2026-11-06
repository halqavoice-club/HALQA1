-- HALQA Unit B-6: historical FULLTEXT index supplement.
-- Offline artifact only. Execution requires separately authorized Unit C-2.
-- Source: prisma/migrations/20260721_add_fulltext_indexes/migration.sql.
-- Apply after mysql-8.4-full-baseline-candidate.sql and before the CHECK supplement.

ALTER TABLE `posts`
  ADD FULLTEXT INDEX `posts_ft_body` (`body`);

ALTER TABLE `users`
  ADD FULLTEXT INDEX `users_ft_name` (`firstName`, `lastName`);

ALTER TABLE `communities`
  ADD FULLTEXT INDEX `communities_ft_name_desc` (`name`, `description`);

ALTER TABLE `voice_rooms`
  ADD FULLTEXT INDEX `voice_rooms_ft_title_topic` (`title`, `topic`, `description`);

ALTER TABLE `hashtags`
  ADD FULLTEXT INDEX `hashtags_ft_name` (`name`);
