import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable(
  "rooms",
  {
    code: text("code").primaryKey(),
    videoId: text("video_id"),
    playing: integer("playing", { mode: "boolean" }).notNull().default(false),
    position: real("position").notNull().default(0),
    version: integer("version").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastActivity: integer("last_activity").notNull(),
  },
  (table) => [index("idx_rooms_last_activity").on(table.lastActivity)],
);

export const participants = sqliteTable(
  "participants",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code")
      .notNull()
      .references(() => rooms.code, { onDelete: "cascade" }),
    name: text("name").notNull(),
    joinedAt: integer("joined_at").notNull(),
    lastSeen: integer("last_seen").notNull(),
  },
  (table) => [
    index("idx_participants_room_last_seen").on(table.roomCode, table.lastSeen),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code")
      .notNull()
      .references(() => rooms.code, { onDelete: "cascade" }),
    participantId: text("participant_id").notNull(),
    senderName: text("sender_name").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_messages_room_created_at").on(table.roomCode, table.createdAt)],
);
