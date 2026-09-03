import type { DataConnection, Peer } from "peerjs";

import type {
  ChatMessage,
  ChatReply,
  QueueAction,
  Room,
  RoomSession,
  RoomSettings,
  RoomSnapshot,
  VideoQueueItem,
} from "@/lib/room-api";

type RoomState = Pick<Room, "videoId" | "playing" | "position">;
type ConnectionStatus = NonNullable<RoomSnapshot["connectionStatus"]>;

type RoomMutation =
  | { id: string; createdAt: number; kind: "settings"; settings: Partial<RoomSettings> }
  | { id: string; createdAt: number; kind: "queue-add"; videoId: string }
  | { id: string; createdAt: number; kind: "queue-remove"; itemId: string }
  | { id: string; createdAt: number; kind: "queue-move"; itemId: string; direction: -1 | 1 }
  | { id: string; createdAt: number; kind: "queue-play"; itemId?: string };

type WireMessage =
  | { type: "join"; participantId: string; name: string; peerId: string; inviteToken?: string }
  | { type: "rejected"; reason: string }
  | { type: "snapshot"; snapshot: RoomSnapshot }
  | { type: "state"; participantId: string; state: RoomState }
  | { type: "message"; participantId: string; message: ChatMessage }
  | { type: "mutation"; participantId: string; mutation: RoomMutation }
  | { type: "ack"; kind: "message" | "mutation"; id: string }
  | { type: "handoff"; snapshot: RoomSnapshot }
  | { type: "leave"; participantId: string }
  | { type: "heartbeat"; participantId: string };

type CachedRoom = { snapshot: RoomSnapshot; savedAt: number };

type PeerRoomContext = {
  role: "host" | "guest";
  peer: Peer;
  session: RoomSession;
  snapshot: RoomSnapshot;
  active: boolean;
  status: ConnectionStatus;
  hostConnection?: DataConnection;
  guestConnections: Map<string, DataConnection>;
  knownParticipantIds: Set<string>;
  pendingMessages: ChatMessage[];
  pendingMutations: RoomMutation[];
  pendingState?: RoomState;
  appliedMutationIds: Set<string>;
  reconnectTimer?: number;
  electionTimer?: number;
  reconnecting: boolean;
  connectingPromise?: Promise<RoomSnapshot>;
  cleanupLifecycle?: () => void;
};

const PEER_PREFIX = "watch-with-me-room-";
const CACHE_PREFIX = "watch-with-me:room-cache:";
const CONNECTION_TIMEOUT = 10_000;
const CACHE_MAX_AGE = 6 * 60 * 60 * 1000;
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

function cleanReply(reply?: ChatReply): ChatReply | undefined {
  if (!reply || !reply.messageId) return undefined;
  const body = cleanMessage(reply.body).slice(0, 120);
  const senderName = cleanName(reply.senderName);
  if (!body || !senderName) return undefined;
  return { messageId: reply.messageId, senderName, body };
}

function validVideoId(value: string) {
  return /^[\w-]{11}$/.test(value);
}

function randomCode() {
  const data = new Uint16Array(1);
  crypto.getRandomValues(data);
  return String(data[0] % 10_000).padStart(4, "0");
}

function randomToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function peerIdFor(code: string) {
  return `${PEER_PREFIX}${code}`;
}

function withSnapshotDefaults(snapshot: RoomSnapshot): RoomSnapshot {
  return {
    ...cloneSnapshot(snapshot),
    room: {
      ...snapshot.room,
      controlMode: snapshot.room.controlMode ?? "everyone",
      locked: snapshot.room.locked ?? false,
      secureInvite: snapshot.room.secureInvite ?? false,
      inviteToken: snapshot.room.inviteToken ?? randomToken(),
    },
    queue: snapshot.queue ?? [],
    messages: snapshot.messages ?? [],
    participants: snapshot.participants ?? [],
  };
}

function normalizeIncomingSnapshot(snapshot: RoomSnapshot): RoomSnapshot {
  const receivedAt = Date.now();
  const normalized = withSnapshotDefaults(snapshot);
  const stateAge = Math.max(0, snapshot.serverTime - snapshot.room.updatedAt);
  return {
    ...normalized,
    room: { ...normalized.room, updatedAt: receivedAt - stateAge },
    serverTime: receivedAt,
    connectionStatus: "connected",
  };
}

