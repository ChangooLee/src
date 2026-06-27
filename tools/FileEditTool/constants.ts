// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's .open-code-cli/ folder
export const OPEN_CODE_FOLDER_PERMISSION_PATTERN = '/.open-code-cli/**'

// Permission pattern for granting session-level access to the global ~/.open-code-cli/ folder
export const GLOBAL_OPEN_CODE_FOLDER_PERMISSION_PATTERN = '~/.open-code-cli/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
