import type { DataConnection, Peer } from "peerjs";

import type {
  ChatMessage,
  Room,
  RoomSession,
  RoomSnapshot,
} from "@/lib/room-api";

type RoomState = Pick<Room, "videoId" | "playing" | "position">;

type WireMessage =
  | { type: "join"; participantId: string; name: string }
  | { type: "snapshot"; snapshot: RoomSnapshot }
  | { type: "state"; participantId: string; state: RoomState }
  | { type: "message"; participantId: string; message: ChatMessage }
  | { type: "leave"; participantId: string }
  | { type: "heartbeat"; participantId: string };

type PeerRoomContext = {
  role: "host" | "guest";
  peer: Peer;
  session: RoomSession;
  snapshot: RoomSnapshot;
  connected: boolean;
  hostConnection?: DataConnection;
  guestConnections: Map<string, DataConnection>;
};

const PEER_PREFIX = "watch-with-me-room-";
const CONNECTION_TIMEOUT = 10_000;
let currentRoom: PeerRoomContext | null = null;

function cloneSnapshot(snapshot: RoomSnapshot): RoomSnapshot {
  return structuredClone(snapshot);
}

function cleanName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 24);
}

function cleanMessage(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 360);
}

function randomCode() {
  const data = new Uint16Array(1);
  crypto.getRandomValues(data);
  return String(data[0] % 10_000).padStart(4, "0");
}

function peerIdFor(code: string) {
  return `${PEER_PREFIX}${code}`;
}

function normalizeIncomingSnapshot(snapshot: RoomSnapshot): RoomSnapshot {
  const receivedAt = Date.now();
  const stateAge = Math.max(0, snapshot.serverTime - snapshot.room.updatedAt);
  return {
    ...cloneSnapshot(snapshot),
    room: { ...snapshot.room, updatedAt: receivedAt - stateAge },
    serverTime: receivedAt,
  };
}

function openPeer(requestedId?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    void import("peerjs").then(({ Peer: PeerClient }) => {
      const peer = requestedId
        ? new PeerClient(requestedId, { debug: 1 })
        : new PeerClient({ debug: 1 });
      const timer = window.setTimeout(() => {
        peer.destroy();
        reject(new Error("A conexão demorou demais. Tente novamente."));
      }, CONNECTION_TIMEOUT);

      peer.once("open", () => {
        window.clearTimeout(timer);
        resolve(peer);
      });
      peer.once("error", (error) => {
        window.clearTimeout(timer);
        peer.destroy();
        reject(error);
      });
    }).catch(() => reject(new Error("Não foi possível iniciar a conexão da sala.")));
  });
}

function publicSnapshot(context: PeerRoomContext) {
  return cloneSnapshot({ ...context.snapshot, serverTime: Date.now() });
}

function broadcastSnapshot(context: PeerRoomContext) {
  const message: WireMessage = { type: "snapshot", snapshot: publicSnapshot(context) };
  for (const connection of context.guestConnections.values()) {
    if (connection.open) connection.send(message);
  }
}

function applyRoomState(context: PeerRoomContext, state: RoomState) {
  const now = Date.now();
  context.snapshot = {
    ...context.snapshot,
    room: {
      ...context.snapshot.room,
      ...state,
      version: context.snapshot.room.version + 1,
      updatedAt: now,
    },
    serverTime: now,
  };
}

function removeGuest(context: PeerRoomContext, participantId: string) {
  if (!context.guestConnections.delete(participantId)) return;
  context.snapshot = {
    ...context.snapshot,
    participants: context.snapshot.participants.filter(
      (participant) => participant.id !== participantId,
    ),
    serverTime: Date.now(),
  };
  broadcastSnapshot(context);
}

function handleHostConnection(context: PeerRoomContext, connection: DataConnection) {
  let joinedParticipantId: string | null = null;

  connection.on("data", (raw) => {
    const message = raw as WireMessage;
    if (!message || typeof message !== "object") return;

    if (message.type === "join" && !joinedParticipantId) {
      const name = cleanName(message.name);
      if (!name || !/^[0-9a-f-]{36}$/i.test(message.participantId)) {
        connection.close();
        return;
      }
      joinedParticipantId = message.participantId;
      context.guestConnections.set(joinedParticipantId, connection);
      context.snapshot = {
        ...context.snapshot,
        participants: [
          ...context.snapshot.participants.filter(
            (participant) => participant.id !== joinedParticipantId,
          ),
          { id: joinedParticipantId, name },
        ],
        serverTime: Date.now(),
      };
      broadcastSnapshot(context);
      return;
    }

    if (
      message.type === "snapshot" ||
      !joinedParticipantId ||
      message.participantId !== joinedParticipantId
    ) return;

    if (message.type === "state") {
      applyRoomState(context, message.state);
      broadcastSnapshot(context);
      return;
    }

    if (message.type === "message") {
      const body = cleanMessage(message.message.body);
      const participant = context.snapshot.participants.find(
        (item) => item.id === joinedParticipantId,
      );
      if (!body || !participant) return;
      const chatMessage: ChatMessage = {
        id: message.message.id,
        participantId: joinedParticipantId,
        senderName: participant.name,
        body,
        createdAt: Date.now(),
      };
      context.snapshot = {
        ...context.snapshot,
        messages: [...context.snapshot.messages, chatMessage].slice(-100),
        serverTime: Date.now(),
      };
      broadcastSnapshot(context);
      return;
    }

    if (message.type === "leave") connection.close();
  });

  connection.on("close", () => {
    if (joinedParticipantId) removeGuest(context, joinedParticipantId);
  });
}

