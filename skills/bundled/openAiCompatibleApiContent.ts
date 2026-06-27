// Content for the openai-compatible-api bundled skill.
// Each .md file is inlined as a string at build time via Bun's text loader.

import csharpOpenAiCompatibleApi from './openai-compatible-api/csharp/openai-compatible-api.md'
import curlExamples from './openai-compatible-api/curl/examples.md'
import goOpenAiCompatibleApi from './openai-compatible-api/go/openai-compatible-api.md'
import javaOpenAiCompatibleApi from './openai-compatible-api/java/openai-compatible-api.md'
import phpOpenAiCompatibleApi from './openai-compatible-api/php/openai-compatible-api.md'
import pythonAgentSdkPatterns from './openai-compatible-api/python/agent-sdk/patterns.md'
import pythonAgentSdkReadme from './openai-compatible-api/python/agent-sdk/README.md'
import pythonOpenAiCompatibleApiBatches from './openai-compatible-api/python/openai-compatible-api/batches.md'
import pythonOpenAiCompatibleApiFilesApi from './openai-compatible-api/python/openai-compatible-api/files-api.md'
import pythonOpenAiCompatibleApiReadme from './openai-compatible-api/python/openai-compatible-api/README.md'
import pythonOpenAiCompatibleApiStreaming from './openai-compatible-api/python/openai-compatible-api/streaming.md'
import pythonOpenAiCompatibleApiToolUse from './openai-compatible-api/python/openai-compatible-api/tool-use.md'
import rubyOpenAiCompatibleApi from './openai-compatible-api/ruby/openai-compatible-api.md'
import skillPrompt from './openai-compatible-api/SKILL.md'
import sharedErrorCodes from './openai-compatible-api/shared/error-codes.md'
import sharedLiveSources from './openai-compatible-api/shared/live-sources.md'
import sharedModels from './openai-compatible-api/shared/models.md'
import sharedPromptCaching from './openai-compatible-api/shared/prompt-caching.md'
import sharedToolUseConcepts from './openai-compatible-api/shared/tool-use-concepts.md'
import typescriptAgentSdkPatterns from './openai-compatible-api/typescript/agent-sdk/patterns.md'
import typescriptAgentSdkReadme from './openai-compatible-api/typescript/agent-sdk/README.md'
import typescriptOpenAiCompatibleApiBatches from './openai-compatible-api/typescript/openai-compatible-api/batches.md'
import typescriptOpenAiCompatibleApiFilesApi from './openai-compatible-api/typescript/openai-compatible-api/files-api.md'
import typescriptOpenAiCompatibleApiReadme from './openai-compatible-api/typescript/openai-compatible-api/README.md'
import typescriptOpenAiCompatibleApiStreaming from './openai-compatible-api/typescript/openai-compatible-api/streaming.md'
import typescriptOpenAiCompatibleApiToolUse from './openai-compatible-api/typescript/openai-compatible-api/tool-use.md'

// @[MODEL LAUNCH]: Update the model IDs/names below. These are substituted into {{VAR}}
// placeholders in the .md files at runtime before the skill prompt is sent.
// After updating these constants, manually update the two files that still hardcode models:
//   - openai-compatible-api/SKILL.md (Current Models pricing table)
//   - openai-compatible-api/shared/models.md (full model catalog with legacy versions and alias mappings)
export const SKILL_MODEL_VARS = {
  OPUS_ID: 'openai/gpt-4.1',
  OPUS_NAME: 'configured model 4.6',
  SONNET_ID: 'openai/gpt-4o',
  SONNET_NAME: 'Open Code CLI Sonnet 4.6',
  HAIKU_ID: 'openai/gpt-4o-mini',
  HAIKU_NAME: 'Open Code CLI Haiku 4.5',
  // Previous Sonnet ID — used in "do not append date suffixes" example in SKILL.md.
  PREV_SONNET_ID: 'openai/gpt-4o',
} satisfies Record<string, string>

export const SKILL_PROMPT: string = skillPrompt

export const SKILL_FILES: Record<string, string> = {
  'csharp/openai-compatible-api.md': csharpOpenAiCompatibleApi,
  'curl/examples.md': curlExamples,
  'go/openai-compatible-api.md': goOpenAiCompatibleApi,
  'java/openai-compatible-api.md': javaOpenAiCompatibleApi,
  'php/openai-compatible-api.md': phpOpenAiCompatibleApi,
  'python/agent-sdk/README.md': pythonAgentSdkReadme,
  'python/agent-sdk/patterns.md': pythonAgentSdkPatterns,
  'python/openai-compatible-api/README.md': pythonOpenAiCompatibleApiReadme,
  'python/openai-compatible-api/batches.md': pythonOpenAiCompatibleApiBatches,
  'python/openai-compatible-api/files-api.md': pythonOpenAiCompatibleApiFilesApi,
  'python/openai-compatible-api/streaming.md': pythonOpenAiCompatibleApiStreaming,
  'python/openai-compatible-api/tool-use.md': pythonOpenAiCompatibleApiToolUse,
  'ruby/openai-compatible-api.md': rubyOpenAiCompatibleApi,
  'shared/error-codes.md': sharedErrorCodes,
  'shared/live-sources.md': sharedLiveSources,
  'shared/models.md': sharedModels,
  'shared/prompt-caching.md': sharedPromptCaching,
  'shared/tool-use-concepts.md': sharedToolUseConcepts,
  'typescript/agent-sdk/README.md': typescriptAgentSdkReadme,
  'typescript/agent-sdk/patterns.md': typescriptAgentSdkPatterns,
  'typescript/openai-compatible-api/README.md': typescriptOpenAiCompatibleApiReadme,
  'typescript/openai-compatible-api/batches.md': typescriptOpenAiCompatibleApiBatches,
  'typescript/openai-compatible-api/files-api.md': typescriptOpenAiCompatibleApiFilesApi,
  'typescript/openai-compatible-api/streaming.md': typescriptOpenAiCompatibleApiStreaming,
  'typescript/openai-compatible-api/tool-use.md': typescriptOpenAiCompatibleApiToolUse,
}
