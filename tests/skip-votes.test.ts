import { describe, expect, it } from "vitest";

import { SkipVotes } from "../src/application/skip-votes.js";

describe("SkipVotes", () => {
  const play = {};
  const listeners = ["a", "b", "c", "d"];

  it("passes when more than half of the listeners voted", () => {
    const votes = new SkipVotes();
    expect(votes.vote(play, "a", listeners)).toEqual({
      needed: 3,
      passed: false,
      votes: 1,
    });
    expect(votes.vote(play, "b", listeners).passed).toBe(false);
    expect(votes.vote(play, "c", listeners)).toEqual({
      needed: 3,
      passed: true,
      votes: 3,
    });
  });

  it("counts a repeated vote once", () => {
    const votes = new SkipVotes();
    votes.vote(play, "a", listeners);
    expect(votes.vote(play, "a", listeners).votes).toBe(1);
  });

  it("starts over when the play changes", () => {
    const votes = new SkipVotes();
    votes.vote(play, "a", listeners);
    votes.vote(play, "b", listeners);
    expect(votes.vote({}, "c", listeners).votes).toBe(1);
  });

  it("drops the votes of people who left the channel", () => {
    const votes = new SkipVotes();
    votes.vote(play, "a", listeners);
    votes.vote(play, "b", listeners);
    // "a" left: two of three listeners are needed and only "b" and "c" count.
    expect(votes.vote(play, "c", ["b", "c", "d"])).toEqual({
      needed: 2,
      passed: true,
      votes: 2,
    });
  });

  it("clears the votes once a skip passes", () => {
    const votes = new SkipVotes();
    votes.vote(play, "a", ["a"]);
    expect(votes.vote(play, "b", ["a", "b"]).votes).toBe(1);
  });
});
