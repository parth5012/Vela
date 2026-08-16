ALTER TABLE `messages` ADD `pending` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `server_id` text;--> statement-breakpoint
CREATE VIRTUAL TABLE `messages_fts` USING fts5(
	content,
	content='messages',
	content_rowid='rowid',
	tokenize = 'porter unicode61'
);--> statement-breakpoint
CREATE TRIGGER `messages_fts_ai` AFTER INSERT ON `messages` BEGIN
	INSERT INTO `messages_fts`(rowid, content) VALUES (new.rowid, new.content);
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_ad` AFTER DELETE ON `messages` BEGIN
	INSERT INTO `messages_fts`(`messages_fts`, rowid, content) VALUES ('delete', old.rowid, old.content);
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_au` AFTER UPDATE OF `content` ON `messages` BEGIN
	INSERT INTO `messages_fts`(`messages_fts`, rowid, content) VALUES ('delete', old.rowid, old.content);
	INSERT INTO `messages_fts`(rowid, content) VALUES (new.rowid, new.content);
END;