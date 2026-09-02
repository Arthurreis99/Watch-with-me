CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`name` text NOT NULL,
	`joined_at` integer NOT NULL,
	`last_seen` integer NOT NULL,
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_participants_room_last_seen` ON `participants` (`room_code`,`last_seen`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`video_id` text,
	`playing` integer DEFAULT false NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_activity` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rooms_last_activity` ON `rooms` (`last_activity`);--> statement-breakpoint
PRAGMA optimize;
