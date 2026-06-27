export const PR_TITLE = 'Add Open Code CLI GitHub Workflow'

export const GITHUB_ACTION_SETUP_DOCS_URL =
  'https://github.com/open-code-cli/open-code-cli-action/blob/main/docs/setup.md'

export const WORKFLOW_CONTENT = `name: Open Code CLI

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

jobs:
  open-code-cli:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@open-code-cli')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@open-code-cli')) ||
      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@open-code-cli')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@open-code-cli') || contains(github.event.issue.title, '@open-code-cli')))
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write
      actions: read # Required for Open Code CLI to read CI results on PRs
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Run Open Code CLI
        id: open-code-cli
        uses: open-code-cli/open-code-cli-action@v1
        with:
          open_code_cli_api_key: \${{ secrets.OPEN_CODE_CLI_API_KEY }}

          # This is an optional setting that allows Open Code CLI to read CI results on PRs
          additional_permissions: |
            actions: read

          # Optional: Give a custom prompt to Open Code CLI. If this is not specified, Open Code CLI will perform the instructions specified in the comment that tagged it.
          # prompt: 'Update the pull request description to include a summary of changes.'

          # Optional: Add open_code_cli_args to customize Open Code CLI behavior and configuration
          # See https://github.com/open-code-cli/open-code-cli-action/blob/main/docs/usage.md
          # or https://open-code-cli.dev/docs/cli-reference for available options
          # open_code_cli_args: '--allowed-tools Bash(gh pr:*)'

`

export const PR_BODY = `## 🤖 Installing Open Code CLI GitHub App

This PR adds a GitHub Actions workflow that enables Open Code CLI integration in our repository.

### What is Open Code CLI?

[Open Code CLI](https://open-code-cli.dev) is an AI coding agent that can help with:
- Bug fixes and improvements
- Documentation updates
- Implementing new features
- Code reviews and suggestions
- Writing tests
- And more!

### How it works

Once this PR is merged, we'll be able to interact with Open Code CLI by mentioning @open-code-cli (legacy GitHub App trigger) in a pull request or issue comment.
Once the workflow is triggered, Open Code CLI will analyze the comment and surrounding context, and execute on the request in a GitHub action.

### Important Notes

- **This workflow won't take effect until this PR is merged**
- **@open-code-cli mentions won't work until after the merge is complete**
- The workflow runs automatically whenever the @open-code-cli GitHub App trigger is mentioned in PR or issue comments
- Open Code CLI gets access to the entire PR or issue context including files, diffs, and previous comments

### Security

- Our OpenAI-compatible API key is securely stored as a GitHub Actions secret
- Only users with write access to the repository can trigger the workflow
- All Open Code CLI runs are stored in the GitHub Actions run history
- Open Code CLI's default tools are limited to reading/writing files and interacting with our repo by creating comments, branches, and commits.
- We can add more allowed tools by adding them to the workflow file like:

\`\`\`
allowed_tools: Bash(npm install),Bash(npm run build),Bash(npm run lint),Bash(npm run test)
\`\`\`

There's more information in the [Open Code CLI action repo](https://github.com/open-code-cli/open-code-cli-action).

After merging this PR, let's try mentioning @open-code-cli (legacy GitHub App trigger) in a comment on any PR to get started!`

export const CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT = `name: Open Code CLI Review

on:
  pull_request:
    types: [opened, synchronize, ready_for_review, reopened]
    # Optional: Only run on specific file changes
    # paths:
    #   - "src/**/*.ts"
    #   - "src/**/*.tsx"
    #   - "src/**/*.js"
    #   - "src/**/*.jsx"

jobs:
  open-code-cli-review:
    # Optional: Filter by PR author
    # if: |
    #   github.event.pull_request.user.login == 'external-contributor' ||
    #   github.event.pull_request.user.login == 'new-developer' ||
    #   github.event.pull_request.author_association == 'FIRST_TIME_CONTRIBUTOR'

    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Run Open Code CLI Review
        id: open-code-cli-review
        uses: open-code-cli/open-code-cli-action@v1
        with:
          open_code_cli_api_key: \${{ secrets.OPEN_CODE_CLI_API_KEY }}
          plugin_marketplaces: 'https://github.com/open-code-cli/open-code-cli.git'
          plugins: 'code-review@open-code-cli-plugins'
          prompt: '/code-review:code-review \${{ github.repository }}/pull/\${{ github.event.pull_request.number }}'
          # See https://github.com/open-code-cli/open-code-cli-action/blob/main/docs/usage.md
          # or https://open-code-cli.dev/docs/cli-reference for available options

`
