import { nextTestSetup } from 'e2e-utils'

const errorMessage =
  'images.loaderFile detected but the file is missing default export.\nRead more: https://nextjs.org/docs/messages/invalid-images-config'

describe('Error test if the loader file export a named function', () => {
  describe('in Build and Start', () => {
    const { next, isNextStart } = nextTestSetup({
      skipDeployment: true,
      skipStart: true,
      files: __dirname,
    })

    ;(isNextStart ? describe : describe.skip)('build and start only', () => {
      it('should show the build error', async () => {
        await expect(next.start()).rejects.toThrow(
          'next build failed with code/signal 1'
        )
        expect(next.cliOutput).toContain(errorMessage)
      })
    })
  })
})
