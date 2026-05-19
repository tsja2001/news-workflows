import { describe, it } from 'node:test'
import assert from 'node:assert'

describe('env loader', () => {
  it('uses .env by default', async () => {
    const { getEnvFilePath } = await import('./env.js')
    assert.strictEqual(getEnvFilePath({}), '.env')
  })

  it('prefers ENV_FILE for test/integration runs', async () => {
    const { getEnvFilePath } = await import('./env.js')
    assert.strictEqual(getEnvFilePath({ ENV_FILE: '.env.test' }), '.env.test')
  })

  it('supports DOTENV_CONFIG_PATH fallback', async () => {
    const { getEnvFilePath } = await import('./env.js')
    assert.strictEqual(getEnvFilePath({ DOTENV_CONFIG_PATH: '.env.test' }), '.env.test')
  })

  it('ENV_FILE has priority over DOTENV_CONFIG_PATH', async () => {
    const { getEnvFilePath } = await import('./env.js')
    assert.strictEqual(
      getEnvFilePath({ ENV_FILE: '.env.integration', DOTENV_CONFIG_PATH: '.env.test' }),
      '.env.integration'
    )
  })
})
