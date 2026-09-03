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
  pendingMessages: ChatMessage[];
  pendingState?: RoomState;
  reconnectTimer?: number;
  reconnecting: boolean;
  cleanupLifecycle?: () => void;
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

      const handleOpen = () => {
        window.clearTimeout(timer);
        peer.off("error", handleError);
        resolve(peer);
      };
      const handleError = (error: Error) => {
        window.clearTimeout(timer);
        peer.off("open", handleOpen);
        peer.destroy();
        reject(error);
      };

      peer.once("open", handleOpen);
      peer.once("error", handleError);
    }).catch(() => reject(new Error("Não foi possível iniciar a conexão da sala.")));
  });
}

function publicSnapshot(context: PeerRoomContext) {
  return cloneSnapshot({ ...context.snapshot, serverTime: Date.now() });
}

export function mergeMessages(primary: ChatMessage[], pending: ChatMessage[]) {
  const messages = [...primary];
  const ids = new Set(messages.map((message) => message.id));
  for (const message of pending) {
    if (!ids.has(message.id)) {
      messages.push(message);
      ids.add(message.id);
    }
  }
  return messages.sort((a, b) => a.createdAt - b.createdAt).slice(-100);
}

function reconnectSignaling(peer: Peer) {
  if (!peer.disconnected) return Promise.resolve();
  if (peer.destroyed) return Promise.reject(new Error("A conexão foi encerrada."));

  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      peer.off("open", handleOpen);
      peer.off("error", handleError);
      reject(new Error("Não foi possível restaurar a conexão."));
    }, CONNECTION_TIMEOUT);
    const handleOpen = () => {
      window.clearTimeout(timer);
      peer.off("error", handleError);
      resolve();
    };
    const handleError = () => {
      window.clearTimeout(timer);
      peer.off("open", handleOpen);
      reject(new Error("Não foi possível restaurar a conexão."));
    };

    peer.once("open", handleOpen);
    peer.once("error", handleError);
    try {
      peer.reconnect();
    } catch {
      window.clearTimeout(timer);
      peer.off("open", handleOpen);
      peer.off("error", handleError);
      reject(new Error("Não foi possível restaurar a conexão."));
    }
  });
}

function scheduleRecovery(context: PeerRoomContext, delay = 750) {
  if (!context.connected || context.reconnectTimer !== undefined) return;
  context.reconnectTimer = window.setTimeout(() => {
    context.reconnectTimer = undefined;
    void recoverConnection(context);
  }, delay);
}

async function recoverConnection(context: PeerRoomContext) {
  if (!context.connected || context.reconnecting || context.peer.destroyed) return;
  context.reconnecting = true;
  try {
    await reconnectSignaling(context.peer);
    if (
      context.role === "guest" &&
      (!context.hostConnection || !context.hostConnection.open)
    ) {
      await connectGuestConnection(context);
    }
  } catch {
    scheduleRecovery(context, 2_000);
  } finally {
    context.reconnecting = false;
  }
}

function registerLifecycleRecovery(context: PeerRoomContext) {
  const recover = () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      scheduleRecovery(context, 0);
    }
  };
  document.addEventListener("visibilitychange", recover);
  window.addEventListener("focus", recover);
  window.addEventListener("online", recover);
  window.addEventListener("pageshow", recover);
  context.cleanupLifecycle = () => {
    document.removeEventListener("visibilitychange", recover);
    window.removeEventListener("focus", recover);
    window.removeEventListener("online", recover);
    window.removeEventListener("pageshow", recover);
  };
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

function removeGuest(
  context: PeerRoomContext,
  participantId: string,
  connection: DataConnection,
) {
  if (context.guestConnections.get(participantId) !== connection) return;
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
      if (!context.snapshot.messages.some((item) => item.id === chatMessage.id)) {
        context.snapshot = {
          ...context.snapshot,
          messages: [...context.snapshot.messages, chatMessage].slice(-100),
          serverTime: Date.now(),
        };
      }
      broadcastSnapshot(context);
      return;
    }

    if (message.type === "heartbeat") {
      connection.send({ type: "snapshot", snapshot: publicSnapshot(context) });
      return;
    }

    if (message.type === "leave") connection.close();
  });

  connection.on("close", () => {
    if (joinedParticipantId) removeGuest(context, joinedParticipantId, connection);
  });
}

async function createPeerRoom(name: string, preferredCode?: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const restoring = Boolean(preferredCode && /^\d{4}$/.test(preferredCode));
    const code = restoring ? preferredCode as string : randomCode();
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
        pendingMessages: [],
        reconnecting: false,
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
      peer.on("disconnected", () => scheduleRecovery(context));
      peer.on("error", () => scheduleRecovery(context));
      registerLifecycleRecovery(context);
      currentRoom = context;
      return { ...publicSnapshot(context), participantId: session.participantId };
    } catch (error) {
      const type = (error as { type?: string }).type;
      if (type !== "unavailable-id") throw error;
      if (restoring) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
    }
  }
  throw new Error("Não foi possível reservar um código agora. Tente novamente.");
}

