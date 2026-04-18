import { FileType, Uri, window, workspace } from 'vscode';

/**
 * Resolves the destination folder URI used by generation commands.
 *
 * The returned URI always represents a directory, ensuring compatibility with
 * folder-based generation workflows.
 *
 * Resolution order:
 * 1. Explicit URI provided by command invocation
 * 2. Directory of the active editor file
 * 3. First workspace folder root
 *
 * When multiple workspace folders exist, the first one is used as default.
 * This avoids user prompts and keeps execution non-blocking.
 *
 * @param inputUri Optional URI provided by VS Code command execution
 * @returns A directory URI or undefined if no valid context exists
 */
export const resolveFolderResource = async (
  inputUri?: Uri,
): Promise<Uri | undefined> => {
  if (inputUri) {
    return asDirectoryUri(inputUri);
  }

  const activeFileUri = window.activeTextEditor?.document.uri;
  if (activeFileUri) {
    return asDirectoryUri(activeFileUri);
  }

  const availableWorkspaceFolders = workspace.workspaceFolders ?? [];

  if (availableWorkspaceFolders.length > 0) {
    return availableWorkspaceFolders[0].uri;
  }

  return undefined;
};

/**
 * Ensures a URI points to a directory.
 * If the URI references a file, its parent directory is returned.
 *
 * @param uri File or directory URI
 * @returns Directory URI
 */
export const asDirectoryUri = async (uri: Uri): Promise<Uri> => {
  try {
    const resourceStat = await workspace.fs.stat(uri);

    if ((resourceStat.type & FileType.Directory) !== 0) {
      return uri;
    }

    return Uri.joinPath(uri, '..');
  } catch {
    return uri;
  }
};