function cacheKey(code: string) {
  return `${CACHE_PREFIX}${code}`;
}

function persistSnapshot(context: PeerRoomContext) {
  try {
    window.localStorage.setItem(
      cacheKey(context.session.code),
      JSON.stringify({ snapshot: context.snapshot, savedAt: Date.now() } satisfies CachedRoom),
    );
  } catch {
    // A sala continua funcionando mesmo se o navegador bloquear o armazenamento local.
  }
}

function loadCachedSnapshot(code: string) {
  try {
    const raw = window.localStorage.getItem(cacheKey(code));
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedRoom;
    if (!cached.snapshot || Date.now() - cached.savedAt > CACHE_MAX_AGE) return null;
    return withSnapshotDefaults(cached.snapshot);
  } catch {
    return null;
  }
}

function setConnectionStatus(context: PeerRoomContext, status: ConnectionStatus) {
  context.status = status;
  context.snapshot.connectionStatus = status;
}

function publicSnapshot(context: PeerRoomContext) {
  const snapshot = withSnapshotDefaults({
    ...context.snapshot,
    serverTime: Date.now(),
    connectionStatus: context.status,
  });
  const pendingIds = new Set(context.pendingMessages.map((message) => message.id));
  snapshot.messages = snapshot.messages.map((message) => ({
    ...message,
    delivery:
      message.participantId === context.session.participantId
        ? pendingIds.has(message.id) ? "pending" : "sent"
        : undefined,
  }));
  return cloneSnapshot(snapshot);
}

