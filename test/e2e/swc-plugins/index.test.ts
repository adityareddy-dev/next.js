import { nextTestSetup } from 'e2e-utils'

describe('swcPlugins', () => {
  describe('supports swcPlugins', () => {
    const { next } = nextTestSetup({
      files: __dirname,
      dependencies: {
        '@swc/plugin-react-remove-properties': '13.0.0',
      },
    })

    it('basic case', async () => {
      const html = await next.render('/')
      expect(html).toContain('Hello World')
      expect(html).not.toContain('data-custom-attribute')
    })
  })
})
