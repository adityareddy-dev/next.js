import { join as fixturePath } from 'node:path'
import { nextTestSetup } from 'e2e-utils'
import { retry } from 'next-test-utils'
const LIB_PATH = 'node_modules/lib/index.js'

// Preserve the timeout used by the original shared suite.
jest.setTimeout(120 * 1000)

describe('Edge runtime configurable guards', () => {
  describe('development mode', () => {
    const { next, isTurbopack } = nextTestSetup({
      files: fixturePath(
        __dirname,
        '../../e2e/edge-runtime-configurable-guards'
      ),
    })

    let originalApiRoute: string
    let originalMiddleware: string
    let originalLib: string

    beforeAll(async () => {
      originalApiRoute = await next.readFile('pages/api/route.js')
      originalMiddleware = await next.readFile('middleware.js')
      // Handle lib file which might not exist or be empty
      try {
        originalLib = await next.readFile(LIB_PATH)
      } catch (e) {
        // File doesn't exist, use default content
        originalLib = '// populated by tests\n'
      }
    })

    afterEach(async () => {
      await next.patchFile('pages/api/route.js', originalApiRoute)
      await next.patchFile('middleware.js', originalMiddleware)
      await next.patchFile(LIB_PATH, originalLib)
    })

    // Webpack treats `node_modules` as a "managed path" in its snapshot
    // config (see packages/next/src/build/webpack-config.ts), meaning it
    // assumes the contents of any file under `node_modules` are immutable
    // per package version. When a test patches
    // `node_modules/lib/index.js`, webpack's dev server keeps serving the
    // originally-cached (empty) lib module, so imports like
    // `import { hasDynamic } from 'lib'` resolve to an object without
    // `hasDynamic`. Restarting the dev server forces a fresh read of
    // `node_modules/lib/index.js`. Turbopack watches node_modules
    // correctly and does not need this workaround.
    async function restartForWebpackIfLibPatched(libPatched: boolean) {
      if (!libPatched || isTurbopack) return
      await next.stop()
      await next.start()
    }

    describe('Multiple functions with different configurations', () => {
      async function patchMultipleFunctions() {
        await next.patchFile(
          'middleware.js',
          `
          import { NextResponse } from 'next/server'

          export default () => {
            eval('100')
            return NextResponse.next()
          }
          export const config = {
            unstable_allowDynamic: '/middleware.js'
          }
        `
        )
        await next.patchFile(
          'pages/api/route.js',
          `
          export default async function handler(request) {
            eval('100')
            return Response.json({ result: true })
          }
          export const config = {
            runtime: 'edge',
            unstable_allowDynamic: '**/node_modules/lib/**'
          }
        `
        )
      }

      it('warns in dev for allowed code', async () => {
        await patchMultipleFunctions()
        const outputIndex = next.cliOutput.length
        await retry(async () => {
          const res = await next.fetch('/')
          expect(res.status).toBe(200)
          expect(next.cliOutput.slice(outputIndex)).toContain(
            `Dynamic Code Evaluation (e. g. 'eval', 'new Function') not allowed in Edge Runtime`
          )
        })
      })

      it('warns in dev for unallowed code', async () => {
        await patchMultipleFunctions()
        const outputIndex = next.cliOutput.length
        await retry(async () => {
          const res = await next.fetch('/api/route')
          expect(res.status).toBe(200)
          expect(next.cliOutput.slice(outputIndex)).toContain(
            `Dynamic Code Evaluation (e. g. 'eval', 'new Function') not allowed in Edge Runtime`
          )
        })
      })
    })

    describe.each([
      {
        title: 'Edge API',
        url: '/api/route',
        apiContent: `
          export default async function handler(request) {
            eval('100')
            return Response.json({ result: true })
          }
          export const config = {
            runtime: 'edge',
            unstable_allowDynamic: '**'
          }
        `,
        middlewareContent: null as string | null,
        libContent: null as string | null,
        skip: false,
      },
      {
        title: 'Middleware',
        url: '/',
        apiContent: null as string | null,
        middlewareContent: `
          import { NextResponse } from 'next/server'

          export default () => {
            eval('100')
            return NextResponse.next()
          }
          export const config = {
            unstable_allowDynamic: '**'
          }
        `,
        libContent: null as string | null,
        skip: false,
      },
      {
        title: 'Edge API using lib',
        url: '/api/route',
        apiContent: `
          import { hasDynamic } from 'lib'
          export default async function handler(request) {
            await hasDynamic()
            return Response.json({ result: true })
          }
          export const config = {
            runtime: 'edge',
            unstable_allowDynamic: '**/node_modules/lib/**'
          }
        `,
        middlewareContent: null as string | null,
        libContent: `
          export async function hasDynamic() {
            eval('100')
          }
        `,
        skip: false,
      },
      {
        title: 'Middleware using lib',
        url: '/',
        apiContent: null as string | null,
        middlewareContent: `
          import { NextResponse } from 'next/server'
          import { hasDynamic } from 'lib'

          // populated with tests
          export default async function () {
            await hasDynamic()
            return NextResponse.next()
          }
          export const config = {
            unstable_allowDynamic: '**/node_modules/lib/**'
          }
        `,
        libContent: `
          export async function hasDynamic() {
            eval('100')
          }
        `,
        // TODO: Re-enable when Turbopack applies the middleware dynamic code
        // evaluation transforms also to code in node_modules.
        skip: isTurbopack,
      },
    ])(
      '$title with allowed, used dynamic code',
      ({ url, apiContent, middlewareContent, libContent, skip }) => {
        ;(skip ? it.skip : it)('still warns in dev at runtime', async () => {
          if (apiContent) await next.patchFile('pages/api/route.js', apiContent)
          if (middlewareContent)
            await next.patchFile('middleware.js', middlewareContent)
          if (libContent) await next.patchFile(LIB_PATH, libContent)
          await restartForWebpackIfLibPatched(libContent !== null)

          const outputIndex = next.cliOutput.length
          await retry(async () => {
            const res = await next.fetch(url)

            expect(res.status).toBe(200)

            expect(next.cliOutput.slice(outputIndex)).toContain(
              `Dynamic Code Evaluation (e. g. 'eval', 'new Function') not allowed in Edge Runtime`
            )
          })
        })
      }
    )

    describe.each([
      {
        title: 'Edge API using lib',
        url: '/api/route',
        apiContent: `
          import { hasDynamic } from 'lib'
          export default async function handler(request) {
            await hasDynamic()
            return Response.json({ result: true })
          }
          export const config = {
            runtime: 'edge',
            unstable_allowDynamic: '/pages/**'
          }
        `,
        middlewareContent: null as string | null,
        libContent: `
          export async function hasDynamic() {
            eval('100')
          }
        `,
        // TODO: Re-enable when Turbopack applies the edge runtime transforms also
        // to code in node_modules.
        skip: isTurbopack,
      },
      {
        title: 'Middleware using lib',
        url: '/',
        apiContent: null as string | null,
        middlewareContent: `
          import { NextResponse } from 'next/server'
          import { hasDynamic } from 'lib'
          export default async function () {
            await hasDynamic()
            return NextResponse.next()
          }
          export const config = {
            unstable_allowDynamic: '/pages/**'
          }
        `,
        libContent: `
          export async function hasDynamic() {
            eval('100')
          }
        `,
        // TODO: Re-enable when Turbopack applies the middleware dynamic code
        // evaluation transforms also to code in node_modules.
        skip: isTurbopack,
      },
    ])(
      '$title with unallowed, used dynamic code',
      ({ url, apiContent, middlewareContent, libContent, skip }) => {
        ;(skip ? it.skip : it)('warns in dev at runtime', async () => {
          if (apiContent) await next.patchFile('pages/api/route.js', apiContent)
          if (middlewareContent)
            await next.patchFile('middleware.js', middlewareContent)
          if (libContent) await next.patchFile(LIB_PATH, libContent)
          await restartForWebpackIfLibPatched(libContent !== null)

          const outputIndex = next.cliOutput.length
          await retry(async () => {
            const res = await next.fetch(url)

            expect(res.status).toBe(200)

            expect(next.cliOutput.slice(outputIndex)).toContain(
              `Dynamic Code Evaluation (e. g. 'eval', 'new Function') not allowed in Edge Runtime`
            )
          })
        })
      }
    )

    describe.each([
      {
        title: 'Edge API',
        url: '/api/route',
        apiContent: `
          export default async function handler(request) {
            return Response.json({ result: (() => {}) instanceof Function })
          }
          export const config = { runtime: 'edge' }
        `,
        middlewareContent: null as string | null,
      },
      {
        title: 'Middleware',
        url: '/',
        apiContent: null as string | null,
        middlewareContent: `
          import { NextResponse } from 'next/server'
          import { returnTrue } from 'lib'
          export default async function () {
            (() => {}) instanceof Function
            return NextResponse.next()
          }
        `,
      },
    ])(
      '$title with use of Function as a type',
      ({ url, apiContent, middlewareContent }) => {
        it('does not warn in dev at runtime', async () => {
          if (apiContent) await next.patchFile('pages/api/route.js', apiContent)
          if (middlewareContent)
            await next.patchFile('middleware.js', middlewareContent)

          const outputIndex = next.cliOutput.length
          await retry(async () => {
            const res = await next.fetch(url)
            expect(res.status).toBe(200)
          })
          expect(next.cliOutput.slice(outputIndex)).not.toContain(
            `Dynamic Code Evaluation (e. g. 'eval', 'new Function') not allowed in Edge Runtime`
          )
        })
      }
    )
  })
})
