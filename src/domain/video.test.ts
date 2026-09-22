import { describe, expect, it } from "vitest";
import { youtubeVideoId } from "./video";

describe("youtubeVideoId", () => {
  it("accepts a standard watch URL", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=M7lc1UVf-VE")).toBe("M7lc1UVf-VE");
  });
  it("accepts youtu.be links", () => {
    expect(youtubeVideoId("https://youtu.be/M7lc1UVf-VE?t=12")).toBe("M7lc1UVf-VE");
  });
  it("accepts Shorts, live, music and embed URLs", () => {
    expect(youtubeVideoId("https://youtube.com/shorts/M7lc1UVf-VE")).toBe("M7lc1UVf-VE");
    expect(youtubeVideoId("https://youtube.com/live/M7lc1UVf-VE")).toBe("M7lc1UVf-VE");
    expect(youtubeVideoId("https://music.youtube.com/watch?v=M7lc1UVf-VE")).toBe("M7lc1UVf-VE");
    expect(youtubeVideoId("https://www.youtube-nocookie.com/embed/M7lc1UVf-VE")).toBe("M7lc1UVf-VE");
  });
  it("accepts a bare video id and rejects junk", () => {
    expect(youtubeVideoId("M7lc1UVf-VE")).toBe("M7lc1UVf-VE");
    expect(youtubeVideoId("not a youtube video")).toBeNull();
  });
});
