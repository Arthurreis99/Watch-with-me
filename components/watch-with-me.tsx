"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bell,
  BellOff,
  Check,
  CircleAlert,
  Clapperboard,
  Copy,
  Crown,
  Download,
  Link2,
  ListVideo,
  LoaderCircle,
  Lock,
  LogIn,
  MessageCircle,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Reply,
  Send,
  Settings2,
  Share2,
  ShieldCheck,
  SkipForward,
  Smartphone,
  Trash2,
  Unlock,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Toaster } from "@/components/ui/sonner";
import {
  ChatMessage,
  enterRoom,
  getRoom,
  heartbeat,
  leaveRoom,
  reconnectRoom,
  Room,
  RoomSession,
  RoomSnapshot,
  sendChatReply,
  updateRoomSettings,
  updateRoomState,
  updateVideoQueue,
} from "@/lib/room-api";
import {
  extractYouTubeId,
  playerVolumeForUi,
  youtubeErrorMessage,
} from "@/lib/watch-utils";

type EnterResult = Awaited<ReturnType<typeof enterRoom>> & {
  sessionRole?: "create" | "join";
  inviteToken?: string;
};
type StoredRoomSession = {
  role: "create" | "join";
  name: string;
  code: string;
  inviteToken?: string;
  savedAt: number;
};

type YTEvent = { data: number; target: YTPlayer };
type YTErrorEvent = { data: number; target: YTPlayer };

type YTPlayer = {
  cueVideoById(videoId: string): void;
  destroy(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  getVideoData(): { video_id?: string };
  getVolume(): number;
  mute(): void;
  pauseVideo(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  unMute(): void;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      playerVars: Record<string, number | string>;
      events: {
        onReady(event: { target: YTPlayer }): void;
        onStateChange(event: YTEvent): void;
        onError(event: YTErrorEvent): void;
        onAutoplayBlocked(): void;
      };
    },
  ) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number };
};

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type WakeLockHandle = { released: boolean; release(): Promise<void> };

const YOUTUBE_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

const CONNECTION_LABEL = {
  connected: "Conectado",
  reconnecting: "Reconectando…",
  offline: "Sem internet",
} as const;

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<YTNamespace>((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (window.YT) resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return youtubeApiPromise;
}

function targetPosition(room: Room, serverTime: number) {
  if (!room.playing) return room.position;
  return room.position + Math.max(0, serverTime - room.updatedAt) / 1000;
}

function isMobileAudioDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    window.matchMedia("(pointer: coarse)").matches;
}

