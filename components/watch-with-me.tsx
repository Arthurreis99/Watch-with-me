"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Clapperboard,
  Copy,
  Link2,
  LoaderCircle,
  LogIn,
  Play,
  Plus,
  Radio,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Toaster } from "@/components/ui/sonner";
import {
  enterRoom,
  getRoom,
  heartbeat,
  leaveRoom,
  Room,
  RoomSession,
  RoomSnapshot,
  updateRoomState,
} from "@/lib/room-api";

type YTEvent = { data: number; target: YTPlayer };

type YTPlayer = {
  cueVideoById(videoId: string): void;
  destroy(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  getVideoData(): { video_id?: string };
  mute(): void;
  pauseVideo(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
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
        onAutoplayBlocked(): void;
      };
    },
  ) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; BUFFERING: number };
};

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

function extractYouTubeId(value: string) {
  const raw = value.trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? null;
    if (host.endsWith("youtube.com")) {
      if (url.searchParams.get("v")) return url.searchParams.get("v");
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0])) return parts[1] ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

function targetPosition(room: Room, serverTime: number) {
  if (!room.playing) return room.position;
  return room.position + Math.max(0, serverTime - room.updatedAt) / 1000;
}

function Landing({
  name,
  setName,
  code,
  setCode,
  busy,
  onEnter,
}: {
  name: string;
  setName(value: string): void;
  code: string;
  setCode(value: string): void;
  busy: "create" | "join" | null;
  onEnter(action: "create" | "join"): void;
}) {
  return (
    <main className="landing-shell">
      <section className="entry-panel" aria-labelledby="page-title">
        <div className="brand-mark" aria-hidden="true">
          <Clapperboard />
        </div>
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
            <div>
              <h2>Criar uma sala</h2>
              <p>Receba um código novo de quatro números.</p>
            </div>
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
            <div>
              <h2>Entrar em uma sala</h2>
              <p>Digite o código que você recebeu.</p>
            </div>
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

        <p className="entry-note"><Radio /> Salas vazias expiram automaticamente.</p>
      </section>
    </main>
  );
}

