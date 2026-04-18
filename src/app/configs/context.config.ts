/**
 * Keys used to store and retrieve data from the extension's global state.
 */
export enum ContextKeys {
  /** The URI string of the user's previously selected workspace folder. */
  SelectedWorkspaceFolder = 'selectedWorkspaceFolder',

  /** The last recorded version of the extension to detect updates. */
  Version = 'version',

  /** Signals whether the feature is enabled in settings. */
  IsEnabled = 'isEnabled',

  /** Signals whether the workspace has a runnable Python project context. */
  HasRuntime = 'hasRuntime',

  /** Signals whether a known Python framework is detected. */
  HasFramework = 'hasFramework',

  /** Signals whether FastAPI is detected in project dependencies. */
  HasFastApi = 'hasFastApi',

  /** Signals whether static typing support is detected in the project. */
  HasTypeSupport = 'hasTypeSupport',
}