function wireSnapshot(context: PeerRoomContext) {
  const snapshot = withSnapshotDefaults({
    ...context.snapshot,
    serverTime: Date.now(),
    connectionStatus: "connected",
  });
  snapshot.messages = snapshot.messages.map((message) => {
    const clean = { ...message };
    delete clean.delivery;
    return clean;
  });
  return snapshot;
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

function bindPeerRecovery(context: PeerRoomContext, peer: Peer) {
  peer.on("disconnected", () => {
    if (context.peer !== peer || !context.active) return;
    setConnectionStatus(context, navigator.onLine ? "reconnecting" : "offline");
    scheduleRecovery(context);
  });
  peer.on("error", () => {
    if (context.peer !== peer || !context.active) return;
    setConnectionStatus(context, navigator.onLine ? "reconnecting" : "offline");
    scheduleRecovery(context);
  });
}

function scheduleRecovery(context: PeerRoomContext, delay = 750) {
  if (!context.active || context.reconnectTimer !== undefined) return;
  if (!navigator.onLine) setConnectionStatus(context, "offline");
  else if (context.status !== "connected") setConnectionStatus(context, "reconnecting");
  context.reconnectTimer = window.setTimeout(() => {
    context.reconnectTimer = undefined;
    void recoverConnection(context);
  }, delay);
}

export function hostElectionDelay(
  participantIds: string[],
  hostParticipantId: string | undefined,
  ownParticipantId: string,
) {
  const candidates = participantIds
    .filter((participantId) => participantId !== hostParticipantId)
    .sort();
  const rank = Math.max(0, candidates.indexOf(ownParticipantId));
  return 1_400 + rank * 850;
}

function scheduleElection(context: PeerRoomContext, preferredDelay?: number) {
  if (!context.active || context.role !== "guest" || context.electionTimer !== undefined) return;
  const hostId = context.snapshot.room.hostParticipantId;
  const delay = preferredDelay ?? hostElectionDelay(
    context.snapshot.participants.map((participant) => participant.id),
    hostId,
    context.session.participantId,
  );
  context.electionTimer = window.setTimeout(() => {
    context.electionTimer = undefined;
    void promoteToHost(context);
  }, delay);
}

async function promoteToHost(context: PeerRoomContext) {
  if (!context.active || context.role !== "guest" || context.hostConnection?.open || !navigator.onLine) return;
  setConnectionStatus(context, "reconnecting");

  try {
    const hostPeer = await openPeer(peerIdFor(context.session.code));
    if (!context.active || context.role !== "guest" || context.hostConnection?.open) {
      hostPeer.destroy();
      return;
    }

    const oldPeer = context.peer;
    context.hostConnection?.close();
    context.hostConnection = undefined;
    context.peer = hostPeer;
    context.role = "host";
    context.guestConnections = new Map();
    context.snapshot = {
      ...context.snapshot,
      room: {
        ...context.snapshot.room,
        hostParticipantId: context.session.participantId,
        version: context.snapshot.room.version + 1,
        updatedAt: Date.now(),
      },
      participants: [{ id: context.session.participantId, name: context.session.name, peerId: hostPeer.id }],
      messages: mergeMessages(context.snapshot.messages, context.pendingMessages),
      serverTime: Date.now(),
    };
    context.pendingMessages = [];
    if (context.pendingState) {
      applyRoomState(context, context.pendingState);
      context.pendingState = undefined;
    }
    for (const mutation of context.pendingMutations) {
      applyMutation(context, mutation, context.session.participantId);
    }
    context.pendingMutations = [];
    hostPeer.on("connection", (connection) => handleHostConnection(context, connection));
    bindPeerRecovery(context, hostPeer);
    oldPeer.destroy();
    setConnectionStatus(context, "connected");
    persistSnapshot(context);
  } catch {
    setConnectionStatus(context, "reconnecting");
    scheduleRecovery(context, 1_500);
  }
}

async function recoverConnection(context: PeerRoomContext) {
  if (!context.active || context.reconnecting) return;
  if (!navigator.onLine) {
    setConnectionStatus(context, "offline");
    return;
  }
  context.reconnecting = true;
  setConnectionStatus(context, "reconnecting");
  try {
    await reconnectSignaling(context.peer);
    if (context.role === "guest" && !context.hostConnection?.open) {
      await connectGuestConnection(context);
    }
    setConnectionStatus(context, "connected");
  } catch {
    if (context.role === "guest") scheduleElection(context);
    scheduleRecovery(context, 2_000);
  } finally {
    context.reconnecting = false;
  }
}

function registerLifecycleRecovery(context: PeerRoomContext) {
  const recover = () => {
    if (document.visibilityState === "visible" && navigator.onLine) scheduleRecovery(context, 0);
  };
  const offline = () => setConnectionStatus(context, "offline");
  document.addEventListener("visibilitychange", recover);
  window.addEventListener("focus", recover);
  window.addEventListener("online", recover);
  window.addEventListener("offline", offline);
  window.addEventListener("pageshow", recover);
  context.cleanupLifecycle = () => {
    document.removeEventListener("visibilitychange", recover);
    window.removeEventListener("focus", recover);
    window.removeEventListener("online", recover);
    window.removeEventListener("offline", offline);
    window.removeEventListener("pageshow", recover);
  };
}

function broadcastSnapshot(context: PeerRoomContext) {
  persistSnapshot(context);
  const message: WireMessage = { type: "snapshot", snapshot: wireSnapshot(context) };
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
  persistSnapshot(context);
}

function canControl(context: PeerRoomContext, participantId: string) {
  return context.snapshot.room.controlMode !== "host" || context.snapshot.room.hostParticipantId === participantId;
}

function applyMutation(context: PeerRoomContext, mutation: RoomMutation, participantId: string) {
  if (context.appliedMutationIds.has(mutation.id)) return true;
  const participant = context.snapshot.participants.find((item) => item.id === participantId);
  if (!participant) return false;

  if (mutation.kind === "settings") {
    if (context.snapshot.room.hostParticipantId !== participantId) return false;
    context.snapshot = {
      ...context.snapshot,
      room: {
        ...context.snapshot.room,
        controlMode: mutation.settings.controlMode ?? context.snapshot.room.controlMode,
        locked: mutation.settings.locked ?? context.snapshot.room.locked,
        secureInvite: mutation.settings.secureInvite ?? context.snapshot.room.secureInvite,
        version: context.snapshot.room.version + 1,
        updatedAt: Date.now(),
      },
      serverTime: Date.now(),
    };
  } else if (mutation.kind === "queue-add") {
    if (!validVideoId(mutation.videoId)) return false;
    const item: VideoQueueItem = {
      id: mutation.id,
      videoId: mutation.videoId,
      addedBy: participant.id,
      addedByName: participant.name,
      addedAt: mutation.createdAt,
    };
    if (!context.snapshot.room.videoId) {
      applyRoomState(context, { videoId: item.videoId, playing: false, position: 0 });
    } else if (!(context.snapshot.queue ?? []).some((queued) => queued.id === item.id)) {
      context.snapshot = {
        ...context.snapshot,
        queue: [...(context.snapshot.queue ?? []), item].slice(-30),
        serverTime: Date.now(),
      };
    }
  } else if (mutation.kind === "queue-remove") {
    const item = (context.snapshot.queue ?? []).find((queued) => queued.id === mutation.itemId);
    if (!item || (!canControl(context, participantId) && item.addedBy !== participantId)) return false;
    context.snapshot = {
      ...context.snapshot,
      queue: (context.snapshot.queue ?? []).filter((queued) => queued.id !== mutation.itemId),
      serverTime: Date.now(),
    };
  } else if (mutation.kind === "queue-move") {
    if (!canControl(context, participantId)) return false;
    const queue = [...(context.snapshot.queue ?? [])];
    const index = queue.findIndex((item) => item.id === mutation.itemId);
    const destination = index + mutation.direction;
    if (index < 0 || destination < 0 || destination >= queue.length) return false;
    [queue[index], queue[destination]] = [queue[destination], queue[index]];
    context.snapshot = { ...context.snapshot, queue, serverTime: Date.now() };
  } else if (mutation.kind === "queue-play") {
    if (!canControl(context, participantId)) return false;
    const queue = [...(context.snapshot.queue ?? [])];
    const index = mutation.itemId ? queue.findIndex((item) => item.id === mutation.itemId) : 0;
    if (index < 0 || !queue[index]) return false;
    const [next] = queue.splice(index, 1);
    context.snapshot = { ...context.snapshot, queue };
    applyRoomState(context, { videoId: next.videoId, playing: false, position: 0 });
  }

  context.appliedMutationIds.add(mutation.id);
  if (context.appliedMutationIds.size > 300) {
    context.appliedMutationIds = new Set([...context.appliedMutationIds].slice(-150));
  }
  persistSnapshot(context);
  return true;
}

function removeGuest(context: PeerRoomContext, participantId: string, connection: DataConnection) {
  if (context.guestConnections.get(participantId) !== connection) return;
  if (!context.guestConnections.delete(participantId)) return;
  context.snapshot = {
    ...context.snapshot,
    participants: context.snapshot.participants.filter((participant) => participant.id !== participantId),
    serverTime: Date.now(),
  };
  broadcastSnapshot(context);
}

function rejectConnection(connection: DataConnection, reason: string) {
  connection.send({ type: "rejected", reason } satisfies WireMessage);
  window.setTimeout(() => connection.close(), 120);
}

function connectionError(message: string, type: "host-unavailable" | "rejected") {
  const error = new Error(message) as Error & { type?: string };
  error.type = type;
  return error;
}

function handleHostConnection(context: PeerRoomContext, connection: DataConnection) {
  let joinedParticipantId: string | null = null;

  connection.on("data", (raw) => {
    const message = raw as WireMessage;
    if (!message || typeof message !== "object") return;

    if (message.type === "join" && !joinedParticipantId) {
      const name = cleanName(message.name);
      if (!name || !/^[0-9a-f-]{36}$/i.test(message.participantId)) {
        rejectConnection(connection, "Os dados de entrada são inválidos.");
        return;
      }
      const knownParticipant = context.knownParticipantIds.has(message.participantId);
      const returningWithRoomToken = Boolean(
        message.inviteToken && message.inviteToken === context.snapshot.room.inviteToken,
      );
      if (context.snapshot.room.locked && !knownParticipant && !returningWithRoomToken) {
        rejectConnection(connection, "A sala está fechada para novas entradas.");
        return;
      }
      if (context.snapshot.room.secureInvite && message.inviteToken !== context.snapshot.room.inviteToken) {
        rejectConnection(connection, "Este convite não é válido. Peça um novo link.");
        return;
      }

      joinedParticipantId = message.participantId;
      context.knownParticipantIds.add(joinedParticipantId);
      const previous = context.guestConnections.get(joinedParticipantId);
      if (previous && previous !== connection) previous.close();
      context.guestConnections.set(joinedParticipantId, connection);
      context.snapshot = {
        ...context.snapshot,
        participants: [
          ...context.snapshot.participants.filter((participant) => participant.id !== joinedParticipantId),
          { id: joinedParticipantId, name, peerId: message.peerId },
        ],
        serverTime: Date.now(),
      };
      broadcastSnapshot(context);
      return;
    }

    if (
      message.type === "snapshot" || message.type === "rejected" || message.type === "handoff" ||
      message.type === "ack" || !joinedParticipantId || !("participantId" in message) ||
      message.participantId !== joinedParticipantId
    ) return;

    if (message.type === "state") {
      if (canControl(context, joinedParticipantId)) applyRoomState(context, message.state);
      broadcastSnapshot(context);
      return;
    }

    if (message.type === "message") {
      const body = cleanMessage(message.message.body);
      const participant = context.snapshot.participants.find((item) => item.id === joinedParticipantId);
      if (!body || !participant) return;
      const sourceReply = cleanReply(message.message.replyTo);
      const repliedMessage = sourceReply
        ? context.snapshot.messages.find((item) => item.id === sourceReply.messageId)
        : undefined;
      const chatMessage: ChatMessage = {
        id: message.message.id,
        participantId: joinedParticipantId,
        senderName: participant.name,
        body,
        createdAt: Date.now(),
        replyTo: repliedMessage ? {
          messageId: repliedMessage.id,
          senderName: repliedMessage.senderName,
          body: repliedMessage.body.slice(0, 120),
        } : undefined,
      };
      if (!context.snapshot.messages.some((item) => item.id === chatMessage.id)) {
        context.snapshot = {
          ...context.snapshot,
          messages: [...context.snapshot.messages, chatMessage].slice(-100),
          serverTime: Date.now(),
        };
      }
      connection.send({ type: "ack", kind: "message", id: chatMessage.id });
      broadcastSnapshot(context);
      return;
    }

    if (message.type === "mutation") {
      applyMutation(context, message.mutation, joinedParticipantId);
      connection.send({ type: "ack", kind: "mutation", id: message.mutation.id });
      broadcastSnapshot(context);
      return;
    }

    if (message.type === "heartbeat") {
      connection.send({ type: "snapshot", snapshot: wireSnapshot(context) });
      return;
    }

    if (message.type === "leave") connection.close();
  });

  connection.on("close", () => {
    if (joinedParticipantId) removeGuest(context, joinedParticipantId, connection);
  });
}

function createInitialSnapshot(
  code: string,
  session: RoomSession,
  peerId: string,
  inviteToken?: string,
  cached?: RoomSnapshot | null,
) {
  const now = Date.now();
  if (cached) {
    const restored = withSnapshotDefaults(cached);
    return {
      ...restored,
      room: {
        ...restored.room,
        code,
        hostParticipantId: session.participantId,
        inviteToken: inviteToken ?? restored.room.inviteToken ?? randomToken(),
        version: restored.room.version + 1,
        updatedAt: now,
      },
      participants: [{ id: session.participantId, name: session.name, peerId }],
      serverTime: now,
      connectionStatus: "connected" as const,
    };
  }
  return {
    room: {
      code,
      videoId: null,
      playing: false,
      position: 0,
      version: 0,
      createdAt: now,
      updatedAt: now,
      hostParticipantId: session.participantId,
      controlMode: "everyone" as const,
      locked: false,
      secureInvite: false,
      inviteToken: inviteToken ?? randomToken(),
    },
    participants: [{ id: session.participantId, name: session.name, peerId }],
    messages: [],
    queue: [],
    serverTime: now,
    connectionStatus: "connected" as const,
  };
}

async function createPeerRoom(
  name: string,
  preferredCode?: string,
  inviteToken?: string,
  cached?: RoomSnapshot | null,
) {
  const maxAttempts = preferredCode ? 5 : 20;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const restoring = Boolean(preferredCode && /^\d{4}$/.test(preferredCode));
    const code = restoring ? preferredCode as string : randomCode();
    try {
      const peer = await openPeer(peerIdFor(code));
      const session: RoomSession = { participantId: crypto.randomUUID(), name, code, inviteToken };
      const snapshot = createInitialSnapshot(code, session, peer.id, inviteToken, cached);
      session.inviteToken = snapshot.room.inviteToken;
      const context: PeerRoomContext = {
        role: "host",
        peer,
        session,
        active: true,
        status: "connected",
        guestConnections: new Map(),
        knownParticipantIds: new Set([session.participantId]),
        pendingMessages: [],
        pendingMutations: [],
        appliedMutationIds: new Set(),
        reconnecting: false,
        snapshot,
      };
      peer.on("connection", (connection) => handleHostConnection(context, connection));
      bindPeerRecovery(context, peer);
      registerLifecycleRecovery(context);
      persistSnapshot(context);
      currentRoom = context;
      return {
        ...publicSnapshot(context),
        participantId: session.participantId,
        sessionRole: "create" as const,
        inviteToken: session.inviteToken,
      };
    } catch (error) {
      const type = (error as { type?: string }).type;
      if (type !== "unavailable-id") throw error;
      if (restoring) await new Promise((resolve) => window.setTimeout(resolve, 450));
    }
  }
  const error = new Error("Essa sala já tem um anfitrião ativo.") as Error & { type?: string };
  error.type = "unavailable-id";
  throw error;
}

