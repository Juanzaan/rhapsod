import { describe, expect, it, vi } from "vitest";

import { ChatCommandGate } from "../src/bootstrap/chat-commands.js";
import type { CommandContext } from "../src/commands/command-handlers.js";
import { UserError } from "../src/lib/user-error.js";
import { noopLogger } from "../src/observability/logger.js";

function harness(
  options: {
    allowed?: boolean;
    canTalk?: boolean;
    maxConcurrent?: number;
    privateUids?: readonly string[];
  } = {},
) {
  let now = 100_000;
  const connection = {
    sendChannelMessage: vi.fn(() => Promise.resolve()),
    sendPrivateMessage: vi.fn(() => Promise.resolve()),
  };
  const telemetry = { recordCommand: vi.fn() };
  const context = {
    commandRateLimiter: {
      acquire: vi.fn(() => ({
        allowed: options.allowed ?? true,
        retryAfterMs: 1_200,
      })),
    },
    connection,
    telemetry,
  } as unknown as CommandContext;
  const dispatch = vi.fn(
    (
      _context: CommandContext,
      _command: unknown,
      _sender: unknown,
      send: (text: string) => Promise<void>,
    ) => send("ok"),
  );
  const gate = new ChatCommandGate({
    canTalk: () => options.canTalk ?? true,
    context,
    dispatch,
    logger: noopLogger,
    maxConcurrent: options.maxConcurrent ?? 3,
    now: () => now,
    privateCommandUids: new Set(options.privateUids ?? []),
  });
  const receive = (message: string, extra: { isPrivate?: boolean } = {}) =>
    gate.receive({
      invokerClid: 42,
      isPrivate: extra.isPrivate ?? false,
      message,
      senderGroups: ["7"],
      senderName: "Ana",
      senderUid: "uid-ana",
    });
  return {
    advance: (ms: number) => (now += ms),
    connection,
    context,
    dispatch,
    receive,
    telemetry,
  };
}

describe("ChatCommandGate", () => {
  it("ignores chat that is not a command", async () => {
    const { dispatch, receive, telemetry } = harness();
    await receive("hola");
    expect(dispatch).not.toHaveBeenCalled();
    expect(telemetry.recordCommand).not.toHaveBeenCalled();
  });

  it("dispatches a command and answers in the channel", async () => {
    const { connection, dispatch, receive } = harness();
    await receive("!np");
    expect(dispatch).toHaveBeenCalledWith(
      expect.anything(),
      { name: "now-playing" },
      { groups: ["7"], name: "Ana", uid: "uid-ana" },
      expect.any(Function),
    );
    expect(connection.sendChannelMessage).toHaveBeenCalledWith("ok");
  });

  it("answers privately only to uids allowed to use private commands", async () => {
    const allowed = harness({ privateUids: ["uid-ana"] });
    await allowed.receive("!np", { isPrivate: true });
    expect(allowed.connection.sendPrivateMessage).toHaveBeenCalledWith(
      42,
      "ok",
    );

    const other = harness();
    await other.receive("!np", { isPrivate: true });
    expect(other.connection.sendPrivateMessage).not.toHaveBeenCalled();
    expect(other.connection.sendChannelMessage).toHaveBeenCalledWith("ok");
  });

  it("accepts only !channel-move while muted, warning once per 10 s", async () => {
    const { advance, connection, dispatch, receive } = harness({
      canTalk: false,
    });
    await receive("!np");
    await receive("!np");
    expect(dispatch).not.toHaveBeenCalled();
    expect(connection.sendChannelMessage).toHaveBeenCalledTimes(1);
    advance(10_001);
    await receive("!np");
    expect(connection.sendChannelMessage).toHaveBeenCalledTimes(2);

    await receive("!channel-move Music");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("tells a rate-limited user to wait, once per 5 s", async () => {
    const { connection, dispatch, receive } = harness({ allowed: false });
    await receive("!np");
    await receive("!np");
    expect(dispatch).not.toHaveBeenCalled();
    expect(connection.sendChannelMessage).toHaveBeenCalledTimes(1);
    expect(connection.sendChannelMessage).toHaveBeenCalledWith(
      "Esperá un momento entre comandos (2 s).",
    );
  });

  it("turns commands away while the concurrency cap is reached", async () => {
    const { connection, dispatch, receive } = harness({ maxConcurrent: 1 });
    let finish = (): void => undefined;
    dispatch.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const first = receive("!np");
    await receive("!np");
    expect(connection.sendChannelMessage).toHaveBeenCalledWith(
      "El bot está procesando varios pedidos a la vez; probá de nuevo en unos segundos.",
    );
    finish();
    await first;
    await receive("!np");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("reports failures with a user-facing message", async () => {
    const { connection, dispatch, receive } = harness();
    dispatch.mockRejectedValueOnce(new UserError("No hay nada sonando."));
    await receive("!np");
    expect(connection.sendChannelMessage).toHaveBeenLastCalledWith(
      "No hay nada sonando.",
    );

    dispatch.mockRejectedValueOnce(new Error("socket hang up"));
    await receive("!np");
    expect(connection.sendChannelMessage).toHaveBeenLastCalledWith(
      "Ocurrió un error. Probá de nuevo en unos segundos.",
    );
  });
});
