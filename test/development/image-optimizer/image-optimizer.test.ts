import { join as fixturePath } from 'node:path'
import { join } from 'path'
import { nextTestSetup } from 'e2e-utils'
import { expectWidth } from '../../e2e/image-optimizer/util'

function toQueryString(query: Record<string, any>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.set(k, String(v))
  }
  return params.toString()
}

const largeSize = 1080

describe('Image Optimizer', () => {
  describe('dev support next.config.js cloudinary loader', () => {
    const { next } = nextTestSetup({
      files: join(fixturePath(__dirname, '../../e2e/image-optimizer'), 'app'),
      nextConfig: {
        images: {
          loader: 'cloudinary',
          path: 'https://example.com/act123/',
        },
      },
    })

    it('should 404 when loader is not default', async () => {
      const size = 384
      const query = { w: size, q: 90, url: '/test.svg' }
      const opts = { headers: { accept: 'image/webp' } }
      const res = await next.fetch(`/_next/image?${toQueryString(query)}`, opts)
      expect(res.status).toBe(404)
    })
  })
  describe('dev support for dynamic blur placeholder', () => {
    const { next } = nextTestSetup({
      files: join(fixturePath(__dirname, '../../e2e/image-optimizer'), 'app'),
      nextConfig: {
        images: {
          deviceSizes: [largeSize],
          imageSizes: [],
        },
      },
    })

    it('should support width 8 per BLUR_IMG_SIZE with next dev', async () => {
      const query = { url: '/test.png', w: 8, q: 70 }
      const opts = { headers: { accept: 'image/webp' } }
      const res = await next.fetch(`/_next/image?${toQueryString(query)}`, opts)
      expect(res.status).toBe(200)
      await expectWidth(res, 320)
    })
  })
})
