import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/health");
      return response.status();
    })
    .toBe(200);
});

test("desktop MVP flow", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop flow runs only in the desktop project");
  await page.goto("/library");
  await expect(page.locator("#library-title")).toHaveText("책장");
  await page.getByRole("button", { name: "새 책 만들기" }).click();
  await expect(page.getByRole("heading", { name: "기술서 목차 생성" })).toBeVisible();
  await page.locator("#generation-repo").fill(process.cwd());
  await page.getByRole("button", { name: "다시 생성" }).click();
  await expect(page.getByRole("button", { name: "읽기 시작" }).first()).toBeEnabled();
  await page.getByRole("button", { name: "읽기 시작" }).first().click();
  await expect(page.locator("#reader-title")).toHaveText("제품 의도와 첫 실행 경로");
  await page.getByRole("button", { name: "다음 장" }).click();
  await expect(page.locator("#reader-title")).toHaveText("디렉토리를 대단원으로 번역하기");
  await page.reload();
  await expect(page.locator("#reader-title")).toHaveText("디렉토리를 대단원으로 번역하기");
});

test("mobile reader sheets", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile sheet flow runs only in the mobile project");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library");
  await page.getByRole("button", { name: /Repo Books를 읽는 책 읽기/ }).first().click();
  await expect(page.locator("#reader-title")).toHaveText(/폴더를 대단원|입구 파일|책장 홈/);
  await page.getByRole("button", { name: "목차 열기" }).click();
  await expect(page.locator("#toc-title")).toHaveText("목차");
  await page.getByRole("button", { name: "목차 닫기" }).click();
  await page.getByRole("button", { name: "튜터 주석 열기" }).click();
  await expect(page.getByRole("heading", { name: "튜터 주석" })).toBeVisible();
});
