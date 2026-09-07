import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@honeybbq/teamspeak-client", () => {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();

  const client = {
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    waitConnected: vi.fn(() => Promise.resolve()),
    execCommand: vi.fn(() => Promise.resolve()),
    execCommandWithResponse: vi.fn((): Promise<Record<string, string>[]> =>
      Promise.resolve([]),
    ),
    clientID: vi.fn(() => 42),
    channelID: vi.fn(() => 7n),
    sendVoice: vi.fn(),
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    }),
  };

  const Client = vi.fn(function FakeClient() {
    return client;
  });

  const listChannels = vi.fn(
    (): Promise<readonly { id: bigint; name: string; parentID?: bigint }[]> =>
      Promise.resolve([]),
  );

  const listClients = vi.fn(
    (): Promise<
      readonly {
        id: number;
        nickname: string;
        uid: string;
        type: number;
        channelID: bigint;
        serverGroups: readonly string[];
      }[]
    > => Promise.resolve([]),
  );

  const emit = (event: string, payload: unknown): void => {
    for (const handler of listeners.get(event) ?? []) handler(payload);
  };

  return {
    Client,
    listChannels,
    listClients,
    __client: client,
    __emit: emit,
    __ClientMock: Client,
  };
});

import type { AppConfig } from "../src/config.js";
import type { Logger } from "pino";
import type { Identity } from "@honeybbq/teamspeak-client";
import { createTs3Connection } from "../src/adapters/ts3/ts3-connection.js";

interface Ts3ClientMock {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  waitConnected: ReturnType<typeof vi.fn>;
  execCommand: ReturnType<typeof vi.fn>;
  execCommandWithResponse: ReturnType<typeof vi.fn>;
  clientID: () => number;
  channelID: () => bigint;
  sendVoice: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

interface Ts3ModuleMock {
  listChannels: ReturnType<typeof vi.fn>;
  listClients: ReturnType<typeof vi.fn>;
  __client: Ts3ClientMock;
  __emit: (event: string, payload: unknown) => void;
  __ClientMock: ReturnType<typeof vi.fn>;
}

async function ts3Mock(): Promise<Ts3ModuleMock> {
  return (await import("@honeybbq/teamspeak-client")) as unknown as Ts3ModuleMock;
}

function testConfig(overrides: Record<string, unknown> = {}): AppConfig {
  return {
    RHAPSOD_TS3_HOST: "ts.example.com",
    RHAPSOD_TS3_PORT: 9987,
    RHAPSOD_TS3_NICKNAME: "Bot",
    RHAPSOD_TS3_CHANNEL_NAME: undefined,
    RHAPSOD_TS3_CHANNEL_PASSWORD: undefined,
    RHAPSOD_TS3_PASSWORD: undefined,
    RHAPSOD_TS3_CLIENT_DESCRIPTION: undefined,
    RHAPSOD_TS3_CHANNEL_ID: undefined,
    RHAPSOD_TS3_HEARTBEAT_SECONDS: 0,
    RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS: 60,
    ...overrides,
  } as unknown as AppConfig;
}

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

const identity = {} as Identity;

// The mock is module-level, so every test starts from a clean slate.
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createTs3Connection.connect", () => {
  it("connects and waits for the connected state", async () => {
    const m = await ts3Mock();
    const connection = createTs3Connection(testConfig(), identity, logger);
    await connection.connect();
    expect(m.__client.connect).toHaveBeenCalledTimes(1);
    expect(m.__client.waitConnected).toHaveBeenCalledTimes(1);
  });

  it("disconnects cleanly when waitConnected throws", async () => {
    const m = await ts3Mock();
    m.__client.waitConnected.mockRejectedValueOnce(
      new Error("handshake timeout"),
    );
    const connection = createTs3Connection(testConfig(), identity, logger);
    await expect(connection.connect()).rejects.toThrow("handshake timeout");
    expect(m.__client.disconnect).toHaveBeenCalledTimes(1);
  });

  it("moves to the configured channel id after connecting", async () => {
    const m = await ts3Mock();
    const connection = createTs3Connection(
      testConfig({ RHAPSOD_TS3_CHANNEL_ID: 110 }),
      identity,
      logger,
    );
    await connection.connect();
    expect(m.__client.execCommand).toHaveBeenCalledWith(
      "clientmove clid=42 cid=110",
    );
  });

  it("keeps the connection alive when the channel move is refused", async () => {
    const m = await ts3Mock();
    m.__client.execCommand.mockRejectedValueOnce(
      new Error("insufficient client permissions"),
    );
    const connection = createTs3Connection(
      testConfig({ RHAPSOD_TS3_CHANNEL_ID: 110 }),
      identity,
      logger,
    );
    await expect(connection.connect()).resolves.toBeUndefined();
  });

  it("sets the client description when configured", async () => {
    const m = await ts3Mock();
    const connection = createTs3Connection(
      testConfig({ RHAPSOD_TS3_CLIENT_DESCRIPTION: "music bot" }),
      identity,
      logger,
    );
    await connection.connect();
    expect(m.__client.execCommand).toHaveBeenCalledWith(
      "clientset client_description=music\\sbot",
    );
  });

  it("passes the server password through to the client options", async () => {
    const m = await ts3Mock();
    createTs3Connection(
      testConfig({
        RHAPSOD_TS3_PASSWORD: "secret",
        RHAPSOD_TS3_CHANNEL_NAME: "Music",
      }),
      identity,
      logger,
    );
    const call = m.__ClientMock.mock.calls[0];
    expect(call).toBeDefined();
    const options = call?.[3] as Record<string, unknown> | undefined;
    expect(options).toMatchObject({
      serverPassword: "secret",
      defaultChannel: "Music",
    });
  });
});

