import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canTalkInChannel,
  createHeartbeat,
} from "../src/adapters/ts3/ts3-connection.js";

describe("createHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("probes at the given interval and reports failures", () => {
    const probe = vi.fn(() => Promise.resolve());
    const onLost = vi.fn();

    createHeartbeat(probe, 1_000, onLost);
    expect(probe).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(probe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(onLost).not.toHaveBeenCalled();
  });

  it("reports a failed probe as a lost connection only after consecutive failures", async () => {
    const probe = vi.fn(() => Promise.reject(new Error("no response")));
    const onLost = vi.fn();

    createHeartbeat(probe, 1_000, onLost);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onLost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("recovers from a single failed probe", async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error("no response"))
      .mockResolvedValue(undefined);
    const onLost = vi.fn();

    createHeartbeat(probe, 1_000, onLost);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(onLost).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("stops probing when cleared", () => {
    const probe = vi.fn(() => Promise.resolve());
    const onLost = vi.fn();

    const stop = createHeartbeat(probe, 1_000, onLost);
    stop();
    vi.advanceTimersByTime(5_000);

    expect(probe).not.toHaveBeenCalled();
  });
});

describe("canTalkInChannel", () => {
  it("allows talking when the talk power meets the channel requirement", () => {
    expect(
      canTalkInChannel(
        { client_talk_power: "100" },
        { channel_needed_talk_power: "50" },
      ),
    ).toBe(true);
  });

  it("blocks talking when the talk power is below the requirement", () => {
    expect(
      canTalkInChannel(
        { client_talk_power: "0" },
        { channel_needed_talk_power: "100" },
      ),
    ).toBe(false);
  });

  it("blocks talking in moderated channels without talker status", () => {
    expect(
      canTalkInChannel(
        { client_talk_power: "100" },
        { channel_flag_moderated: "1", channel_needed_talk_power: "0" },
      ),
    ).toBe(false);
  });

  it("allows talking in moderated channels with talker status", () => {
    expect(
      canTalkInChannel(
        { client_is_talker: "1", client_talk_power: "100" },
        { channel_flag_moderated: "1", channel_needed_talk_power: "0" },
      ),
    ).toBe(true);
  });

  it("treats a missing needed power as zero", () => {
    expect(canTalkInChannel({}, {})).toBe(true);
    expect(canTalkInChannel({ client_talk_power: "0" }, {})).toBe(true);
  });

  it("assumes the bot can talk when the server hides its talk power", () => {
    expect(canTalkInChannel({}, { channel_needed_talk_power: "500" })).toBe(
      true,
    );
  });

  it("still blocks hub-like channels when the server hides its talk power", () => {
    expect(canTalkInChannel({}, { channel_needed_talk_power: "999999" })).toBe(
      false,
    );
  });

  it("prefers the real talk power when the server provides it", () => {
    expect(
      canTalkInChannel(
        { client_talk_power: "400" },
        { channel_needed_talk_power: "500" },
      ),
    ).toBe(false);
    expect(
      canTalkInChannel(
        { client_talk_power: "500" },
        { channel_needed_talk_power: "500" },
      ),
    ).toBe(true);
  });
});
