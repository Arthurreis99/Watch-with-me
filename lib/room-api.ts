export type Room = {
  code: string;
  videoId: string | null;
  playing: boolean;
  position: number;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type Participant = { id: string; name: string };

export type ChatMessage = {
  id: string;
  participantId: string;
  senderName: string;
  body: string;
  createdAt: number;
};

export type RoomSnapshot = {
  room: Room;
  participants: Participant[];
  messages: ChatMessage[];
  serverTime: number;
};

export type RoomSession = {
  participantId: string;
  name: string;
  code: string;
};

const configuredBase = (import.meta.env.VITE_WATCH_API_BASE ?? "").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${configuredBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível completar a ação.");
  return data;
}

export async function enterRoom(action: "create" | "join", name: string, code?: string) {
  const result = await request<RoomSnapshot & { participantId: string }>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ action, name, code }),
  });
  return { ...result, messages: result.messages ?? [] };
}

export async function getRoom(code: string) {
  const result = await request<RoomSnapshot>(`/api/rooms/${code}`);
  return { ...result, messages: result.messages ?? [] };
}

export function heartbeat(session: RoomSession) {
  return request<{ ok: true; serverTime: number }>(`/api/rooms/${session.code}`, {
    method: "POST",
    body: JSON.stringify({ action: "heartbeat", participantId: session.participantId }),
  });
}

export function leaveRoom(session: RoomSession) {
  return request<{ ok: true }>(`/api/rooms/${session.code}`, {
    method: "POST",
    body: JSON.stringify({ action: "leave", participantId: session.participantId }),
  });
}

export function updateRoomState(
  session: RoomSession,
  state: Pick<Room, "videoId" | "playing" | "position">,
) {
  return request<{ room: Room; serverTime: number }>(`/api/rooms/${session.code}`, {
    method: "POST",
    body: JSON.stringify({
      action: "state",
      participantId: session.participantId,
      ...state,
    }),
  });
}

export function sendChatMessage(session: RoomSession, body: string) {
  return request<{ message: ChatMessage; serverTime: number }>(
    `/api/rooms/${session.code}`,
    {
      method: "POST",
      body: JSON.stringify({
        action: "message",
        participantId: session.participantId,
        body,
      }),
    },
  );
}