describe("createTs3Connection events", () => {
  it("forwards clientMoved with the self flag", async () => {
    const m = await ts3Mock();
    const connection = createTs3Connection(testConfig(), identity, logger);
    const events: { self: boolean; movedClid: number }[] = [];
    connection.onClientMoved((event) => events.push(event));
    m.__emit("clientMoved", {
      id: 42,
      targetChannelID: 9n,
      invokerName: "admin",
      invokerUID: "uid1",
      invokerID: 1,
    });
    m.__emit("clientMoved", {
      id: 43,
      targetChannelID: 9n,
      invokerName: "admin",
      invokerUID: "uid1",
      invokerID: 1,
    });
    expect(events.map((e) => e.self)).toEqual([true, false]);
  });

  it("ignores non-client entries on clientEnter", async () => {
    const m = await ts3Mock();
    const connection = createTs3Connection(testConfig(), identity, logger);
    const events: { clid: number }[] = [];
    connection.onClientEnter((event) => events.push(event));
    m.__emit("clientEnter", {
      id: 5,
      nickname: "query",
      uid: "u",
      type: 1,
      channelID: 1n,
      serverGroups: [],
    });
    m.__emit("clientEnter", {
      id: 6,
      nickname: "user",
      uid: "u2",
      type: 0,
      channelID: 1n,
      serverGroups: [],
    });
    expect(events.map((e) => e.clid)).toEqual([6]);
  });

  it("ignores the bot leaving on clientLeave", async () => {
    const m = await ts3Mock();
    const connection = createTs3Connection(testConfig(), identity, logger);
    const left: number[] = [];
    connection.onClientLeave((clid) => left.push(clid));
    m.__emit("clientLeave", { id: 42 });
    m.__emit("clientLeave", { id: 43 });
    expect(left).toEqual([43]);
  });

  it("reports kicked and disconnected as connection lost", async () => {
    const m = await ts3Mock();
    const connection = createTs3Connection(testConfig(), identity, logger);
    const reasons: string[] = [];
    connection.onConnectionLost((reason) => reasons.push(reason));
    m.__emit("kicked", "reason");
    m.__emit("disconnected", undefined);
    expect(reasons).toEqual(["kicked", "disconnected"]);
  });

  it("unwraps text messages with their sender metadata", async () => {
    const m = await ts3Mock();
    const connection = createTs3Connection(testConfig(), identity, logger);
    const seen: unknown[] = [];
    connection.onTextMessage((...args) => seen.push(args));
    m.__emit("textMessage", {
      message: "!play test",
      invokerUID: "uid9",
      invokerName: "juan",
      invokerGroups: ["13"],
      targetMode: 2,
      invokerID: 3,
    });
    expect(seen[0]).toEqual(["!play test", "uid9", "juan", ["13"], false, 3]);
  });
});

describe("createTs3Connection messaging", () => {
  it("escapes TeamSpeak-special characters in channel messages", async () => {
    const m = await ts3Mock();
    const connection = createTs3Connection(testConfig(), identity, logger);
    await connection.sendChannelMessage("hola a todos\n");
    const cmd = m.__client.execCommand.mock.calls[0]?.[0] as string;
    expect(cmd).toBe(
      "sendtextmessage targetmode=2 target=7 msg=hola\\sa\\stodos\\n",
    );
  });

  it("swallows send errors instead of throwing into playback", async () => {
    const m = await ts3Mock();
    m.__client.execCommand.mockRejectedValueOnce(new Error("flood ban"));
    const connection = createTs3Connection(testConfig(), identity, logger);
    await expect(
      connection.sendChannelMessage("hola"),
    ).resolves.toBeUndefined();
  });
});

describe("createTs3Connection queries", () => {
  it("falls back to raw channellist when the library call fails", async () => {
    const m = await ts3Mock();
    m.listChannels.mockRejectedValueOnce(new Error("lib broke"));
    m.__client.execCommandWithResponse.mockResolvedValueOnce([
      { cid: "3", name: "Music", pid: "1" },
      { cid: "1", name: "Root" },
      { name: "no cid" },
    ]);
    const connection = createTs3Connection(testConfig(), identity, logger);
    const channels = await connection.listChannels();
    expect(channels).toEqual([
      { cid: 3, name: "Music", parentCid: 1 },
      { cid: 1, name: "Root" },
    ]);
  });

  it("maps library client entries to the flat shape", async () => {
    const m = await ts3Mock();
    m.listClients.mockResolvedValueOnce([
      {
        id: 1,
        nickname: "user",
        uid: "u1",
        type: 0,
        channelID: 7n,
        serverGroups: ["13"],
        talkPower: 0,
      },
      {
        id: 2,
        nickname: "serverquery",
        uid: "u2",
        type: 1,
        channelID: 0n,
        serverGroups: [],
        talkPower: 0,
      },
    ]);
    const connection = createTs3Connection(testConfig(), identity, logger);
    const clients = await connection.listClients();
    expect(clients).toEqual([
      { clid: 1, name: "user", uid: "u1", cid: 7, groups: ["13"] },
    ]);
  });

  it("reports no talk permission when the server hides talk power on a moderated channel", async () => {
    const m = await ts3Mock();
    m.__client.execCommandWithResponse
      .mockResolvedValueOnce([{ client_talk_power: undefined }])
      .mockResolvedValueOnce([
        { channel_needed_talk_power: "100000", channel_flag_moderated: "0" },
      ]);
    const connection = createTs3Connection(testConfig(), identity, logger);
    await expect(connection.canTalkInCurrentChannel()).resolves.toBe(false);
  });
});
