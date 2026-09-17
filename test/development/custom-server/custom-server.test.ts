import { join as fixturePath } from 'node:path'

import { nextTestSetup } from 'e2e-utils'
import { retry } from 'next-test-utils'

const sharedDeps = { 'get-port': '5.1.1' }
const sharedNodeEnv = 'development'

describe('Custom Server HTTP', () => {
  describe('HMR with custom server', () => {
    const { next } = nextTestSetup({
      files: fixturePath(__dirname, '../../e2e/custom-server'),
      startCommand: 'node server.js',
      serverReadyPattern: /- Local:/,
      env: { USE_HTTPS: 'false', NODE_ENV: sharedNodeEnv },
      dependencies: sharedDeps,

      disableAutoSkewProtection: true,
    })

    it('Should support HMR when rendering with /index pathname', async () => {
      const browser = await next.browser('/test-index-hmr')
      const text = await browser.elementByCss('#go-asset').text()
      const logs = await browser.log()
      expect(text).toBe('Asset')

      expect(
        logs.some((log) =>
          log.message.includes(
            'ReactDOM.hydrate is no longer supported in React 18'
          )
        )
      ).toBe(false)

      const originalContent = await next.readFile('pages/index.js')
      await next.patchFile(
        'pages/index.js',
        originalContent.replace('Asset', 'Asset!!')
      )

      try {
        await retry(async () => {
          expect(await browser.elementByCss('#go-asset').text()).toMatch(
            /Asset!!/
          )
        })
      } finally {
        await next.patchFile('pages/index.js', originalContent)
      }
    })
  })
})
