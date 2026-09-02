import { getD1 } from "@/db/raw";
import {
  cleanMessage,
  json,
  options,
  safePosition,
  validCode,
  validParticipantId,
  validVideoId,
} from "@/app/api/http";

const ACTIVE_WINDOW = 45_000;

type RoomRow = {
  code: string;
  video_id: string | null;
  playing: number;
  position: number;
  version: number;
  created_at: number;
  updated_at: number;
};

type ParticipantRow = { id: string; name: string };

type MessageRow = {
  id: string;
  participant_id: string;
  sender_name: string;
  body: string;
  created_at: number;
};

function publicRoom(room: RoomRow) {
  return {
    code: room.code,
    videoId: room.video_id,
    playing: Boolean(room.playing),
    position: room.position,
    version: room.version,
    createdAt: room.created_at,
    updatedAt: room.updated_at,
  };
}

function publicMessage(message: MessageRow) {
  return {
    id: message.id,
    participantId: message.participant_id,
    senderName: message.sender_name,
    body: message.body,
    createdAt: message.created_at,
  };
}

async function findParticipant(code: string, participantId: string) {
  return getD1()
    .prepare("SELECT id FROM participants WHERE id = ? AND room_code = ?")
    .bind(participantId, code)
    .first<{ id: string }>();
}

export async function OPTIONS() {
  return options();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    if (!validCode(code)) return json({ error: "Código inválido." }, { status: 400 });

    const db = getD1();
    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<RoomRow>();
    if (!room) return json({ error: "Sala não encontrada." }, { status: 404 });

    const activeSince = Date.now() - ACTIVE_WINDOW;
    const participantRows = await db
      .prepare(
        `SELECT id, name FROM participants
         WHERE room_code = ? AND last_seen >= ?
         ORDER BY joined_at ASC`,
      )
      .bind(code, activeSince)
      .all<ParticipantRow>();

    const messageRows = await db
      .prepare(
        `SELECT id, participant_id, sender_name, body, created_at
         FROM (
           SELECT id, participant_id, sender_name, body, created_at
           FROM messages
           WHERE room_code = ?
           ORDER BY created_at DESC
           LIMIT 100
         )
         ORDER BY created_at ASC`,
      )
      .bind(code)
      .all<MessageRow>();

    return json({
      room: publicRoom(room),
      participants: participantRows.results,
      messages: messageRows.results.map(publicMessage),
      serverTime: Date.now(),
    });
  } catch (error) {
    console.error(error);
    return json({ error: "Não foi possível sincronizar a sala." }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    if (!validCode(code)) return json({ error: "Código inválido." }, { status: 400 });

    const payload = (await request.json()) as {
      action?: unknown;
      participantId?: unknown;
      videoId?: unknown;
      playing?: unknown;
      position?: unknown;
    };
    if (!validParticipantId(payload.participantId)) {
      return json({ error: "Participante inválido." }, { status: 401 });
    }

    const participant = await findParticipant(code, payload.participantId);
    if (!participant) {
      return json({ error: "Você não participa mais desta sala." }, { status: 401 });
    }

    const db = getD1();
    const now = Date.now();

    if (payload.action === "heartbeat") {
      const heartbeat = db
        .prepare("UPDATE participants SET last_seen = ? WHERE id = ? AND room_code = ?")
        .bind(now, payload.participantId, code);
      const touchRoom = db
        .prepare("UPDATE rooms SET last_activity = ? WHERE code = ?")
        .bind(now, code);
      await db.batch([heartbeat, touchRoom]);
      return json({ ok: true, serverTime: now });
    }

    if (payload.action === "leave") {
      await db
        .prepare("DELETE FROM participants WHERE id = ? AND room_code = ?")
        .bind(payload.participantId, code)
        .run();
      return json({ ok: true });
    }

    if (payload.action === "message") {
      const body = cleanMessage((payload as { body?: unknown }).body);
      if (!body) {
        return json({ error: "Escreva uma mensagem antes de enviar." }, { status: 400 });
      }

      const sender = await db
        .prepare("SELECT name FROM participants WHERE id = ? AND room_code = ?")
        .bind(payload.participantId, code)
        .first<{ name: string }>();
      if (!sender) {
        return json({ error: "Você não participa mais desta sala." }, { status: 401 });
      }

      const message: MessageRow = {
        id: crypto.randomUUID(),
        participant_id: payload.participantId,
        sender_name: sender.name,
        body,
        created_at: now,
      };
      const insertMessage = db
        .prepare(
          `INSERT INTO messages
             (id, room_code, participant_id, sender_name, body, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          message.id,
          code,
          message.participant_id,
          message.sender_name,
          message.body,
          message.created_at,
        );
      const touchRoom = db
        .prepare("UPDATE rooms SET last_activity = ? WHERE code = ?")
        .bind(now, code);
      await db.batch([insertMessage, touchRoom]);
      return json({ message: publicMessage(message), serverTime: now }, { status: 201 });
    }

    if (payload.action !== "state" || !validVideoId(payload.videoId)) {
      return json({ error: "Atualização inválida." }, { status: 400 });
    }

    const position = safePosition(payload.position);
    const playing = payload.playing === true ? 1 : 0;
    await db
      .prepare(
        `UPDATE rooms
         SET video_id = ?, playing = ?, position = ?, version = version + 1,
             updated_at = ?, last_activity = ?
         WHERE code = ?`,
      )
      .bind(payload.videoId, playing, position, now, now, code)
      .run();

    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<RoomRow>();
    if (!room) return json({ error: "Sala não encontrada." }, { status: 404 });

    return json({ room: publicRoom(room), serverTime: now });
  } catch (error) {
    console.error(error);
    return json({ error: "Não foi possível atualizar a sala." }, { status: 500 });
  }
}