function connectGuestConnection(context: PeerRoomContext): Promise<RoomSnapshot> {
  return new Promise((resolve, reject) => {
    const connection = context.peer.connect(peerIdFor(context.session.code), {
      reliable: true,
      serialization: "json",
    });
    context.hostConnection = connection;
    let receivedSnapshot = false;
    const timer = window.setTimeout(() => {
      if (receivedSnapshot) return;
      connection.close();
      reject(new Error("Sala não encontrada. Confirme o código e tente novamente."));
    }, CONNECTION_TIMEOUT);

    const loseConnection = () => {
      if (context.hostConnection === connection) context.hostConnection = undefined;
      if (!receivedSnapshot) {
        window.clearTimeout(timer);
        reject(new Error("Não foi possível entrar nessa sala."));
      }
      scheduleRecovery(context);
    };

    connection.on("open", () => {
      const message: WireMessage = {
        type: "join",
        participantId: context.session.participantId,
        name: context.session.name,
      };
      connection.send(message);
    });

    connection.on("data", (raw) => {
      const message = raw as WireMessage;
      if (message?.type !== "snapshot") return;

      const normalized = normalizeIncomingSnapshot(message.snapshot);
      const confirmedMessageIds = new Set(
        normalized.messages.map((chatMessage) => chatMessage.id),
      );
      context.pendingMessages = context.pendingMessages.filter(
        (chatMessage) => !confirmedMessageIds.has(chatMessage.id),
      );
      normalized.messages = mergeMessages(
        normalized.messages,
        context.pendingMessages,
      );
      context.snapshot = normalized;

      if (!receivedSnapshot) {
        receivedSnapshot = true;
        window.clearTimeout(timer);
        const pendingState = context.pendingState;
        context.pendingState = undefined;
        if (pendingState) {
          applyRoomState(context, pendingState);
          connection.send({
            type: "state",
            participantId: context.session.participantId,
            state: pendingState,
          });
        }
        for (const chatMessage of context.pendingMessages) {
          connection.send({
            type: "message",
            participantId: context.session.participantId,
            message: chatMessage,
          });
        }
        resolve(publicSnapshot(context));
      }
    });

    connection.on("close", loseConnection);
    connection.on("error", loseConnection);
  });
}

async function joinPeerRoom(name: string, code: string) {
  if (!/^\d{4}$/.test(code)) throw new Error("Informe os quatro números da sala.");

  const peer = await openPeer();
  const participantId = crypto.randomUUID();
  const session: RoomSession = { participantId, name, code };
  const now = Date.now();
  const context: PeerRoomContext = {
    role: "guest",
    peer,
    session,
    connected: true,
    guestConnections: new Map(),
    pendingMessages: [],
    reconnecting: false,
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
      participants: [{ id: participantId, name }],
      messages: [],
      serverTime: now,
    },
  };
  currentRoom = context;
  peer.on("disconnected", () => scheduleRecovery(context));
  peer.on("error", () => scheduleRecovery(context));
  registerLifecycleRecovery(context);

  try {
    const snapshot = await connectGuestConnection(context);
    return { ...snapshot, participantId };
  } catch (error) {
    context.connected = false;
    context.cleanupLifecycle?.();
    peer.destroy();
    currentRoom = null;
    throw error;
  }
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
    currentRoom.connected = false;
    if (currentRoom.reconnectTimer !== undefined) {
      window.clearTimeout(currentRoom.reconnectTimer);
    }
    currentRoom.cleanupLifecycle?.();
    currentRoom.peer.destroy();
    currentRoom = null;
  }
  const name = cleanName(rawName);
  if (!name) throw new Error("Digite seu nome para continuar.");
  return action === "create"
    ? createPeerRoom(name, code)
    : joinPeerRoom(name, code ?? "");
}

export async function getPeerRoom(code: string) {
  if (!currentRoom || !currentRoom.connected || currentRoom.session.code !== code) {
    throw new Error("O anfitrião encerrou a sala.");
  }
  if (
    currentRoom.role === "guest" &&
    (!currentRoom.hostConnection || !currentRoom.hostConnection.open)
  ) {
    scheduleRecovery(currentRoom, 0);
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
    try {
      context.hostConnection.send(message);
    } catch {
      scheduleRecovery(context, 0);
    }
  } else if (context.role === "guest") {
    scheduleRecovery(context, 0);
  }
  return { ok: true as const, serverTime: Date.now() };
}

export async function leavePeerRoom(session: RoomSession) {
  const context = requireRoom(session);
  context.connected = false;
  if (context.reconnectTimer !== undefined) window.clearTimeout(context.reconnectTimer);
  context.cleanupLifecycle?.();
  if (context.role === "guest" && context.hostConnection?.open) {
    const message: WireMessage = { type: "leave", participantId: session.participantId };
    context.hostConnection.send(message);
    context.hostConnection.close();
  }
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
    try {
      context.hostConnection.send(message);
      context.pendingState = undefined;
    } catch {
      context.pendingState = state;
      scheduleRecovery(context, 0);
    }
  } else {
    context.pendingState = state;
    scheduleRecovery(context, 0);
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
  } else {
    context.snapshot = {
      ...context.snapshot,
      messages: mergeMessages(context.snapshot.messages, [message]),
      serverTime: Date.now(),
    };
    context.pendingMessages = mergeMessages(context.pendingMessages, [message]);
    const wireMessage: WireMessage = {
      type: "message",
      participantId: session.participantId,
      message,
    };
    if (context.hostConnection?.open) {
      try {
        context.hostConnection.send(wireMessage);
      } catch {
        scheduleRecovery(context, 0);
      }
    } else {
      scheduleRecovery(context, 0);
    }
  }

  return { message, serverTime: Date.now() };
}