async function createPeerRoom(name: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomCode();
    try {
      const peer = await openPeer(peerIdFor(code));
      const now = Date.now();
      const session: RoomSession = {
        participantId: crypto.randomUUID(),
        name,
        code,
      };
      const context: PeerRoomContext = {
        role: "host",
        peer,
        session,
        connected: true,
        guestConnections: new Map(),
        snapshot: {
          room: {
            code,
            videoId: null,
            playing: false,
            position: 0,
            version: 0,
            createdAt: now,
            updatedAt: now,
          },
          participants: [{ id: session.participantId, name }],
          messages: [],
          serverTime: now,
        },
      };
      peer.on("connection", (connection) => handleHostConnection(context, connection));
      peer.on("error", () => {
        context.connected = false;
      });
      currentRoom = context;
      return { ...publicSnapshot(context), participantId: session.participantId };
    } catch (error) {
      const type = (error as { type?: string }).type;
      if (type !== "unavailable-id") throw error;
    }
  }
  throw new Error("Não foi possível reservar um código agora. Tente novamente.");
}

async function joinPeerRoom(name: string, code: string) {
  if (!/^\d{4}$/.test(code)) throw new Error("Informe os quatro números da sala.");

  const peer = await openPeer();
  const participantId = crypto.randomUUID();
  const session: RoomSession = { participantId, name, code };

  return new Promise<RoomSnapshot & { participantId: string }>((resolve, reject) => {
    const connection = peer.connect(peerIdFor(code), {
      reliable: true,
      serialization: "json",
    });
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      connection.close();
      peer.destroy();
      reject(new Error("Sala não encontrada. Confirme o código e tente novamente."));
    }, CONNECTION_TIMEOUT);

    connection.on("open", () => {
      const message: WireMessage = { type: "join", participantId, name };
      connection.send(message);
    });

    connection.on("data", (raw) => {
      const message = raw as WireMessage;
      if (message?.type !== "snapshot") return;
      const snapshot = normalizeIncomingSnapshot(message.snapshot);

      if (!currentRoom) {
        const context: PeerRoomContext = {
          role: "guest",
          peer,
          session,
          snapshot,
          connected: true,
          hostConnection: connection,
          guestConnections: new Map(),
        };
        currentRoom = context;
        peer.on("error", () => {
          context.connected = false;
        });
        connection.on("close", () => {
          context.connected = false;
        });
      } else if (currentRoom.role === "guest") {
        currentRoom.snapshot = snapshot;
      }

      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve({ ...cloneSnapshot(snapshot), participantId });
      }
    });

    connection.on("error", () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      peer.destroy();
      reject(new Error("Não foi possível entrar nessa sala."));
    });
  });
}

function requireRoom(session: RoomSession) {
  if (
    !currentRoom ||
    !currentRoom.connected ||
    currentRoom.session.code !== session.code ||
    currentRoom.session.participantId !== session.participantId
  ) {
    throw new Error("A conexão com a sala foi encerrada.");
  }
  return currentRoom;
}

export async function enterPeerRoom(
  action: "create" | "join",
  rawName: string,
  code?: string,
) {
  if (currentRoom) {
    currentRoom.peer.destroy();
    currentRoom = null;
  }
  const name = cleanName(rawName);
  if (!name) throw new Error("Digite seu nome para continuar.");
  return action === "create"
    ? createPeerRoom(name)
    : joinPeerRoom(name, code ?? "");
}

export async function getPeerRoom(code: string) {
  if (!currentRoom || !currentRoom.connected || currentRoom.session.code !== code) {
    throw new Error("O anfitrião encerrou a sala.");
  }
  return publicSnapshot(currentRoom);
}

export async function peerHeartbeat(session: RoomSession) {
  const context = requireRoom(session);
  if (context.role === "guest" && context.hostConnection?.open) {
    const message: WireMessage = {
      type: "heartbeat",
      participantId: session.participantId,
    };
    context.hostConnection.send(message);
  }
  return { ok: true as const, serverTime: Date.now() };
}

export async function leavePeerRoom(session: RoomSession) {
  const context = requireRoom(session);
  if (context.role === "guest" && context.hostConnection?.open) {
    const message: WireMessage = { type: "leave", participantId: session.participantId };
    context.hostConnection.send(message);
    context.hostConnection.close();
  }
  context.connected = false;
  context.peer.destroy();
  currentRoom = null;
  return { ok: true as const };
}

export async function updatePeerRoomState(session: RoomSession, state: RoomState) {
  const context = requireRoom(session);
  applyRoomState(context, state);

  if (context.role === "host") {
    broadcastSnapshot(context);
  } else if (context.hostConnection?.open) {
    const message: WireMessage = {
      type: "state",
      participantId: session.participantId,
      state,
    };
    context.hostConnection.send(message);
  }

  return { room: { ...context.snapshot.room }, serverTime: Date.now() };
}

export async function sendPeerChatMessage(session: RoomSession, rawBody: string) {
  const context = requireRoom(session);
  const body = cleanMessage(rawBody);
  if (!body) throw new Error("Escreva uma mensagem antes de enviar.");

  const message: ChatMessage = {
    id: crypto.randomUUID(),
    participantId: session.participantId,
    senderName: session.name,
    body,
    createdAt: Date.now(),
  };

  if (context.role === "host") {
    context.snapshot = {
      ...context.snapshot,
      messages: [...context.snapshot.messages, message].slice(-100),
      serverTime: Date.now(),
    };
    broadcastSnapshot(context);
  } else if (context.hostConnection?.open) {
    const wireMessage: WireMessage = {
      type: "message",
      participantId: session.participantId,
      message,
    };
    context.hostConnection.send(wireMessage);
  }

  return { message, serverTime: Date.now() };
}
