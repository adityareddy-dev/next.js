import { join as fixturePath } from 'node:path'
/**
 * Tests for the Instant Navigation Testing API.
 *
 * The `instant` helper allows tests to assert on the prefetched UI state
 * before dynamic data streams in. This enables deterministic testing of
 * loading states without race conditions.
 *
 * Usage example:
 *
 *   await instant(page, async () => {
 *     await page.click('a[href="/products/123"]')
 *     // Assert on the prefetched loading UI
 *     await expect(page.locator('[data-testid="loading-shell"]')).toBeVisible()
 *     // Dynamic content hasn't streamed in yet
 *     expect(await page.locator('[data-testid="price"]').count()).toBe(0)
 *   })
 *   // After exiting instant(), dynamic content streams in
 *   await expect(page.locator('[data-testid="price"]')).toBeVisible()
 *
 * NOTE: This API is not exposed in production builds by default. These tests
 * use the experimental.exposeTestingApiInProductionBuild flag to enable the
 * API in production mode for testing purposes.
 */

import {
  NextInstance,
  nextTestSetup,
  isNextDev,
  type Playwright as NextBrowser,
} from 'e2e-utils'
import { instant } from '@next/playwright'
import { assertNoConsoleErrors } from 'next-test-utils'
import type * as Playwright from 'playwright'
import { join } from 'node:path'

/**
 * Opens a browser and returns the underlying Playwright Page instance.
 *
 * We use this pattern so our test assertions look as close as possible to
 * what users would write with the actual Playwright helper package. The
 * Next.js test infra wraps Playwright with its own BrowserInterface, but
 * the Instant Navigation Testing API is designed to work with native Playwright.
 */
// The browser and full-document navigation requests for the currently running
// test. openPage populates these so a shared afterEach can assert there were no
// console errors (e.g. a failed hydration) and individual tests can assert that
// releasing the instant lock resolves client-side instead of hard reloading.
let activeBrowser: NextBrowser | undefined
let navigationRequests: string[] = []

async function openPage(
  next: NextInstance,
  url: string,
  options?: { cookies?: Array<{ name: string; value: string }> }
): Promise<Playwright.Page> {
  let page: Playwright.Page
  navigationRequests = []
  activeBrowser = await next.browser(url, {
    // Surface uncaught page errors (e.g. a failed hydration) as console logs so
    // assertNoConsoleErrors fails the test on them.
    pushErrorAsConsoleLog: true,
    beforePageLoad(p) {
      page = p
      // Record full-document navigations so tests can assert that releasing the
      // instant lock does not trigger a hard reload.
      p.on('request', (request) => {
        if (request.isNavigationRequest()) {
          navigationRequests.push(new URL(request.url()).pathname)
        }
      })
      if (options?.cookies) {
        const { hostname } = new URL(next.url)
        p.context().addCookies(
          options.cookies.map((c) => ({
            ...c,
            domain: hostname,
            path: '/',
          }))
        )
      }
    },
  })
  // Lower the per-action timeout below jest's 60s test timeout so a stalling
  // waitFor fails with its own locator (naming the element that never appeared)
  // instead of a bare test-level timeout that hides which assertion hung.
  page.setDefaultTimeout(20_000)
  return page
}

afterEach(async () => {
  if (activeBrowser) {
    // Console-error checking targets production minified React errors (e.g. a
    // failed hydration on deploy, which is how the instant bootstrap regression
    // surfaced). Development legitimately logs warnings here (such as a
    // blocking-route prerender insight), so only assert in production.
    if (!isNextDev) {
      await assertNoConsoleErrors(activeBrowser)
    }
    activeBrowser = undefined
  }
})

describe('instant-navigation-testing-api - blocking routes (dev only)', () => {
  const { next } = nextTestSetup({
    files: join(
      fixturePath(
        __dirname,
        '../../../e2e/app-dir/instant-navigation-testing-api'
      ),
      'fixtures',
      'blocking'
    ),
  })

  // The cookie value must not commit while the instant lock is held; it only
  // streams in after the lock releases.
  it('does not include blocking cookies read outside a Suspense in the instant shell', async () => {
    const page = await openPage(next, '/', {
      cookies: [{ name: 'testCookie', value: 'hello' }],
    })
    await page
      .locator('[data-testid="home-title"]')
      .waitFor({ state: 'visible' })

    await instant(page, async () => {
      await page.click('#link-to-blocking-cookies')

      const cookieValue = page.locator('[data-testid="blocking-cookie-value"]')
      // Poll past the point where a leak previously committed (~10s), breaking
      // early so a regression fails fast.
      for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(1000)
        if (await cookieValue.count()) break
      }
      expect(await cookieValue.count()).toBe(0)
    })

    // After exiting the instant scope, the cookie value streams in.
    const cookieValue = page.locator('[data-testid="blocking-cookie-value"]')
    await cookieValue.waitFor({ state: 'visible' })
    expect(await cookieValue.textContent()).toContain('testCookie: hello')
  })
})
