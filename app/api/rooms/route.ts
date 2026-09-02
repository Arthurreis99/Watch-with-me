import { getD1 } from "@/db/raw";
import { cleanName, json, options, validCode } from "@/app/api/http";

const ROOM_TTL = 24 * 60 * 60 * 1000;

type RoomRow = {
  code: string;
  video_id: string | null;
  playing: number;
  position: number;
  version: number;
  created_at: number;
  updated_at: number;
};

function randomCode() {
  const data = new Uint16Array(1);
  crypto.getRandomValues(data);
  return String(data[0] % 10_000).padStart(4, "0");
}

async function cleanupExpiredRooms(now: number) {
  const db = getD1();
  const cutoff = now - ROOM_TTL;
  const deleteParticipants = db
    .prepare(
      "DELETE FROM participants WHERE room_code IN (SELECT code FROM rooms WHERE last_activity < ?)",
    )
    .bind(cutoff);
  const deleteRooms = db.prepare("DELETE FROM rooms WHERE last_activity < ?").bind(cutoff);
  await db.batch([deleteParticipants, deleteRooms]);
}

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

export async function OPTIONS() {
  return options();
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      action?: unknown;
      name?: unknown;
      code?: unknown;
    };
    const action = payload.action;
    const name = cleanName(payload.name);

    if (!name) {
      return json({ error: "Digite seu nome para continuar." }, { status: 400 });
    }

    if (action !== "create" && action !== "join") {
      return json({ error: "Ação inválida." }, { status: 400 });
    }

    const db = getD1();
    const now = Date.now();
    await cleanupExpiredRooms(now);

    let code = "";
    let room: RoomRow | null = null;

    if (action === "create") {
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const candidate = randomCode();
        const inserted = await db
          .prepare(
            `INSERT OR IGNORE INTO rooms
              (code, video_id, playing, position, version, created_at, updated_at, last_activity)
             VALUES (?, NULL, 0, 0, 0, ?, ?, ?)`,
          )
          .bind(candidate, now, now, now)
          .run();

        if (inserted.meta.changes === 1) {
          code = candidate;
          break;
        }
      }

      if (!code) {
        return json(
          { error: "Não foi possível reservar um código agora. Tente novamente." },
          { status: 503 },
        );
      }
    } else {
      if (!validCode(payload.code)) {
        return json({ error: "Informe os quatro números da sala." }, { status: 400 });
      }
      code = payload.code;
      room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<RoomRow>();
      if (!room) {
        return json({ error: "Essa sala não existe ou já expirou." }, { status: 404 });
      }
    }

    const participantId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO participants (id, room_code, name, joined_at, last_seen)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(participantId, code, name, now, now)
      .run();
    await db.prepare("UPDATE rooms SET last_activity = ? WHERE code = ?").bind(now, code).run();

    room ??= await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<RoomRow>();

    return json(
      {
        participantId,
        room: publicRoom(room as RoomRow),
        participants: [{ id: participantId, name }],
        serverTime: now,
      },
      { status: action === "create" ? 201 : 200 },
    );
  } catch (error) {
    console.error(error);
    return json({ error: "Não foi possível acessar a sala agora." }, { status: 500 });
  }
}
