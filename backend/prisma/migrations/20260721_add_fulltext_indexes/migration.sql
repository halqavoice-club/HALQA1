-- AddFullTextIndexes
-- Additive migration: adds MySQL FULLTEXT indexes for performant search.
-- These replace LIKE '%term%' full-table scans with indexed MATCH AGAINST queries.
-- All indexes are additive — zero impact on existing data or queries.
--
-- Covered search surfaces:
--   posts.body                      → post/feed search
--   users.(firstName, lastName)     → people search (explore + social)
--   communities.(name, description) → community search
--   voice_rooms.(title, topic, description) → voice room search
--   hashtags.name                   → hashtag search

-- Posts body search
ALTER TABLE `posts`
  ADD FULLTEXT INDEX `posts_ft_body` (`body`);

-- Users name search (composite — searches both fields with one index)
ALTER TABLE `users`
  ADD FULLTEXT INDEX `users_ft_name` (`firstName`, `lastName`);

-- Communities name + description search
ALTER TABLE `communities`
  ADD FULLTEXT INDEX `communities_ft_name_desc` (`name`, `description`);

-- Voice rooms title + topic + description search
ALTER TABLE `voice_rooms`
  ADD FULLTEXT INDEX `voice_rooms_ft_title_topic` (`title`, `topic`, `description`);

-- Hashtags name search
ALTER TABLE `hashtags`
  ADD FULLTEXT INDEX `hashtags_ft_name` (`name`);