function connectGuestConnection(context: PeerRoomContext): Promise<RoomSnapshot> {
  if (context.connectingPromise) return context.connectingPromise;
  const promise = new Promise<RoomSnapshot>((resolve, reject) => {
    const connection = context.peer.connect(peerIdFor(context.session.code), {
      reliable: true,
      serialization: "json",
    });
    context.hostConnection = connection;
    let receivedSnapshot = false;
    let settled = false;
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(error);
    };
    const timer = window.setTimeout(() => {
      if (receivedSnapshot) return;
      finishReject(connectionError("Sala não encontrada. Confirme o código e tente novamente.", "host-unavailable"));
      connection.close();
    }, CONNECTION_TIMEOUT);

    const loseConnection = () => {
      if (context.hostConnection !== connection) return;
      context.hostConnection = undefined;
      if (!receivedSnapshot) {
        finishReject(connectionError("Não foi possível entrar nessa sala.", "host-unavailable"));
      }
      setConnectionStatus(context, navigator.onLine ? "reconnecting" : "offline");
      scheduleElection(context);
      scheduleRecovery(context);
    };

    connection.on("open", () => {
      connection.send({
        type: "join",
        participantId: context.session.participantId,
        name: context.session.name,
        peerId: context.peer.id,
        inviteToken: context.session.inviteToken,
      } satisfies WireMessage);
    });

    connection.on("data", (raw) => {
      const message = raw as WireMessage;
      if (!message || typeof message !== "object") return;
      if (message.type === "rejected") {
        finishReject(connectionError(message.reason, "rejected"));
        connection.close();
        return;
      }
      if (message.type === "handoff") {
        context.snapshot = normalizeIncomingSnapshot(message.snapshot);
        persistSnapshot(context);
        scheduleElection(context, 180);
        return;
      }
      if (message.type === "ack") {
        if (message.kind === "message") {
          context.pendingMessages = context.pendingMessages.filter((item) => item.id !== message.id);
          context.snapshot.messages = context.snapshot.messages.map((item) =>
            item.id === message.id ? { ...item, delivery: "sent" } : item,
          );
        } else {
          context.pendingMutations = context.pendingMutations.filter((item) => item.id !== message.id);
        }
        persistSnapshot(context);
        return;
      }
      if (message.type !== "snapshot") return;

      const normalized = normalizeIncomingSnapshot(message.snapshot);
      const confirmedMessageIds = new Set(normalized.messages.map((chatMessage) => chatMessage.id));
      context.pendingMessages = context.pendingMessages.filter(
        (chatMessage) => !confirmedMessageIds.has(chatMessage.id),
      );
      normalized.messages = mergeMessages(normalized.messages, context.pendingMessages);
      context.snapshot = normalized;
      setConnectionStatus(context, "connected");
      persistSnapshot(context);

      if (!receivedSnapshot) {
        receivedSnapshot = true;
        settled = true;
        window.clearTimeout(timer);
        const pendingState = context.pendingState;
        context.pendingState = undefined;
        if (pendingState) {
          connection.send({ type: "state", participantId: context.session.participantId, state: pendingState });
        }
        for (const chatMessage of context.pendingMessages) {
          connection.send({ type: "message", participantId: context.session.participantId, message: chatMessage });
        }
        for (const mutation of context.pendingMutations) {
          connection.send({ type: "mutation", participantId: context.session.participantId, mutation });
        }
        resolve(publicSnapshot(context));
      }
    });

    connection.on("close", loseConnection);
    connection.on("error", loseConnection);
  }).finally(() => {
    context.connectingPromise = undefined;
  });
  context.connectingPromise = promise;
  return promise;
}

