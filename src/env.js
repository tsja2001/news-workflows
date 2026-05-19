import dotenv from 'dotenv'

/**
 * 获取当前运行应加载的 env 文件。
 * 默认加载 .env；测试/验证场景可通过 ENV_FILE=.env.test 覆盖。
 *
 * @param {object} env
 * @returns {string}
 */
export function getEnvFilePath(env = process.env) {
  return env.ENV_FILE || env.DOTENV_CONFIG_PATH || '.env'
}

/**
 * 加载环境变量。
 *
 * @param {object} [options]
 * @param {object} [options.env]
 * @param {boolean} [options.override=false]
 * @returns {import('dotenv').DotenvConfigOutput}
 */
export function loadEnv(options = {}) {
  const env = options.env || process.env
  return dotenv.config({
    path: getEnvFilePath(env),
    override: options.override ?? false,
  })
}
