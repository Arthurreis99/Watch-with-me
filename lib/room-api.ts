export type Room = {
  code: string;
  videoId: string | null;
  playing: boolean;
  position: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  hostParticipantId?: string;
  controlMode?: "everyone" | "host";
  locked?: boolean;
  secureInvite?: boolean;
  inviteToken?: string;
};

export type Participant = { id: string; name: string; peerId?: string };

export type VideoQueueItem = {
  id: string;
  videoId: string;
  addedBy: string;
  addedByName: string;
  addedAt: number;
};

export type ChatReply = {
  messageId: string;
  senderName: string;
  body: string;
};

export type ChatMessage = {
  id: string;
  participantId: string;
  senderName: string;
  body: string;
  createdAt: number;
  replyTo?: ChatReply;
  delivery?: "pending" | "sent";
};

export type RoomSnapshot = {
  room: Room;
  participants: Participant[];
  messages: ChatMessage[];
  queue?: VideoQueueItem[];
  serverTime: number;
  connectionStatus?: "connected" | "reconnecting" | "offline";
};

export type RoomSession = {
  participantId: string;
  name: string;
  code: string;
  inviteToken?: string;
};

export type RoomSettings = Pick<Room, "controlMode" | "locked" | "secureInvite">;
export type QueueAction =
  | { type: "add"; videoId: string }
  | { type: "remove"; itemId: string }
  | { type: "move"; itemId: string; direction: -1 | 1 }
  | { type: "play"; itemId?: string };

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

export async function enterRoom(
  action: "create" | "join",
  name: string,
  code?: string,
  inviteToken?: string,
  restoring = false,
) {
  if (usePeerToPeerRooms) {
    return (await peerToPeerApi()).enterPeerRoom(
      action,
      name,
      code,
      inviteToken,
      restoring,
    );
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
  return sendChatReply(session, body);
}

export async function sendChatReply(
  session: RoomSession,
  body: string,
  replyTo?: ChatReply,
) {
  if (usePeerToPeerRooms) {
    return (await peerToPeerApi()).sendPeerChatMessage(session, body, replyTo);
  }
  return request<{ message: ChatMessage; serverTime: number }>(
    `/api/rooms/${session.code}`,
    {
      method: "POST",
      body: JSON.stringify({
        action: "message",
        participantId: session.participantId,
        body,
        replyTo,
      }),
    },
  );
}

export async function reconnectRoom(session: RoomSession) {
  if (usePeerToPeerRooms) {
    return (await peerToPeerApi()).retryPeerConnection(session);
  }
  await heartbeat(session);
  return getRoom(session.code);
}

export async function updateRoomSettings(
  session: RoomSession,
  settings: Partial<RoomSettings>,
) {
  if (usePeerToPeerRooms) {
    return (await peerToPeerApi()).updatePeerRoomSettings(session, settings);
  }
  throw new Error("As configurações avançadas estão disponíveis no GitHub Pages.");
}

export async function updateVideoQueue(session: RoomSession, action: QueueAction) {
  if (usePeerToPeerRooms) {
    return (await peerToPeerApi()).updatePeerVideoQueue(session, action);
  }
  throw new Error("A fila compartilhada está disponível no GitHub Pages.");
}
