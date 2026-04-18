import { RelativePattern, Uri, WorkspaceFolder, workspace } from 'vscode';
import { EMPTY_PROJECT_CONTEXT, ProjectContext } from '../types';
import { readFileContent } from './read-file-content.helper';

/**
 * Detects project context using lightweight multi-signal checks.
 *
 * The implementation is intentionally bounded to avoid expensive workspace scans:
 * - `*.py` lookup is capped to 5 results
 * - Python project files lookup is capped to 5 results
 */
export const detectProjectContext = async (options: {
  resource?: Uri;
  workspaceSelection?: string;
}): Promise<ProjectContext> => {
  const workspaceFolder = resolveWorkspaceFolder(
    options.resource,
    options.workspaceSelection,
  );

  if (!workspaceFolder) {
    return EMPTY_PROJECT_CONTEXT;
  }

  const pythonSignals = await detectPythonSignals(workspaceFolder);

  const frameworkDependencies = new Set<string>(['flask', 'django', 'fastapi']);

  const typeSupportConfigFiles = await workspace.findFiles(
    new RelativePattern(workspaceFolder, '**/{mypy.ini,pyrightconfig.json}'),
    '**/{node_modules,venv,.venv,__pycache__}/**',
    2,
  );

  const hasTypeSupportDependency = [...pythonSignals.dependencyNames].some(
    (dependencyName) =>
      new Set(['typing', 'typing-extensions', 'mypy', 'pyright']).has(
        dependencyName.toLowerCase(),
      ),
  );

  const hasRuntime =
    pythonSignals.hasPythonProjectFiles || pythonSignals.hasPythonFiles;

  const hasFastApi = [...pythonSignals.dependencyNames].some(
    (dependencyName) => dependencyName.toLowerCase() === 'fastapi',
  );

  return {
    hasRuntime,
    hasFramework: [...pythonSignals.dependencyNames].some((dependencyName) =>
      frameworkDependencies.has(dependencyName.toLowerCase()),
    ),
    hasFastApi,
    hasTypeSupport:
      hasTypeSupportDependency || typeSupportConfigFiles.length > 0,
  };
};

/**
 * Detects Python-specific project signals with bounded file search.
 */
const detectPythonSignals = async (
  workspaceFolder: WorkspaceFolder,
): Promise<{
  hasPythonFiles: boolean;
  hasPythonProjectFiles: boolean;
  dependencyNames: Set<string>;
}> => {
  const dependencyNames = new Set<string>();

  try {
    const pythonFiles = await workspace.findFiles(
      new RelativePattern(workspaceFolder, '**/*.py'),
      '**/{node_modules,venv,.venv,__pycache__}/**',
      5,
    );

    const projectFiles = await workspace.findFiles(
      new RelativePattern(
        workspaceFolder,
        '**/{requirements.txt,pyproject.toml,poetry.lock}',
      ),
      '**/{node_modules,venv,.venv,__pycache__}/**',
      5,
    );

    await Promise.all(
      projectFiles.map(async (fileUri) => {
        try {
          const text = await readFileContent(fileUri);

          if (fileUri.path.endsWith('requirements.txt')) {
            for (const dependencyName of parseRequirementsDependencies(text)) {
              dependencyNames.add(dependencyName);
            }
            return;
          }

          if (
            fileUri.path.endsWith('pyproject.toml') ||
            fileUri.path.endsWith('poetry.lock')
          ) {
            for (const dependencyName of parsePyprojectDependencies(text)) {
              dependencyNames.add(dependencyName);
            }
          }
        } catch {
          // Ignore file-level parsing failures and continue with other signals.
        }
      }),
    );

    return {
      hasPythonFiles: pythonFiles.length > 0,
      hasPythonProjectFiles: projectFiles.length > 0,
      dependencyNames,
    };
  } catch {
    return {
      hasPythonFiles: false,
      hasPythonProjectFiles: false,
      dependencyNames,
    };
  }
};

/**
 * Parses Python dependencies from requirements-style text.
 */
const parseRequirementsDependencies = (requirementsText: string): string[] => {
  const dependencies: string[] = [];

  for (const rawLine of requirementsText.split('\n')) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_.-]+)/);
    if (match?.[1]) {
      dependencies.push(match[1].toLowerCase());
    }
  }

  return dependencies;
};

/**
 * Parses Python dependencies from pyproject/poetry text using lightweight heuristics.
 */
const parsePyprojectDependencies = (pyprojectText: string): string[] => {
  const dependencies = new Set<string>();

  for (const quotedMatch of pyprojectText.matchAll(
    /['\"]([A-Za-z0-9_.-]+)(?:[<>=!~][^'\"]*)?['\"]/g,
  )) {
    if (quotedMatch[1]) {
      dependencies.add(quotedMatch[1].toLowerCase());
    }
  }

  for (const assignmentMatch of pyprojectText.matchAll(
    /^([A-Za-z0-9_.-]+)\s*=/gm,
  )) {
    const dependencyName = assignmentMatch[1]?.toLowerCase();

    if (dependencyName && dependencyName !== 'python') {
      dependencies.add(dependencyName);
    }
  }

  return [...dependencies];
};

/**
 * Resolves the workspace folder to inspect for context detection.
 */
const resolveWorkspaceFolder = (
  resource?: Uri,
  workspaceSelection?: string,
): WorkspaceFolder | undefined => {
  if (resource) {
    return workspace.getWorkspaceFolder(resource);
  }

  if (workspaceSelection) {
    return workspace.workspaceFolders?.find(
      (folder) => folder.uri.fsPath === workspaceSelection,
    );
  }

  return workspace.workspaceFolders?.[0];
};
