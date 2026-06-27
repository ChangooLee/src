import type { Command } from '../../commands.js'
import { hasOpenAICompatibleApiKeyAuth } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: hasOpenAICompatibleApiKeyAuth()
      ? 'Switch OpenAICompatible accounts'
      : 'Sign in with your OpenAICompatible account',
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
    load: () => import('./login.js'),
  }) satisfies Command
