import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOOK_PURPOSE,
  DEFAULT_GENERATION_MODEL,
  DEFAULT_READER_LEVEL,
  patchReadingStateSchema,
  postGenerationOutlineSchema,
  repoBookSchema,
  seedBooks,
  seedUiState,
  uiStateSchema
} from "../src/index.js";

describe("shared schemas and fixtures", () => {
  it("validates seed books against the RepoBook schema", () => {
    expect(seedBooks.length).toBeGreaterThan(0);
    for (const book of seedBooks) {
      expect(() => repoBookSchema.parse(book)).not.toThrow();
      expect(book.parts.length).toBeGreaterThan(0);
      expect(book.chapters.length).toBeGreaterThan(0);
    }
  });

  it("validates the default UI state fixture", () => {
    expect(uiStateSchema.parse(seedUiState)).toMatchObject({
      id: "default",
      activeBookId: "repo-books-book",
      view: "library"
    });
  });

  it("applies API payload defaults", () => {
    expect(patchReadingStateSchema.parse({ chapterId: "chapter-1", progressPercent: 50 })).toEqual({
      chapterId: "chapter-1",
      progressPercent: 50,
      scrollY: 0
    });
    expect(postGenerationOutlineSchema.parse({ repoUrl: "https://github.com/example/repo" })).toMatchObject({
      branch: "main",
      model: DEFAULT_GENERATION_MODEL,
      context: "128k",
      audience: DEFAULT_READER_LEVEL,
      readerLevel: DEFAULT_READER_LEVEL,
      bookPurpose: DEFAULT_BOOK_PURPOSE,
      customPrompt: ""
    });
    expect(postGenerationOutlineSchema.parse({ repoUrl: "repo", customPrompt: "  API chapter first  " }).customPrompt).toBe("API chapter first");
  });

  it("rejects unsupported generation reader levels and purposes", () => {
    expect(() => postGenerationOutlineSchema.parse({ repoUrl: "repo", readerLevel: "매우 자세한 junior maintainer" })).toThrow();
    expect(() => postGenerationOutlineSchema.parse({ repoUrl: "repo", bookPurpose: "그냥 훑기" })).toThrow();
    expect(() => postGenerationOutlineSchema.parse({ repoUrl: "repo", depth: "unsupported" })).toThrow();
  });
});
