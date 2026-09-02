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
const usePeerToPeerRooms = import.meta.env.VITE_P2P_ROOMS === "true";

function peerToPeerApi() {
  return import("@/lib/p2p-room-api");
}

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
  if (usePeerToPeerRooms) {
    return (await peerToPeerApi()).enterPeerRoom(action, name, code);
  }
  const result = await request<RoomSnapshot & { participantId: string }>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ action, name, code }),
  });
  return { ...result, messages: result.messages ?? [] };
}

export async function getRoom(code: string) {
  if (usePeerToPeerRooms) return (await peerToPeerApi()).getPeerRoom(code);
  const result = await request<RoomSnapshot>(`/api/rooms/${code}`);
  return { ...result, messages: result.messages ?? [] };
}

export async function heartbeat(session: RoomSession) {
  if (usePeerToPeerRooms) return (await peerToPeerApi()).peerHeartbeat(session);
  return request<{ ok: true; serverTime: number }>(`/api/rooms/${session.code}`, {
    method: "POST",
    body: JSON.stringify({ action: "heartbeat", participantId: session.participantId }),
  });
}

export async function leaveRoom(session: RoomSession) {
  if (usePeerToPeerRooms) return (await peerToPeerApi()).leavePeerRoom(session);
  return request<{ ok: true }>(`/api/rooms/${session.code}`, {
    method: "POST",
    body: JSON.stringify({ action: "leave", participantId: session.participantId }),
  });
}

export async function updateRoomState(
  session: RoomSession,
  state: Pick<Room, "videoId" | "playing" | "position">,
) {
  if (usePeerToPeerRooms) {
    return (await peerToPeerApi()).updatePeerRoomState(session, state);
  }
  return request<{ room: Room; serverTime: number }>(`/api/rooms/${session.code}`, {
    method: "POST",
    body: JSON.stringify({
      action: "state",
      participantId: session.participantId,
      ...state,
    }),
  });
}

export async function sendChatMessage(session: RoomSession, body: string) {
  if (usePeerToPeerRooms) {
    return (await peerToPeerApi()).sendPeerChatMessage(session, body);
  }
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
