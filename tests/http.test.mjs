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
import { mergeMessages } from "../lib/p2p-room-api.ts";

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