function Landing({
  name,
  setName,
  code,
  setCode,
  busy,
  onEnter,
  installAvailable,
  onInstall,
}: {
  name: string;
  setName(value: string): void;
  code: string;
  setCode(value: string): void;
  busy: "create" | "join" | null;
  onEnter(action: "create" | "join"): void;
  installAvailable: boolean;
  onInstall(): void;
}) {
  return (
    <main className="landing-shell">
      <section className="entry-panel" aria-labelledby="page-title">
        <div className="brand-mark" aria-hidden="true"><Clapperboard /></div>
        <div className="entry-heading">
          <p className="eyebrow">WATCH WITH ME</p>
          <h1 id="page-title">Aperte o play. Juntos.</h1>
          <p>Crie uma sala ou entre com o código de quem já está esperando.</p>
        </div>

        <div className="name-field">
          <label htmlFor="display-name">Seu nome</label>
          <Input
            id="display-name"
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 24))}
            placeholder="Como você quer aparecer?"
            autoComplete="nickname"
            className="h-12 rounded-xl border-white/10 bg-white/[0.06] px-4 text-base shadow-none"
          />
        </div>

        <div className="entry-actions">
          <article className="action-card action-card-primary">
            <span className="action-icon"><Plus /></span>
            <div><h2>Criar uma sala</h2><p>Receba um código novo de quatro números.</p></div>
            <Button
              size="lg"
              onClick={() => onEnter("create")}
              disabled={Boolean(busy)}
              className="h-12 w-full rounded-xl bg-[var(--watch-red)] text-base text-white hover:bg-[var(--watch-red-bright)]"
            >
              {busy === "create" ? <LoaderCircle className="animate-spin" /> : <Play />}
              Criar sala
            </Button>
          </article>

          <article className="action-card">
            <span className="action-icon"><LogIn /></span>
            <div><h2>Entrar em uma sala</h2><p>Digite o código ou abra o link recebido.</p></div>
            <InputOTP
              maxLength={4}
              value={code}
              onChange={(value) => setCode(value.replace(/\D/g, ""))}
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Código da sala"
              containerClassName="justify-center"
            >
              <InputOTPGroup className="gap-2">
                {[0, 1, 2, 3].map((index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    className="h-12 w-12 rounded-xl border border-white/10 bg-white/[0.06] text-lg first:rounded-xl first:border last:rounded-xl"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <Button
              size="lg"
              variant="outline"
              onClick={() => onEnter("join")}
              disabled={Boolean(busy) || code.length !== 4}
              className="h-12 w-full rounded-xl border-white/15 bg-white/[0.05] text-base hover:bg-white/10 hover:text-white"
            >
              {busy === "join" ? <LoaderCircle className="animate-spin" /> : <LogIn />}
              Entrar
            </Button>
          </article>
        </div>

        <div className="entry-footer">
          <p className="entry-note"><Radio /> A sala continua ativa enquanto alguém permanecer conectado.</p>
          {installAvailable && (
            <Button variant="ghost" size="sm" onClick={onInstall} className="install-button">
              <Download /> Instalar aplicativo
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}

function WatchRoom({
  session,
  initialSnapshot,
  onExit,
  installAvailable,
  onInstall,
}: {
  session: RoomSession;
  initialSnapshot: RoomSnapshot;
  onExit(): void;
  installAvailable: boolean;
  onInstall(): void;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [videoUrl, setVideoUrl] = useState("");
  const [playerReady, setPlayerReady] = useState(false);
  const [playerUnlocked, setPlayerUnlocked] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerGeneration, setPlayerGeneration] = useState(0);
  const [savingVideo, setSavingVideo] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [volume, setVolume] = useState(100);
  const [mobileAudio, setMobileAudio] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const playerHostRef = useRef<HTMLDivElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const playerUnlockedRef = useRef(false);
  const volumeRef = useRef(100);
  const snapshotRef = useRef(snapshot);
  const suppressEventsUntilRef = useRef(0);
  const lastSampleRef = useRef({ media: 0, wall: 0, state: -1 });
  const snapshotReceivedAtRef = useRef(0);
  const knownMessageIdsRef = useRef(new Set(initialSnapshot.messages.map((message) => message.id)));
  const audioContextRef = useRef<AudioContext | null>(null);
  const advanceQueueRef = useRef<() => void>(() => undefined);
  const returningToChatRef = useRef(false);

  const queue = snapshot.queue ?? [];
  const connectionStatus = snapshot.connectionStatus ?? "connected";
  const isHost = snapshot.room.hostParticipantId === session.participantId;
  const canControl = snapshot.room.controlMode !== "host" || isHost;

  useEffect(() => {
    snapshotRef.current = snapshot;
    snapshotReceivedAtRef.current = Date.now();
  }, [snapshot]);

  useEffect(() => {
    const refreshStoredSession = () => {
      window.localStorage.setItem("watch-with-me:room-session", JSON.stringify({
        role: isHost ? "create" : "join",
        name: session.name,
        code: session.code,
        inviteToken: snapshotRef.current.room.inviteToken ?? session.inviteToken,
        savedAt: Date.now(),
      } satisfies StoredRoomSession));
    };
    refreshStoredSession();
    const timer = window.setInterval(refreshStoredSession, 60_000);
    return () => window.clearInterval(timer);
  }, [isHost, session]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedVolume = window.localStorage.getItem("watch-with-me:volume");
      const parsedVolume = savedVolume === null ? 100 : Number(savedVolume);
      const initialVolume = Number.isFinite(parsedVolume)
        ? Math.max(0, Math.min(100, parsedVolume))
        : 100;
      const mobile = isMobileAudioDevice();
      volumeRef.current = initialVolume;
      setVolume(initialVolume);
      setMobileAudio(mobile);
      setSoundEnabled(window.localStorage.getItem("watch-with-me:chat-sound") === "true");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let wakeLock: WakeLockHandle | null = null;
    const acquire = async () => {
      const wakeLockApi = (navigator as Navigator & {
        wakeLock?: { request(type: "screen"): Promise<WakeLockHandle> };
      }).wakeLock;
      if (!wakeLockApi || document.visibilityState !== "visible") return;
      try {
        wakeLock = await wakeLockApi.request("screen");
      } catch {
        wakeLock = null;
      }
    };
    const restore = () => {
      if (document.visibilityState === "visible" && (!wakeLock || wakeLock.released)) void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", restore);
    return () => {
      document.removeEventListener("visibilitychange", restore);
      void wakeLock?.release();
    };
  }, []);

  const playMessageSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext;
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.07, context.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.13);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.14);
    } catch {
      // O navegador pode bloquear som até a primeira interação.
    }
  }, [soundEnabled]);

  useEffect(() => {
    let clearAwayTimer: number | undefined;
    const trackVisibility = () => {
      if (document.visibilityState !== "visible") {
        returningToChatRef.current = true;
        if (clearAwayTimer !== undefined) window.clearTimeout(clearAwayTimer);
      } else {
        clearAwayTimer = window.setTimeout(() => {
          returningToChatRef.current = false;
        }, 1_800);
      }
    };
    document.addEventListener("visibilitychange", trackVisibility);
    return () => {
      document.removeEventListener("visibilitychange", trackVisibility);
      if (clearAwayTimer !== undefined) window.clearTimeout(clearAwayTimer);
    };
  }, []);

  useEffect(() => {
    const newRemoteMessages = snapshot.messages.filter(
      (message) =>
        message.participantId !== session.participantId &&
        !knownMessageIdsRef.current.has(message.id),
    );
    for (const message of snapshot.messages) knownMessageIdsRef.current.add(message.id);
    if (newRemoteMessages.length) {
      playMessageSound();
      if (document.visibilityState !== "visible" || returningToChatRef.current) {
        setUnreadCount((current) => current + newRemoteMessages.length);
      }
    }
  }, [playMessageSound, session.participantId, snapshot.messages]);

  const newestMessageId = snapshot.messages.at(-1)?.id;
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [newestMessageId]);

  const publishState = useCallback(
    async (state: Pick<Room, "videoId" | "playing" | "position">) => {
      try {
        const result = await updateRoomState(session, state);
        setSnapshot((current) => ({ ...current, room: result.room, serverTime: result.serverTime }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "A sincronização falhou.");
      }
    },
    [session],
  );

  const publishStateRef = useRef(publishState);
  useEffect(() => {
    publishStateRef.current = publishState;
  }, [publishState]);

  const applyLocalVolume = useCallback((player: YTPlayer, nextVolume: number) => {
    if (nextVolume === 0) {
      player.mute();
      return;
    }
    player.unMute();
    if (!mobileAudio) player.setVolume(playerVolumeForUi(nextVolume));
  }, [mobileAudio]);

  useEffect(() => {
    let cancelled = false;
    let player: YTPlayer | null = null;

    void loadYouTubeApi().then((YT) => {
      if (cancelled || !playerHostRef.current) return;
      player = new YT.Player(playerHostRef.current, {
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: ({ target }) => {
            playerRef.current = target;
            applyLocalVolume(target, volumeRef.current);
            setPlayerReady(true);
            setPlayerError(null);
            const current = snapshotRef.current;
            if (current.room.videoId) {
              suppressEventsUntilRef.current = Date.now() + 1_200;
              target.cueVideoById(current.room.videoId);
              const elapsed = Math.max(0, Date.now() - snapshotReceivedAtRef.current);
              target.seekTo(targetPosition(current.room, current.serverTime + elapsed), true);
              if (current.room.playing && playerUnlockedRef.current) target.playVideo();
            }
          },
          onStateChange: ({ data, target }) => {
            const current = snapshotRef.current;
            if (!current.room.videoId) return;
            if (data === YT.PlayerState.PLAYING) {
              playerUnlockedRef.current = true;
              setPlayerUnlocked(true);
              setPlayerError(null);
            }
            if (data === YT.PlayerState.ENDED) {
              if (current.room.hostParticipantId === session.participantId && (current.queue ?? []).length) {
                advanceQueueRef.current();
              }
              return;
            }
            if (Date.now() < suppressEventsUntilRef.current) return;
            if (target.getVideoData().video_id !== current.room.videoId) return;
            if (data === YT.PlayerState.PLAYING || data === YT.PlayerState.PAUSED) {
              void publishStateRef.current({
                videoId: current.room.videoId,
                playing: data === YT.PlayerState.PLAYING,
                position: target.getCurrentTime(),
              });
            }
          },
          onError: ({ data }) => {
            playerUnlockedRef.current = false;
            setPlayerUnlocked(false);
            setPlayerError(youtubeErrorMessage(data));
          },
          onAutoplayBlocked: () => {
            playerUnlockedRef.current = false;
            setPlayerUnlocked(false);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      player?.destroy();
      playerRef.current = null;
    };
  }, [applyLocalVolume, playerGeneration, session.participantId]);

  useEffect(() => {
    const player = playerRef.current;
    const { room, serverTime } = snapshotRef.current;
    if (!player || !playerReady || !room.videoId) return;

    suppressEventsUntilRef.current = Date.now() + 900;
    const loadedVideo = player.getVideoData().video_id;
    if (loadedVideo !== room.videoId) player.cueVideoById(room.videoId);
    const target = targetPosition(room, serverTime);
    if (Math.abs(player.getCurrentTime() - target) > 0.9) player.seekTo(target, true);
    if (room.playing && playerUnlockedRef.current) player.playVideo();
    else player.pauseVideo();
  }, [snapshot.room.version, playerReady]);

  useEffect(() => {
    let stopped = false;
    let lastConnectionNotice = "connected";
    const poll = async () => {
      try {
        const next = await getRoom(session.code);
        if (!stopped) {
          setSnapshot(next);
          if (lastConnectionNotice !== "connected" && next.connectionStatus === "connected") {
            toast.success("Conexão restaurada.");
          }
          lastConnectionNotice = next.connectionStatus ?? "connected";
        }
      } catch (error) {
        if (!stopped && lastConnectionNotice === "connected") {
          toast.error(error instanceof Error ? error.message : "Sala desconectada.");
          lastConnectionNotice = "offline";
        }
      }
    };

    const pollTimer = window.setInterval(() => void poll(), 850);
    const heartbeatTimer = window.setInterval(() => void heartbeat(session), 10_000);
    void heartbeat(session);

    return () => {
      stopped = true;
      window.clearInterval(pollTimer);
      window.clearInterval(heartbeatTimer);
    };
  }, [session]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      const current = snapshotRef.current;
      if (!player || !current.room.videoId || Date.now() < suppressEventsUntilRef.current) return;

      const media = player.getCurrentTime();
      const wall = Date.now();
      const state = player.getPlayerState();
      const loadedVideoId = player.getVideoData().video_id;
      const previous = lastSampleRef.current;

      if (
        !playerUnlockedRef.current || loadedVideoId !== current.room.videoId ||
        state === YOUTUBE_STATE.UNSTARTED || state === YOUTUBE_STATE.BUFFERING ||
        state === YOUTUBE_STATE.CUED || state === YOUTUBE_STATE.ENDED
      ) {
        lastSampleRef.current = { media, wall, state };
        return;
      }

      const expectedLocal = previous.media + (previous.state === 1 ? (wall - previous.wall) / 1000 : 0);
      if (canControl && previous.state !== -1 && Math.abs(media - expectedLocal) > 2.2) {
        void publishStateRef.current({
          videoId: current.room.videoId,
          playing: state === 1,
          position: media,
        });
      } else if (state === YOUTUBE_STATE.PLAYING || state === YOUTUBE_STATE.PAUSED) {
        const elapsed = snapshotReceivedAtRef.current ? Math.max(0, wall - snapshotReceivedAtRef.current) : 0;
        const remoteTarget = targetPosition(current.room, current.serverTime + elapsed);
        if (Math.abs(media - remoteTarget) > 1.6) {
          suppressEventsUntilRef.current = wall + 700;
          player.seekTo(remoteTarget, true);
        }
      }
      lastSampleRef.current = { media, wall, state };
    }, 900);
    return () => window.clearInterval(timer);
  }, [canControl]);

  const addVideo = async (event: FormEvent) => {
    event.preventDefault();
    const videoId = extractYouTubeId(videoUrl);
    if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
      toast.error("Cole um link válido do YouTube.");
      return;
    }

    setSavingVideo(true);
    try {
      const result = await updateVideoQueue(session, { type: "add", videoId });
      setSnapshot(result);
      setVideoUrl("");
      toast.success(snapshot.room.videoId ? "Vídeo adicionado à fila." : "Vídeo adicionado à sala.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível adicionar o vídeo.");
    } finally {
      setSavingVideo(false);
    }
  };

  const unlockPlayer = () => {
    const player = playerRef.current;
    const current = snapshotRef.current;
    const videoId = current.room.videoId;
    if (!player || !videoId) return;

    playerUnlockedRef.current = true;
    setPlayerUnlocked(true);
    setPlayerError(null);
    suppressEventsUntilRef.current = Date.now() + 1_500;
    const elapsed = Math.max(0, Date.now() - snapshotReceivedAtRef.current);
    const position = targetPosition(current.room, current.serverTime + elapsed);
    if (Math.abs(player.getCurrentTime() - position) > 0.9) player.seekTo(position, true);
    applyLocalVolume(player, volumeRef.current);
    player.playVideo();
    if (!current.room.playing && canControl) {
      void publishStateRef.current({ videoId, playing: true, position });
    }
  };

  const resyncPlayer = () => {
    setPlayerError(null);
    setPlayerReady(false);
    playerUnlockedRef.current = false;
    setPlayerUnlocked(false);
    setPlayerGeneration((current) => current + 1);
    toast.success("Player recarregado com o estado da sala.");
  };

  const changeVolume = (nextVolume: number) => {
    const normalized = Math.max(0, Math.min(100, nextVolume));
    volumeRef.current = normalized;
    setVolume(normalized);
    window.localStorage.setItem("watch-with-me:volume", String(normalized));
    if (playerRef.current) applyLocalVolume(playerRef.current, normalized);
  };

  const toggleMobileMute = () => changeVolume(volume === 0 ? 100 : 0);

  const copyCode = async () => {
    await navigator.clipboard.writeText(session.code);
    toast.success(snapshot.room.secureInvite ? "Código copiado. Esta sala exige o link seguro." : "Código copiado.");
  };

  const copyInvite = async () => {
    const invite = new URL(window.location.href);
    invite.searchParams.set("room", session.code);
    if (snapshot.room.secureInvite && snapshot.room.inviteToken) {
      invite.searchParams.set("token", snapshot.room.inviteToken);
    } else {
      invite.searchParams.delete("token");
    }
    await navigator.clipboard.writeText(invite.toString());
    toast.success("Link de convite copiado.");
  };

  const sendBody = async (body: string, reply = replyingTo) => {
    if (!body.trim() || sendingMessage) return;
    setSendingMessage(true);
    try {
      const result = await sendChatReply(session, body, reply ? {
        messageId: reply.id,
        senderName: reply.senderName,
        body: reply.body,
      } : undefined);
      setSnapshot((current) => ({
        ...current,
        messages: current.messages.some((message) => message.id === result.message.id)
          ? current.messages
          : [...current.messages, result.message].slice(-100),
      }));
      setMessageText("");
      setReplyingTo(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar.");
    } finally {
      setSendingMessage(false);
    }
  };

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    void sendBody(messageText);
  };

  const toggleChatSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    window.localStorage.setItem("watch-with-me:chat-sound", String(next));
    if (next) {
      const context = audioContextRef.current ?? new window.AudioContext();
      audioContextRef.current = context;
      void context.resume();
      toast.success("Som das mensagens ativado.");
    }
  };

  const changeQueue = useCallback(async (
    action:
      | { type: "remove"; itemId: string }
      | { type: "move"; itemId: string; direction: -1 | 1 }
      | { type: "play"; itemId?: string },
  ) => {
    try {
      const result = await updateVideoQueue(session, action);
      setSnapshot(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar a fila.");
    }
  }, [session]);

  useEffect(() => {
    advanceQueueRef.current = () => void changeQueue({ type: "play" });
  }, [changeQueue]);

  const changeSettings = async (settings: Parameters<typeof updateRoomSettings>[1]) => {
    try {
      const result = await updateRoomSettings(session, settings);
      setSnapshot(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar a sala.");
    }
  };

  const retryConnection = async () => {
    setReconnecting(true);
    try {
      const result = await reconnectRoom(session);
      setSnapshot(result);
      if (result.connectionStatus === "connected") toast.success("Conexão restaurada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ainda não foi possível reconectar.");
    } finally {
      setReconnecting(false);
    }
  };

  const exit = async () => {
    try {
      await leaveRoom(session);
    } finally {
      onExit();
    }
  };

  return (
    <main className="room-shell">
      <header className="room-header">
        <Button variant="ghost" size="icon" onClick={() => void exit()} aria-label="Sair da sala">
          <ArrowLeft />
        </Button>
        <div className="room-brand"><Clapperboard /><span>Watch With Me</span></div>
        <div className="header-actions">
          {installAvailable && (
            <Button variant="ghost" size="icon" onClick={onInstall} aria-label="Instalar aplicativo">
              <Download />
            </Button>
          )}
          <Button variant="outline" onClick={() => void copyCode()} className="code-button">
            <span>Sala</span><strong>{session.code}</strong><Copy />
          </Button>
        </div>
      </header>

      <div className="room-grid">
        <section className="player-column">
          <div className="player-frame">
            <div ref={playerHostRef} className="youtube-host" />
            {!snapshot.room.videoId && (
              <div className="player-empty">
                <span><Clapperboard /></span>
                <h1>Sua sessão começa aqui</h1>
                <p>Cole um link do YouTube logo abaixo.</p>
              </div>
            )}
            {snapshot.room.videoId && playerError && (
              <div className="player-error" role="alert">
                <CircleAlert />
                <strong>Não foi possível reproduzir</strong>
                <p>{playerError}</p>
                <Button onClick={resyncPlayer}><RefreshCw /> Tentar novamente</Button>
              </div>
            )}
            {snapshot.room.videoId && !playerError && !playerUnlocked && (
              <button type="button" className="unlock-player" onClick={unlockPlayer}>
                <span><Play /></span>
                <strong>Iniciar vídeo</strong>
                <small>Toque uma vez em cada aparelho</small>
              </button>
            )}
          </div>

          <form className="video-form" onSubmit={(event) => void addVideo(event)}>
            <div className="video-input-wrap">
              <Link2 />
              <Input
                value={videoUrl}
                onChange={(event) => setVideoUrl(event.target.value)}
                placeholder="Cole um link do YouTube"
                aria-label="Link do YouTube"
              />
            </div>
            <Button type="submit" disabled={savingVideo}>
              {savingVideo ? <LoaderCircle className="animate-spin" /> : <Plus />}
              {snapshot.room.videoId ? "Adicionar à fila" : "Adicionar"}
            </Button>
          </form>

          <div className="sync-strip">
            <div className={`sync-status sync-status-${connectionStatus}`}>
              {connectionStatus === "offline" ? <WifiOff /> : connectionStatus === "reconnecting" ? <LoaderCircle className="animate-spin" /> : <Wifi />}
              <span>{CONNECTION_LABEL[connectionStatus]}</span>
            </div>
            {connectionStatus !== "connected" ? (
              <Button variant="ghost" size="sm" onClick={() => void retryConnection()} disabled={reconnecting}>
                <RefreshCw className={reconnecting ? "animate-spin" : ""} /> Tentar novamente
              </Button>
            ) : (
              <small>{snapshot.room.controlMode === "host" ? "Controle do anfitrião" : "Controles compartilhados"}</small>
            )}
            <Button variant="ghost" size="sm" onClick={resyncPlayer} disabled={!snapshot.room.videoId}>
              <RefreshCw /> Ressincronizar
            </Button>
            {mobileAudio ? (
              <div className="mobile-volume-control">
                <Button variant="ghost" size="sm" onClick={toggleMobileMute}>
                  {volume === 0 ? <VolumeX /> : <Volume2 />}
                  {volume === 0 ? "Ativar som" : "Silenciar"}
                </Button>
                <span><Smartphone /> Volume pelos botões do aparelho</span>
              </div>
            ) : (
              <label className="volume-control">
                {volume === 0 ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
                <span className="sr-only">Volume deste aparelho</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={volume}
                  onChange={(event) => changeVolume(Number(event.target.value))}
                  aria-label="Volume deste aparelho"
                />
                <output>{volume}%</output>
              </label>
            )}
          </div>

          <section className="queue-panel" aria-labelledby="queue-title">
            <div className="queue-heading">
              <div><ListVideo /><span><strong id="queue-title">Próximos vídeos</strong><small>{queue.length} na fila</small></span></div>
              <Button variant="ghost" size="sm" onClick={() => void changeQueue({ type: "play" })} disabled={!queue.length || !canControl}>
                <SkipForward /> Próximo
              </Button>
            </div>
            {queue.length === 0 ? (
              <p className="queue-empty">Os links adicionados aparecerão aqui.</p>
            ) : (
              <ol className="queue-list">
                {queue.map((item, index) => (
                  <li key={item.id}>
                    <span className="queue-number">{index + 1}</span>
                    <span className="queue-info">
                      <strong>youtube.com/watch?v={item.videoId}</strong>
                      <small>Adicionado por {item.addedByName}</small>
                    </span>
                    <span className="queue-actions">
                      <Button variant="ghost" size="icon" onClick={() => void changeQueue({ type: "play", itemId: item.id })} disabled={!canControl} aria-label="Reproduzir agora"><Play /></Button>
                      <Button variant="ghost" size="icon" onClick={() => void changeQueue({ type: "move", itemId: item.id, direction: -1 })} disabled={!canControl || index === 0} aria-label="Mover para cima"><ArrowUp /></Button>
                      <Button variant="ghost" size="icon" onClick={() => void changeQueue({ type: "move", itemId: item.id, direction: 1 })} disabled={!canControl || index === queue.length - 1} aria-label="Mover para baixo"><ArrowDown /></Button>
                      <Button variant="ghost" size="icon" onClick={() => void changeQueue({ type: "remove", itemId: item.id })} disabled={!canControl && item.addedBy !== session.participantId} aria-label="Remover da fila"><Trash2 /></Button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </section>

        <aside className="side-panel">
          <section className="people-panel">
            <div className="people-title">
              <span><Users /></span>
              <div><h2>Na sala</h2><p>{snapshot.participants.length} conectado{snapshot.participants.length === 1 ? "" : "s"}</p></div>
            </div>
            <div className="people-list">
              {snapshot.participants.map((participant) => (
                <div className="person-row" key={participant.id}>
                  <span className="avatar">{participant.name.slice(0, 1).toUpperCase()}</span>
                  <span>{participant.name}</span>
                  {participant.id === snapshot.room.hostParticipantId && <Crown aria-label="Anfitrião" />}
                  {participant.id === session.participantId && <small>você</small>}
                  <i aria-label="Online" />
                </div>
              ))}
            </div>
            <div className="invite-actions">
              <Button variant="secondary" onClick={() => void copyCode()}><Copy /> Código {session.code}</Button>
              <Button variant="outline" onClick={() => void copyInvite()} aria-label="Copiar link de convite"><Share2 /> Link</Button>
            </div>

            <details className="room-settings">
              <summary><Settings2 /> Opções da sala</summary>
              <div className="settings-list">
                <button
                  type="button"
                  disabled={!isHost}
                  onClick={() => void changeSettings({ controlMode: snapshot.room.controlMode === "host" ? "everyone" : "host" })}
                >
                  <span><Settings2 /><span><strong>Controle do vídeo</strong><small>{snapshot.room.controlMode === "host" ? "Somente anfitrião" : "Todos podem controlar"}</small></span></span>
                  <b>{snapshot.room.controlMode === "host" ? "Anfitrião" : "Todos"}</b>
                </button>
                <button type="button" disabled={!isHost} onClick={() => void changeSettings({ locked: !snapshot.room.locked })}>
                  <span>{snapshot.room.locked ? <Lock /> : <Unlock />}<span><strong>Novas entradas</strong><small>{snapshot.room.locked ? "Sala fechada" : "Sala aberta"}</small></span></span>
                  <b>{snapshot.room.locked ? "Fechada" : "Aberta"}</b>
                </button>
                <button type="button" disabled={!isHost} onClick={() => void changeSettings({ secureInvite: !snapshot.room.secureInvite })}>
                  <span><ShieldCheck /><span><strong>Link protegido</strong><small>Exige o convite completo</small></span></span>
                  <b>{snapshot.room.secureInvite ? "Ativo" : "Desativado"}</b>
                </button>
              </div>
              {!isHost && <p>Somente o anfitrião pode mudar estas opções.</p>}
            </details>
          </section>

          <section className="chat-panel" aria-labelledby="chat-title" onFocus={() => setUnreadCount(0)}>
            <div className="chat-title">
              <span><MessageCircle /></span>
              <div><h2 id="chat-title">Chat {unreadCount > 0 && <b>{unreadCount}</b>}</h2><p>Converse enquanto assiste</p></div>
              <Button variant="ghost" size="icon" onClick={toggleChatSound} aria-label={soundEnabled ? "Desativar som das mensagens" : "Ativar som das mensagens"}>
                {soundEnabled ? <Bell /> : <BellOff />}
              </Button>
            </div>
            <div className="quick-reactions" aria-label="Reações rápidas">
              {["❤️", "😂", "👏", "Pausa aí ✋"].map((reaction) => (
                <button key={reaction} type="button" onClick={() => void sendBody(reaction, null)}>{reaction}</button>
              ))}
            </div>
            <div className="message-list" aria-live="polite">
              {snapshot.messages.length === 0 ? (
                <div className="chat-empty"><MessageCircle /><p>Nenhuma mensagem ainda.</p></div>
              ) : (
                snapshot.messages.map((message) => {
                  const own = message.participantId === session.participantId;
                  return (
                    <article className={`chat-message${own ? " chat-message-own" : ""}`} key={message.id}>
                      <div>
                        <strong>{own ? "Você" : message.senderName}</strong>
                        <time dateTime={new Date(message.createdAt).toISOString()}>
                          {new Date(message.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </time>
                        {own && message.delivery === "pending" ? <LoaderCircle className="message-pending" aria-label="Enviando" /> : own ? <Check className="message-sent" aria-label="Enviada" /> : null}
                      </div>
                      {message.replyTo && (
                        <blockquote><strong>{message.replyTo.senderName}</strong><span>{message.replyTo.body}</span></blockquote>
                      )}
                      <p>{message.body}</p>
                      <button type="button" className="reply-button" onClick={() => setReplyingTo(message)}><Reply /> Responder</button>
                    </article>
                  );
                })
              )}
              <div ref={messageEndRef} />
            </div>
            {replyingTo && (
              <div className="replying-banner">
                <Reply />
                <span><strong>Respondendo a {replyingTo.participantId === session.participantId ? "você" : replyingTo.senderName}</strong><small>{replyingTo.body}</small></span>
                <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancelar resposta">×</button>
              </div>
            )}
            <form className="chat-form" onSubmit={sendMessage}>
              <Input
                value={messageText}
                onChange={(event) => setMessageText(event.target.value.slice(0, 360))}
                placeholder="Escreva uma mensagem"
                aria-label="Mensagem"
                autoComplete="off"
              />
              <Button type="submit" size="icon" disabled={!messageText.trim() || sendingMessage} aria-label="Enviar mensagem">
                {sendingMessage ? <LoaderCircle className="animate-spin" /> : <Send />}
              </Button>
            </form>
          </section>
        </aside>
      </div>
    </main>
  );
}

export default function WatchWithMe() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [session, setSession] = useState<RoomSession | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const restoreStartedRef = useRef(false);

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    if ("serviceWorker" in navigator) {
      const base = window.location.pathname.startsWith("/Watch-with-me/")
        ? "/Watch-with-me/"
        : "/";
      void navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
    }
    return () => window.removeEventListener("beforeinstallprompt", capturePrompt);
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  };

  const establishSession = useCallback((
    result: EnterResult,
    cleanName: string,
    requestedRole: "create" | "join",
  ) => {
    const role = result.sessionRole ?? requestedRole;
    const inviteToken = result.inviteToken ?? result.room.inviteToken;
    window.localStorage.setItem("watch-with-me:name", cleanName);
    window.localStorage.setItem("watch-with-me:room-session", JSON.stringify({
      role,
      name: cleanName,
      code: result.room.code,
      inviteToken,
      savedAt: Date.now(),
    } satisfies StoredRoomSession));
    setSession({ participantId: result.participantId, name: cleanName, code: result.room.code, inviteToken });
    setSnapshot({
      room: result.room,
      participants: result.participants,
      messages: result.messages,
      queue: result.queue ?? [],
      serverTime: result.serverTime,
      connectionStatus: result.connectionStatus ?? "connected",
    });
    const roomUrl = new URL(window.location.href);
    roomUrl.searchParams.set("room", result.room.code);
    if (result.room.secureInvite && inviteToken) roomUrl.searchParams.set("token", inviteToken);
    window.history.replaceState(null, "", roomUrl);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (restoreStartedRef.current) return;
      restoreStartedRef.current = true;
      const savedName = window.localStorage.getItem("watch-with-me:name") ?? "";
      setName(savedName);
      const search = new URLSearchParams(window.location.search);
      const invitedRoom = search.get("room");
      const invitedToken = search.get("token") ?? undefined;
      if (invitedRoom && /^\d{4}$/.test(invitedRoom)) setCode(invitedRoom);
      const storedValue = window.localStorage.getItem("watch-with-me:room-session");
      if (!storedValue || !invitedRoom) return;

      try {
        const stored = JSON.parse(storedValue) as StoredRoomSession;
        const stillRecent = Date.now() - stored.savedAt < 6 * 60 * 60 * 1000;
        if (
          !stillRecent || stored.code !== invitedRoom || !/^\d{4}$/.test(stored.code) ||
          (stored.role !== "create" && stored.role !== "join")
        ) return;

        setName(stored.name);
        setBusy(stored.role);
        const token = invitedToken ?? stored.inviteToken;
        void enterRoom(stored.role, stored.name, stored.code, token, true)
          .then((result) => establishSession(result, stored.name, stored.role))
          .catch(() => {
            window.localStorage.removeItem("watch-with-me:room-session");
            toast.error("Não foi possível restaurar a sala. Entre novamente pelo código.");
          })
          .finally(() => setBusy(null));
      } catch {
        window.localStorage.removeItem("watch-with-me:room-session");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [establishSession]);

  const handleEnter = async (action: "create" | "join") => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) {
      toast.error("Digite seu nome primeiro.");
      return;
    }
    if (action === "join" && code.length !== 4) {
      toast.error("Digite os quatro números da sala.");
      return;
    }

    setBusy(action);
    try {
      const inviteToken = new URLSearchParams(window.location.search).get("token") ?? undefined;
      const result = await enterRoom(action, clean, action === "join" ? code : undefined, inviteToken);
      establishSession(result, clean, action);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível entrar.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {session && snapshot ? (
        <WatchRoom
          session={session}
          initialSnapshot={snapshot}
          installAvailable={Boolean(installPrompt)}
          onInstall={() => void installApp()}
          onExit={() => {
            window.localStorage.removeItem("watch-with-me:room-session");
            setSession(null);
            setSnapshot(null);
            setCode("");
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete("room");
            cleanUrl.searchParams.delete("token");
            window.history.replaceState(null, "", cleanUrl);
          }}
        />
      ) : (
        <Landing
          name={name}
          setName={setName}
          code={code}
          setCode={setCode}
          busy={busy}
          installAvailable={Boolean(installPrompt)}
          onInstall={() => void installApp()}
          onEnter={(action) => void handleEnter(action)}
        />
      )}
      <Toaster richColors position="top-center" />
    </>
  );
}
