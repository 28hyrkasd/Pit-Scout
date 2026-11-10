import { describe, expect, it } from "vitest";
import { describePhotoTile, mergePhotos, type DisplayPhoto } from "./merge-photos";

const up = (id: string, status: "pending" | "uploading" | "uploaded" | "failed" = "pending") => ({
  id,
  kind: "upload" as const,
  status,
  blob: status === "uploaded" ? null : new Blob(["x"]),
});
const removal = (id: string) => ({ id, kind: "removal" as const, status: "pending" as const, blob: null });

describe("mergePhotos", () => {
  it("shows server photos as they are", () => {
    const out = mergePhotos({ server: [{ id: "s1", url: "https://x/1" }], local: [], previewUrls: new Map() });
    expect(out).toEqual([{ id: "s1", url: "https://x/1", source: "server", uploadStatus: null, unavailableOffline: false }]);
  });

  it("marks a server photo with no URL as unavailable OFFLINE only when the listing came from the cache", () => {
    const out = mergePhotos({
      server: [
        { id: "a", url: null, offline: true },
        { id: "b", url: null },
      ],
      local: [],
      previewUrls: new Map(),
    });
    expect(out.map((p) => p.unavailableOffline)).toEqual([true, false]);
  });

  it("hides a server photo this device queued for removal", () => {
    const out = mergePhotos({
      server: [
        { id: "s1", url: "u1" },
        { id: "s2", url: "u2" },
      ],
      local: [removal("s1")],
      previewUrls: new Map(),
    });
    expect(out.map((p) => p.id)).toEqual(["s2"]);
  });

  it("adds device-only photos with their preview URL and upload status", () => {
    const out = mergePhotos({
      server: [{ id: "s1", url: "u1" }],
      local: [up("l1"), up("l2", "failed")],
      previewUrls: new Map([["l1", "blob:1"]]),
    });
    expect(out.map((p) => [p.id, p.source, p.url, p.uploadStatus])).toEqual([
      ["s1", "server", "u1", null],
      ["l1", "local", "blob:1", "pending"],
      ["l2", "local", null, "failed"],
    ]);
  });

  it("does not show a photo twice once the server lists the one this device uploaded", () => {
    const out = mergePhotos({ server: [{ id: "p1", url: "u" }], local: [up("p1", "uploading")], previewUrls: new Map([["p1", "blob:p1"]]) });
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("server");
  });

  it("skips local records that are already uploaded (blob dropped)", () => {
    const out = mergePhotos({ server: [], local: [up("p1", "uploaded")], previewUrls: new Map() });
    expect(out).toEqual([]);
  });
});

describe("describePhotoTile", () => {
  const tile = (over: Partial<DisplayPhoto>): DisplayPhoto => ({
    id: "x",
    url: null,
    source: "server",
    uploadStatus: null,
    unavailableOffline: false,
    ...over,
  });

  it("says 'unavailable offline' only when offline is the reason", () => {
    expect(describePhotoTile(tile({ unavailableOffline: true })).placeholder).toBe("Photo unavailable offline");
    expect(describePhotoTile(tile({})).placeholder).toBe("Photo unavailable");
  });

  it("device-only photos say they are waiting to upload (never 'synced'), or that the upload failed", () => {
    expect(describePhotoTile(tile({ source: "local", uploadStatus: "pending" })).status).toBe("Uploads when online");
    expect(describePhotoTile(tile({ source: "local", uploadStatus: "uploading" })).status).toBe("Uploading…");
    expect(describePhotoTile(tile({ source: "local", uploadStatus: "failed" })).status).toBe("Upload failed");
  });

  it("server photos have no status line", () => {
    expect(describePhotoTile(tile({ url: "u" })).status).toBeNull();
  });
});