async function joinPeerRoom(name: string, code: string, inviteToken?: string, cached?: RoomSnapshot | null) {
  if (!/^\d{4}$/.test(code)) throw new Error("Informe os quatro números da sala.");

  const peer = await openPeer();
  const participantId = crypto.randomUUID();
  const session: RoomSession = { participantId, name, code, inviteToken };
  const now = Date.now();
  const initial = cached ? withSnapshotDefaults(cached) : {
    room: {
      code,
      videoId: null,
      playing: false,
      position: 0,
      version: 0,
      createdAt: now,
      updatedAt: now,
      controlMode: "everyone" as const,
      locked: false,
      secureInvite: false,
      inviteToken,
    },
    participants: [],
    messages: [],
    queue: [],
    serverTime: now,
  };
  const context: PeerRoomContext = {
    role: "guest",
    peer,
    session,
    active: true,
    status: "reconnecting",
    guestConnections: new Map(),
    knownParticipantIds: new Set([participantId, ...initial.participants.map((participant) => participant.id)]),
    pendingMessages: [],
    pendingMutations: [],
    appliedMutationIds: new Set(),
    reconnecting: false,
    snapshot: {
      ...initial,
      participants: [
        ...initial.participants.filter((participant) => participant.id !== participantId),
        { id: participantId, name, peerId: peer.id },
      ],
      connectionStatus: "reconnecting",
    },
  };
  currentRoom = context;
  bindPeerRecovery(context, peer);
  registerLifecycleRecovery(context);

  try {
    const snapshot = await connectGuestConnection(context);
    session.inviteToken = snapshot.room.inviteToken ?? inviteToken;
    return {
      ...snapshot,
      participantId,
      sessionRole: "join" as const,
      inviteToken: session.inviteToken,
    };
  } catch (error) {
    context.active = false;
    context.cleanupLifecycle?.();
    peer.destroy();
    currentRoom = null;
    throw error;
  }
}