function WatchRoom({
  session,
  initialSnapshot,
  onExit,
}: {
  session: RoomSession;
  initialSnapshot: RoomSnapshot;
  onExit(): void;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [videoUrl, setVideoUrl] = useState("");
  const [playerReady, setPlayerReady] = useState(false);
  const [playerUnlocked, setPlayerUnlocked] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const snapshotRef = useRef(snapshot);
  const suppressEventsUntilRef = useRef(0);
  const lastSampleRef = useRef({ media: 0, wall: 0, state: -1 });
  const snapshotReceivedAtRef = useRef(0);

  useEffect(() => {
    snapshotRef.current = snapshot;
    snapshotReceivedAtRef.current = Date.now();
  }, [snapshot]);

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
            setPlayerReady(true);
            const current = snapshotRef.current;
            if (current.room.videoId) {
              suppressEventsUntilRef.current = Date.now() + 1_200;
              target.cueVideoById(current.room.videoId);
              const elapsed = Math.max(0, Date.now() - snapshotReceivedAtRef.current);
              target.seekTo(targetPosition(current.room, current.serverTime + elapsed), true);
              if (current.room.playing) target.playVideo();
            }
          },
          onStateChange: ({ data, target }) => {
            if (Date.now() < suppressEventsUntilRef.current) return;
            const current = snapshotRef.current;
            if (!current.room.videoId) return;
            if (data === YT.PlayerState.PLAYING || data === YT.PlayerState.PAUSED) {
              void publishStateRef.current({
                videoId: current.room.videoId,
                playing: data === YT.PlayerState.PLAYING,
                position: target.getCurrentTime(),
              });
            }
          },
          onAutoplayBlocked: () => setPlayerUnlocked(false),
        },
      });
    });

    return () => {
      cancelled = true;
      player?.destroy();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    const { room, serverTime } = snapshotRef.current;
    if (!player || !playerReady || !room.videoId) return;

    suppressEventsUntilRef.current = Date.now() + 900;
    const loadedVideo = player.getVideoData().video_id;
    if (loadedVideo !== room.videoId) player.cueVideoById(room.videoId);
    const target = targetPosition(room, serverTime);
    if (Math.abs(player.getCurrentTime() - target) > 0.9) player.seekTo(target, true);
    if (room.playing) player.playVideo();
    else player.pauseVideo();
  }, [snapshot.room.version, playerReady]);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const next = await getRoom(session.code);
        if (!stopped) setSnapshot(next);
      } catch (error) {
        if (!stopped) toast.error(error instanceof Error ? error.message : "Sala desconectada.");
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
      const previous = lastSampleRef.current;
      const expectedLocal = previous.media + (previous.state === 1 ? (wall - previous.wall) / 1000 : 0);

      if (previous.state !== -1 && Math.abs(media - expectedLocal) > 2.2) {
        void publishStateRef.current({
          videoId: current.room.videoId,
          playing: state === 1,
          position: media,
        });
      } else if (state !== 3) {
        const elapsed = snapshotReceivedAtRef.current
          ? Math.max(0, wall - snapshotReceivedAtRef.current)
          : 0;
        const remoteTarget = targetPosition(current.room, current.serverTime + elapsed);
        if (Math.abs(media - remoteTarget) > 1.6) {
          suppressEventsUntilRef.current = wall + 700;
          player.seekTo(remoteTarget, true);
        }
      }

      lastSampleRef.current = { media, wall, state };
    }, 900);

    return () => window.clearInterval(timer);
  }, []);

  const addVideo = async (event: FormEvent) => {
    event.preventDefault();
    const videoId = extractYouTubeId(videoUrl);
    if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
      toast.error("Cole um link válido do YouTube.");
      return;
    }

    setSavingVideo(true);
    await publishState({ videoId, playing: false, position: 0 });
    setVideoUrl("");
    setSavingVideo(false);
    toast.success("Vídeo adicionado à sala.");
  };

  const unlockPlayer = () => {
    const player = playerRef.current;
    if (!player) return;
    player.unMute();
    player.playVideo();
    if (!snapshot.room.playing) player.pauseVideo();
    setPlayerUnlocked(true);
  };

  const copyCode = async () => {
    await navigator.clipboard.writeText(session.code);
    toast.success("Código copiado.");
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
        <Button variant="outline" onClick={() => void copyCode()} className="code-button">
          <span>Sala</span><strong>{session.code}</strong><Copy />
        </Button>
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
            {snapshot.room.videoId && !playerUnlocked && (
              <button type="button" className="unlock-player" onClick={unlockPlayer}>
                <span><Play /></span>
                <strong>Ativar reprodução</strong>
                <small>Necessário uma vez em cada aparelho</small>
              </button>
            )}
          </div>

          <form className="video-form" onSubmit={(event) => void addVideo(event)}>
            <div className="video-input-wrap">
              <Link2 />
              <Input
                value={videoUrl}
                onChange={(event) => setVideoUrl(event.target.value)}
                placeholder="Cole o link do YouTube"
                aria-label="Link do YouTube"
              />
            </div>
            <Button type="submit" disabled={savingVideo}>
              {savingVideo ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Adicionar
            </Button>
          </form>

          <div className="sync-strip">
            <span className="sync-dot" />
            <span>Sincronização ativa</span>
            <small>Play, pausa e avanço são compartilhados</small>
          </div>
        </section>

        <aside className="people-panel">
          <div className="people-title">
            <span><Users /></span>
            <div><h2>Na sala</h2><p>{snapshot.participants.length} conectado{snapshot.participants.length === 1 ? "" : "s"}</p></div>
          </div>
          <div className="people-list">
            {snapshot.participants.map((participant) => (
              <div className="person-row" key={participant.id}>
                <span className="avatar">{participant.name.slice(0, 1).toUpperCase()}</span>
                <span>{participant.name}</span>
                {participant.id === session.participantId && <small>você</small>}
                <i aria-label="Online" />
              </div>
            ))}
          </div>
          <div className="room-code-card">
            <p>Código da sala</p>
            <strong>{session.code}</strong>
            <Button variant="secondary" onClick={() => void copyCode()}>
              <Copy /> Copiar código
            </Button>
          </div>
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setName(window.localStorage.getItem("watch-with-me:name") ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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
      const result = await enterRoom(action, clean, action === "join" ? code : undefined);
      window.localStorage.setItem("watch-with-me:name", clean);
      setSession({ participantId: result.participantId, name: clean, code: result.room.code });
      setSnapshot({ room: result.room, participants: result.participants, serverTime: result.serverTime });
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
          onExit={() => {
            setSession(null);
            setSnapshot(null);
            setCode("");
          }}
        />
      ) : (
        <Landing
          name={name}
          setName={setName}
          code={code}
          setCode={setCode}
          busy={busy}
          onEnter={(action) => void handleEnter(action)}
        />
      )}
      <Toaster richColors position="top-center" />
    </>
  );
}
