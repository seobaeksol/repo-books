import { describe, expect, it } from "vitest";
import {
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
      model: "qwen3-coder 14B",
      context: "128k"
    });
  });
});
