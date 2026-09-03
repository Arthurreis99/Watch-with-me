import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanMessage,
  cleanName,
  safePosition,
  validCode,
  validParticipantId,
  validVideoId,
} from "../app/api/http.ts";
import { hostElectionDelay, mergeMessages } from "../lib/p2p-room-api.ts";
import {
  applyPlayerVolume,
  playbackTargetPosition,
  playerVolumeForUi,
  syncYouTubePlayer,
} from "../lib/player-control.ts";
import {
  extractYouTubeId,
  youtubeErrorMessage,
} from "../lib/watch-utils.ts";

test("normaliza nomes e mensagens antes de persistir", () => {
  assert.equal(cleanName("  Ana   Maria  "), "Ana Maria");
  assert.equal(cleanMessage("  Olá\n\n  pessoal!  "), "Olá pessoal!");
  assert.equal(cleanMessage("x".repeat(500)).length, 360);
  assert.equal(cleanMessage(null), "");
});

test("valida identificadores recebidos pela API", () => {
  assert.equal(validCode("0427"), true);
  assert.equal(validCode("427"), false);
  assert.equal(validVideoId("dQw4w9WgXcQ"), true);
  assert.equal(validVideoId(null), true);
  assert.equal(validVideoId("https://youtu.be/dQw4w9WgXcQ"), false);
  assert.equal(validParticipantId("aa233f12-9b18-4551-86ae-d9adf75a956b"), true);
  assert.equal(validParticipantId("participante"), false);
});

test("limita posições inválidas do player", () => {
  assert.equal(safePosition(-8), 0);
  assert.equal(safePosition("12.5"), 12.5);
  assert.equal(safePosition(Number.NaN), 0);
  assert.equal(safePosition(999_999), 604_800);
});

test("preserva mensagens locais durante a reconexão sem duplicar o chat", () => {
  const confirmed = {
    id: "mensagem-1",
    participantId: "participante-1",
    senderName: "Ana",
    body: "Oi",
    createdAt: 10,
  };
  const pending = {
    id: "mensagem-2",
    participantId: "participante-2",
    senderName: "Arthur",
    body: "Olá",
    createdAt: 20,
  };

  assert.deepEqual(
    mergeMessages([confirmed], [confirmed, pending]).map((message) => message.id),
    ["mensagem-1", "mensagem-2"],
  );
});

test("aplica uma curva de volume perceptível sem alterar os extremos", () => {
  assert.equal(playerVolumeForUi(0), 0);
  assert.equal(playerVolumeForUi(20), 4);
  assert.equal(playerVolumeForUi(50), 25);
  assert.equal(playerVolumeForUi(100), 100);
});

test("aplica o volume local pelo player em qualquer tipo de aparelho", () => {
  const calls = [];
  const player = {
    mute() { calls.push(["mute"]); },
    setVolume(value) { calls.push(["volume", value]); },
    unMute() { calls.push(["unmute"]); },
  };

  assert.equal(applyPlayerVolume(player, 50), 25);
  assert.deepEqual(calls, [["unmute"], ["volume", 25]]);
  calls.length = 0;
  assert.equal(applyPlayerVolume(player, 0), 0);
  assert.deepEqual(calls, [["mute"]]);
});

function fakePlayer(videoId = "") {
  const calls = [];
  return {
    calls,
    cueVideoById(video) { calls.push(["cue", video]); },
    getCurrentTime() { return 12; },
    getVideoData() { return { video_id: videoId }; },
    loadVideoById(video) { calls.push(["load", video]); },
    pauseVideo() { calls.push(["pause"]); },
    playVideo() { calls.push(["play"]); },
    seekTo(position) { calls.push(["seek", position]); },
  };
}

test("calcula a posição atual para quem entra depois do início", () => {
  const room = { playing: true, position: 20, updatedAt: 1_000 };
  assert.equal(playbackTargetPosition(room, 6_500), 25.5);
  assert.equal(playbackTargetPosition({ ...room, playing: false }, 6_500), 20);
});

test("entrada tardia prepara o vídeo sem violar o bloqueio de autoplay", () => {
  const player = fakePlayer();
  const result = syncYouTubePlayer(
    player,
    { videoId: "dQw4w9WgXcQ", playing: true, position: 20, updatedAt: 1_000 },
    6_000,
    { allowPlayback: false, forceReload: true },
  );

  assert.equal(result.action, "cue");
  assert.deepEqual(player.calls, [["cue", { videoId: "dQw4w9WgXcQ", startSeconds: 25 }]]);
});

test("ressincronização iniciada pelo usuário recarrega e reproduz na posição correta", () => {
  const player = fakePlayer("dQw4w9WgXcQ");
  const result = syncYouTubePlayer(
    player,
    { videoId: "dQw4w9WgXcQ", playing: true, position: 30, updatedAt: 10_000 },
    12_500,
    { allowPlayback: true, forceReload: true },
  );

  assert.equal(result.action, "load");
  assert.deepEqual(player.calls, [["load", { videoId: "dQw4w9WgXcQ", startSeconds: 32.5 }]]);
});

test("aceita os formatos comuns de link do YouTube", () => {
  assert.equal(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeId("https://youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeId("não é um vídeo"), null);
});

test("explica os principais erros de incorporação do YouTube", () => {
  assert.match(youtubeErrorMessage(100), /removido|privado/i);
  assert.match(youtubeErrorMessage(150), /não permite/i);
});

test("escalona a eleição do novo anfitrião sem corrida entre participantes", () => {
  const participants = ["host", "pessoa-b", "pessoa-a"];
  assert.equal(hostElectionDelay(participants, "host", "pessoa-a"), 1_400);
  assert.equal(hostElectionDelay(participants, "host", "pessoa-b"), 2_250);
});
