import { describe, expect, it, vi } from "vitest";
import {
  insertPhotoRow,
  isAlreadyExistsError,
  isUniqueViolation,
  signPhotoUrls,
  uploadPhotoObject,
} from "./storage";

const blob = new Blob(["x"], { type: "image/jpeg" });

function storageClient(
  upload: ReturnType<typeof vi.fn>,
  createSignedUrls = vi.fn(),
) {
  return {
    storage: { from: vi.fn(() => ({ upload, createSignedUrls })) },
  } as never;
}

describe("isAlreadyExistsError", () => {
  it("recognises every way Supabase Storage reports a duplicate", () => {
    // Real body: HTTP 400 with statusCode "409".
    expect(
      isAlreadyExistsError({
        status: 400,
        statusCode: "409",
        error: "Duplicate",
        message: "The resource already exists",
      }),
    ).toBe(true);
    expect(isAlreadyExistsError({ status: 409, message: "x" })).toBe(true);
    expect(isAlreadyExistsError({ statusCode: "409", message: "x" })).toBe(
      true,
    );
    expect(
      isAlreadyExistsError({ message: "The resource already exists" }),
    ).toBe(true);
    expect(isAlreadyExistsError({ error: "Duplicate", message: "x" })).toBe(
      true,
    );
  });

  it("does not treat other failures as success", () => {
    expect(
      isAlreadyExistsError({
        status: 500,
        statusCode: "500",
        message: "Internal error",
      }),
    ).toBe(false);
    expect(
      isAlreadyExistsError({
        status: 403,
        message: "new row violates row-level security policy",
      }),
    ).toBe(false);
    expect(isAlreadyExistsError({ message: "Failed to fetch" })).toBe(false);
    expect(isAlreadyExistsError(null)).toBe(false);
    expect(isAlreadyExistsError("already exists")).toBe(false);
  });
});

describe("uploadPhotoObject", () => {
  it("uploads with upsert:false to the private bucket", async () => {
    const upload = vi.fn().mockResolvedValue({ data: {}, error: null });
    await uploadPhotoObject(storageClient(upload), "2026casj/254/p.jpg", blob);
    expect(upload).toHaveBeenCalledWith(
      "2026casj/254/p.jpg",
      blob,
      expect.objectContaining({ upsert: false, contentType: "image/jpeg" }),
    );
  });

  it("treats 'already exists' as success (idempotent retry)", async () => {
    const upload = vi
      .fn()
      .mockResolvedValue({
        data: null,
        error: { statusCode: "409", message: "The resource already exists" },
      });
    await expect(
      uploadPhotoObject(storageClient(upload), "p", blob),
    ).resolves.toBeUndefined();
  });

  it("throws for real failures, classified", async () => {
    const upload = vi
      .fn()
      .mockResolvedValue({
        data: null,
        error: { status: 500, message: "boom" },
      });
    await expect(
      uploadPhotoObject(storageClient(upload), "p", blob),
    ).rejects.toMatchObject({ name: "SaveError" });

    const dropped = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
    await expect(
      uploadPhotoObject(storageClient(dropped), "p", blob),
    ).rejects.toMatchObject({ kind: "network" });
  });
});

describe("insertPhotoRow", () => {
  const row = { id: "p1", entryId: "e1", storagePath: "2026casj/254/p1.jpg" };
  const dbClient = (result: unknown) =>
    ({ from: () => ({ insert: vi.fn().mockResolvedValue(result) }) }) as never;

  it("maps to snake_case columns", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null, status: 201 });
    await insertPhotoRow({ from: () => ({ insert }) } as never, row);
    expect(insert).toHaveBeenCalledWith({
      id: "p1",
      entry_id: "e1",
      storage_path: "2026casj/254/p1.jpg",
    });
  });

  it("treats a duplicate id as success (the earlier attempt inserted it)", async () => {
    await expect(
      insertPhotoRow(
        dbClient({ error: { code: "23505", message: "dup" }, status: 409 }),
        row,
      ),
    ).resolves.toBeUndefined();
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
  });

  it("throws for other errors", async () => {
    await expect(
      insertPhotoRow(
        dbClient({ error: { code: "42501", message: "rls" }, status: 403 }),
        row,
      ),
    ).rejects.toMatchObject({ kind: "permission" });
  });
});

describe("signPhotoUrls", () => {
  it("returns a path -> url map and leaves out paths that could not be signed", async () => {
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [
        { path: "a.jpg", signedUrl: "https://x/a", error: null },
        { path: "b.jpg", signedUrl: null, error: "Object not found" },
      ],
      error: null,
    });
    const urls = await signPhotoUrls(storageClient(vi.fn(), createSignedUrls), [
      "a.jpg",
      "b.jpg",
    ]);
    expect([...urls.entries()]).toEqual([["a.jpg", "https://x/a"]]);
  });

  it("does not call the network for an empty list", async () => {
    const createSignedUrls = vi.fn();
    expect(
      (await signPhotoUrls(storageClient(vi.fn(), createSignedUrls), [])).size,
    ).toBe(0);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});
