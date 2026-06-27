import type { Command } from '../../commands.js'
import { hasOpenAICompatibleProviderApiKeyAuth } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: hasOpenAICompatibleProviderApiKeyAuth()
      ? 'Switch OpenAICompatibleProvider accounts'
      : 'Sign in with your OpenAICompatibleProvider account',
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
    load: () => import('./login.js'),
  }) satisfies Command
