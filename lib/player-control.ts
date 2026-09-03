import type { Room } from "@/lib/room-api";

export function playerVolumeForUi(volume: number) {
  const normalized = Math.max(0, Math.min(100, volume));
  return Math.round((normalized / 100) ** 2 * 100);
}

export type YouTubeVideoRequest = {
  videoId: string;
  startSeconds?: number;
};

export type ControllableYouTubePlayer = {
  cueVideoById(video: string | YouTubeVideoRequest): void;
  getCurrentTime(): number;
  getVideoData(): { video_id?: string };
  loadVideoById(video: string | YouTubeVideoRequest): void;
  pauseVideo(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
};

export type VolumeControllablePlayer = {
  mute(): void;
  setVolume(volume: number): void;
  unMute(): void;
};

export function applyPlayerVolume(player: VolumeControllablePlayer, uiVolume: number) {
  const mappedVolume = playerVolumeForUi(uiVolume);
  if (mappedVolume === 0) {
    player.mute();
    return mappedVolume;
  }

  player.unMute();
  player.setVolume(mappedVolume);
  return mappedVolume;
}

export function playbackTargetPosition(
  room: Pick<Room, "playing" | "position" | "updatedAt">,
  serverTime: number,
) {
  const elapsed = room.playing ? Math.max(0, serverTime - room.updatedAt) / 1000 : 0;
  return Math.max(0, room.position + elapsed);
}

export function syncYouTubePlayer(
  player: ControllableYouTubePlayer,
  room: Pick<Room, "videoId" | "playing" | "position" | "updatedAt">,
  serverTime: number,
  options: {
    allowPlayback: boolean;
    forceReload?: boolean;
    seekTolerance?: number;
  },
) {
  if (!room.videoId) return { action: "empty" as const, target: 0 };

  const target = playbackTargetPosition(room, serverTime);
  const loadedVideoId = player.getVideoData().video_id;
  const mustLoad = options.forceReload || loadedVideoId !== room.videoId;
  const request: YouTubeVideoRequest = { videoId: room.videoId, startSeconds: target };

  if (mustLoad) {
    if (room.playing && options.allowPlayback) {
      player.loadVideoById(request);
      return { action: "load" as const, target };
    }

    player.cueVideoById(request);
    return { action: "cue" as const, target };
  }

  const tolerance = options.seekTolerance ?? 0.9;
  if (Math.abs(player.getCurrentTime() - target) > tolerance) {
    player.seekTo(target, true);
  }

  if (room.playing && options.allowPlayback) {
    player.playVideo();
    return { action: "play" as const, target };
  }

  player.pauseVideo();
  return { action: "pause" as const, target };
}