function cleanupCurrentRoom() {
  if (!currentRoom) return;
  currentRoom.active = false;
  if (currentRoom.reconnectTimer !== undefined) window.clearTimeout(currentRoom.reconnectTimer);
  if (currentRoom.electionTimer !== undefined) window.clearTimeout(currentRoom.electionTimer);
  currentRoom.cleanupLifecycle?.();
  currentRoom.peer.destroy();
  currentRoom = null;
}

function requireRoom(session: RoomSession) {
  if (
    !currentRoom || !currentRoom.active || currentRoom.session.code !== session.code ||
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
  inviteToken?: string,
  restoring = false,
) {
  cleanupCurrentRoom();
  const name = cleanName(rawName);
  if (!name) throw new Error("Digite seu nome para continuar.");
  const cached = restoring && code ? loadCachedSnapshot(code) : null;

  if (action === "create") {
    try {
      return await createPeerRoom(name, code, inviteToken, cached);
    } catch (error) {
      if ((error as { type?: string }).type === "unavailable-id" && code) {
        return joinPeerRoom(name, code, inviteToken, cached);
      }
      throw error;
    }
  }

  try {
    return await joinPeerRoom(name, code ?? "", inviteToken, cached);
  } catch (error) {
    if (
      restoring && code && cached &&
      (error as { type?: string }).type === "host-unavailable"
    ) return createPeerRoom(name, code, inviteToken, cached);
    throw error;
  }
}

export async function getPeerRoom(code: string) {
  if (!currentRoom || !currentRoom.active || currentRoom.session.code !== code) {
    throw new Error("A conexão com a sala foi encerrada.");
  }
  if (currentRoom.role === "guest" && !currentRoom.hostConnection?.open) scheduleRecovery(currentRoom, 0);
  return publicSnapshot(currentRoom);
}

export async function peerHeartbeat(session: RoomSession) {
  const context = requireRoom(session);
  if (context.role === "guest" && context.hostConnection?.open) {
    try {
      context.hostConnection.send({ type: "heartbeat", participantId: session.participantId } satisfies WireMessage);
    } catch {
      scheduleRecovery(context, 0);
    }
  } else if (context.role === "guest") {
    scheduleRecovery(context, 0);
  } else if (!context.peer.disconnected) {
    setConnectionStatus(context, "connected");
  }
  return { ok: true as const, serverTime: Date.now() };
}

export async function retryPeerConnection(session: RoomSession) {
  const context = requireRoom(session);
  setConnectionStatus(context, navigator.onLine ? "reconnecting" : "offline");
  await recoverConnection(context);
  return publicSnapshot(context);
}

export async function leavePeerRoom(session: RoomSession) {
  const context = requireRoom(session);
  context.active = false;
  if (context.reconnectTimer !== undefined) window.clearTimeout(context.reconnectTimer);
  if (context.electionTimer !== undefined) window.clearTimeout(context.electionTimer);
  context.cleanupLifecycle?.();
  if (context.role === "guest" && context.hostConnection?.open) {
    context.hostConnection.send({ type: "leave", participantId: session.participantId } satisfies WireMessage);
    context.hostConnection.close();
  } else if (context.role === "host") {
    const successor = [...context.guestConnections.entries()]
      .sort(([first], [second]) => first.localeCompare(second))[0];
    if (successor?.[1].open) successor[1].send({ type: "handoff", snapshot: wireSnapshot(context) });
  }
  context.peer.destroy();
  currentRoom = null;
  return { ok: true as const };
}

export async function updatePeerRoomState(session: RoomSession, state: RoomState) {
  const context = requireRoom(session);
  if (!canControl(context, session.participantId)) {
    throw new Error("Somente o anfitrião pode controlar o vídeo agora.");
  }
  applyRoomState(context, state);

  if (context.role === "host") {
    broadcastSnapshot(context);
  } else if (context.hostConnection?.open) {
    try {
      context.hostConnection.send({ type: "state", participantId: session.participantId, state } satisfies WireMessage);
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

function sendMutation(context: PeerRoomContext, mutation: RoomMutation) {
  if (context.role === "host") {
    if (!applyMutation(context, mutation, context.session.participantId)) {
      throw new Error("Essa alteração não é permitida.");
    }
    broadcastSnapshot(context);
    return;
  }
  context.pendingMutations = [...context.pendingMutations, mutation].slice(-50);
  if (context.hostConnection?.open) {
    try {
      context.hostConnection.send({
        type: "mutation",
        participantId: context.session.participantId,
        mutation,
      } satisfies WireMessage);
    } catch {
      scheduleRecovery(context, 0);
    }
  } else {
    scheduleRecovery(context, 0);
  }
}

export async function updatePeerRoomSettings(session: RoomSession, settings: Partial<RoomSettings>) {
  const context = requireRoom(session);
  if (context.snapshot.room.hostParticipantId !== session.participantId) {
    throw new Error("Somente o anfitrião pode mudar essas opções.");
  }
  const mutation: RoomMutation = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    kind: "settings",
    settings,
  };
  sendMutation(context, mutation);
  return publicSnapshot(context);
}

export async function updatePeerVideoQueue(session: RoomSession, action: QueueAction) {
  const context = requireRoom(session);
  const base = { id: crypto.randomUUID(), createdAt: Date.now() };
  let mutation: RoomMutation;
  if (action.type === "add") mutation = { ...base, kind: "queue-add", videoId: action.videoId };
  else if (action.type === "remove") mutation = { ...base, kind: "queue-remove", itemId: action.itemId };
  else if (action.type === "move") {
    mutation = { ...base, kind: "queue-move", itemId: action.itemId, direction: action.direction };
  } else mutation = { ...base, kind: "queue-play", itemId: action.itemId };
  sendMutation(context, mutation);
  return publicSnapshot(context);
}

export async function sendPeerChatMessage(session: RoomSession, rawBody: string, rawReply?: ChatReply) {
  const context = requireRoom(session);
  const body = cleanMessage(rawBody);
  if (!body) throw new Error("Escreva uma mensagem antes de enviar.");

  const message: ChatMessage = {
    id: crypto.randomUUID(),
    participantId: session.participantId,
    senderName: session.name,
    body,
    createdAt: Date.now(),
    replyTo: cleanReply(rawReply),
    delivery: context.role === "host" ? "sent" : "pending",
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
    if (context.hostConnection?.open) {
      try {
        context.hostConnection.send({
          type: "message",
          participantId: session.participantId,
          message,
        } satisfies WireMessage);
      } catch {
        scheduleRecovery(context, 0);
      }
    } else {
      scheduleRecovery(context, 0);
    }
    persistSnapshot(context);
  }

  return { message, serverTime: Date.now() };
}
