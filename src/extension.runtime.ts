import {
  commands,
  ExtensionContext,
  env,
  l10n,
  MessageItem,
  QuickPickItem,
  Uri,
  WorkspaceFolder,
  window,
  workspace,
} from 'vscode';
import { VSCodeMarketplaceClient } from 'vscode-marketplace-client';

import {
  GenerateCliToolCommand,
  GenerateCustomTemplateCommand,
  GenerateDjangoModelCommand,
  GenerateDTOCommand,
  GenerateFastAPIRouteCommand,
  GenerateFastApiFeatureCommand,
  GenerateLoggerCommand,
  GeneratePythonModuleCommand,
  GeneratePythonScriptCommand,
  GenerateRepositoryCommand,
  GenerateServiceCommand,
  GenerateTestCommand,
} from './app/commands';
import {
  CommandIds,
  ContextKeys,
  EXTENSION_DISPLAY_NAME,
  EXTENSION_ID,
  EXTENSION_NAME,
  ExtensionConfig,
  REPOSITORY_URL,
  USER_PUBLISHER,
} from './app/configs';
import { CommandInvoker } from './app/controllers';
import {
  detectProjectContext,
  getErrorMessage,
  resolveFolderResource,
} from './app/helpers';
import { ProjectContext } from './app/types';

type GenerateOption = QuickPickItem & {
  commandId: CommandIds;
  group: 'features' | 'files';
  score: number;
  signals: string[];
  confidence: 'low' | 'medium' | 'high';
  isSuggested?: boolean;
};

type ProjectContextKey =
  | ContextKeys.HasRuntime
  | ContextKeys.HasFramework
  | ContextKeys.HasFastApi
  | ContextKeys.HasTypeSupport
  | ContextKeys.IsEnabled;

type ProjectContexts = Record<ProjectContextKey, boolean>;

/**
 * Manages the lifecycle and core state of the extension.
 *
 * This class is responsible for initializing the extension environment,
 * tracking the active workspace folder, managing configuration changes,
 * performing version checks, and registering commands.
 */
export class ExtensionRuntime {
  // -----------------------------------------------------------------
  // Properties
  // -----------------------------------------------------------------

  // Public properties

  /**
   * Tracks whether the user has already been warned about the extension being disabled,
   * preventing redundant popup messages.
   *
   * @type {boolean}
   * @private
   * @memberof ExtensionRuntime
   * @example
   * if (!extensionRuntime.isExtensionEnabled()) {
   *   // Warning will only be shown the first time this condition is met
   * }
   */
  private hasDisabledWarningBeenShown = false;

  /**
   * The current configuration instance, loaded based on the selected workspace folder.
   *
   * @type {ExtensionConfig}
   * @private
   * @memberof ExtensionRuntime
   * @example
   * const config = extensionRuntime.extensionConfig;
   * console.log(config.enable);
   */
  private config!: ExtensionConfig;

  /**
   * In-memory snapshot of detected project context keys.
   */
  private readonly detectedContexts: ProjectContexts = {
    [ContextKeys.HasRuntime]: false,
    [ContextKeys.HasFramework]: false,
    [ContextKeys.HasFastApi]: false,
    [ContextKeys.HasTypeSupport]: false,
    [ContextKeys.IsEnabled]: false,
  };

  // -----------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------

  /**
   * Constructs a new instance of the extension runtime.
   *
   * @param context - The context provided by VS Code upon activation.
   */
  constructor(private readonly context: ExtensionContext) {}

  // -----------------------------------------------------------------
  // Methods
  // -----------------------------------------------------------------

  // Public methods

  /**
   * Initializes the extension runtime.
   * Selects the active workspace, loads configuration, and handles version notifications.
   * This must complete successfully before start() is invoked.
   *
   * @returns A promise that resolves to true if initialization succeeded, false otherwise.
   */
  async initialize(): Promise<boolean> {
    const workspaceFolder = await this.selectWorkspaceFolder();

    if (!workspaceFolder) {
      return false;
    }

    this.initializeConfiguration(workspaceFolder);
    await this.setContextKeys(workspaceFolder.uri);

    this.startVersionChecks();

    this.isExtensionEnabled();

    return true;
  }

  /**
   * Starts the extension by registering all commands and providers.
   * This should only be called after successful initialization.
   *
   * @memberof ExtensionRuntime
   *
   * @example
   * if (initialized) {
   *   extensionRuntime.start();
   * }
   */
  start(): void {
    this.registerWorkspaceCommands();
    this.registerGeneratorCommands();
  }

  /**
   * Starts version-related checks without blocking extension activation.
   * Local notifications are fast and run immediately, while the marketplace
   * check runs in the background because it requires a network request.
   *
   * @memberof ExtensionRuntime
   *
   * @example
   * extensionRuntime.startVersionChecks();
   */
  private startVersionChecks(): void {
    void this.handleLocalVersionNotifications();
    void this.checkMarketplaceVersion();
  }

  /**
   * Returns the version declared in the extension's package.json.
   * If the version cannot be resolved, a fallback value of '0.0.0' is returned.
   *
   * @returns The current version string.
   *
   * @memberof ExtensionRuntime
   *
   * @example
   * const currentVersion = extensionRuntime.getCurrentVersion();
   * console.log(`Current extension version: ${currentVersion}`);
   */
  private getCurrentVersion(): string {
    return this.context.extension.packageJSON?.version ?? '0.0.0';
  }

  /**
   * Handles version notifications that depend only on local information.
   * This includes first activation messages and update notifications.
   * This method runs synchronously during activation since it does not require any network requests.
   *
   * @returns A promise that resolves when all notifications have been handled.
   *
   * @memberof ExtensionRuntime
   *
   * @example
   * await extensionRuntime.handleLocalVersionNotifications();
   */
  private async handleLocalVersionNotifications(): Promise<void> {
    const previousVersion = this.context.globalState.get<string>(
      ContextKeys.Version,
    );

    const currentVersion = this.getCurrentVersion();

    // Handle first activation of the extension
    if (!previousVersion) {
      const welcomeMessage = l10n.t(
        'Welcome to {0} version {1}! The extension is now active',
        EXTENSION_DISPLAY_NAME,
        currentVersion,
      );

      window.showInformationMessage(welcomeMessage);

      await this.context.globalState.update(
        ContextKeys.Version,
        currentVersion,
      );

      return;
    }

    // Handle extension update
    if (previousVersion !== currentVersion) {
      const actionReleaseNotes: MessageItem = {
        title: l10n.t('Release Notes'),
      };
      const actionDismiss: MessageItem = { title: l10n.t('Dismiss') };
      const availableActions = [actionReleaseNotes, actionDismiss];

      const updateMessage = l10n.t(
        "The {0} extension has been updated. Check out what's new in version {1}",
        EXTENSION_DISPLAY_NAME,
        currentVersion,
      );

      const userSelection = await window.showInformationMessage(
        updateMessage,
        ...availableActions,
      );

      // Open the changelog in the marketplace if requested by the user
      if (userSelection?.title === actionReleaseNotes.title) {
        const changelogUrl = `${REPOSITORY_URL}/blob/main/CHANGELOG.md`;
        env.openExternal(Uri.parse(changelogUrl));
      }

      // Persist the new version locally
      await this.context.globalState.update(
        ContextKeys.Version,
        currentVersion,
      );
    }
  }

  /**
   * Checks the VS Code Marketplace for a newer extension version.
   * This operation requires a network request and therefore runs in the background.
   * If a newer version is found, the user is notified with an option to update immediately.
   *
   * @returns A promise that resolves when the check is complete and any notifications have been handled.
   *
   * @memberof ExtensionRuntime
   *
   * @example
   * await extensionRuntime.checkMarketplaceVersion();
   */
  private async checkMarketplaceVersion(): Promise<void> {
    const currentVersion = this.getCurrentVersion();

    try {
      const latestVersion = await VSCodeMarketplaceClient.getLatestVersion(
        USER_PUBLISHER,
        EXTENSION_NAME,
      );

      // No action required if the extension is already up to date
      if (latestVersion === currentVersion) {
        return;
      }

      const actionUpdateNow: MessageItem = { title: l10n.t('Update Now') };
      const actionDismiss: MessageItem = { title: l10n.t('Dismiss') };
      const availableActions = [actionUpdateNow, actionDismiss];

      const updateMessage = l10n.t(
        'A new version of {0} is available. Update to version {1} now',
        EXTENSION_DISPLAY_NAME,
        latestVersion,
      );

      const userSelection = await window.showInformationMessage(
        updateMessage,
        ...availableActions,
      );

      // Trigger the VS Code command to install the new version
      if (userSelection?.title === actionUpdateNow.title) {
        await commands.executeCommand(
          'workbench.extensions.action.install.anotherVersion',
          `${USER_PUBLISHER}.${EXTENSION_NAME}`,
        );
      }
    } catch {
      // Ignore marketplace check failures to avoid interrupting extension startup.
    }
  }

  /**
   * Selects the workspace folder to use for the extension.
   * VS Code does not guarantee a workspace folder exists during activation,
   * so this method explicitly handles missing workspace scenarios.
   *
   * @returns A promise that resolves to the selected WorkspaceFolder, or undefined if none.
   *
   * @memberof ExtensionRuntime
   *
   * @example
   * const selectedFolder = await extensionRuntime.selectWorkspaceFolder();
   * if (selectedFolder) {
   *   console.log(`Selected workspace folder: ${selectedFolder.name}`);
   * } else {
   *   console.log('No workspace folder selected');
   * }
   */
  private async selectWorkspaceFolder(): Promise<WorkspaceFolder | undefined> {
    const availableWorkspaceFolders = workspace.workspaceFolders;

    // Check if there are any workspace folders open
    if (!availableWorkspaceFolders || availableWorkspaceFolders.length === 0) {
      return undefined;
    }

    // Try to load the previously selected workspace folder from global state
    const previousFolderUriString = this.context.globalState.get<string>(
      ContextKeys.SelectedWorkspaceFolder,
    );
    let previousFolder: WorkspaceFolder | undefined;

    // Find the workspace folder by matching URI
    if (previousFolderUriString) {
      previousFolder = availableWorkspaceFolders.find(
        (folder) => folder.uri.toString() === previousFolderUriString,
      );
    }

    // If only one workspace folder is available, use it directly
    if (availableWorkspaceFolders.length === 1) {
      return availableWorkspaceFolders[0];
    }

    // Use the previously selected workspace folder if available
    if (previousFolder) {
      // Notify the user which workspace is being used
      window.showInformationMessage(
        l10n.t('Using workspace folder: {0}', previousFolder.name),
      );

      return previousFolder;
    }

    // Multiple workspace folders are available and no previous selection exists
    const pickerPlaceholder = l10n.t(
      '{0}: Select a workspace folder to use. This folder will be used to load workspace-specific configuration for the extension',
      EXTENSION_DISPLAY_NAME,
    );
    const selectedFolder = await window.showWorkspaceFolderPick({
      placeHolder: pickerPlaceholder,
    });

    // Remember the user's selection for future use
    if (selectedFolder) {
      this.context.globalState.update(
        ContextKeys.SelectedWorkspaceFolder,
        selectedFolder.uri.toString(),
      );
    }

    return selectedFolder;
  }

  /**
   * Initializes configuration and sets up a listener for configuration changes.
   * The listener updates context keys and notifies users when the enable state changes.
   *
   * @param selectedWorkspaceFolder - The workspace folder used to load the configuration.
   *
   * @memberof ExtensionRuntime
   *
   * @example
   * const selectedFolder = await extensionRuntime.selectWorkspaceFolder();
   * if (selectedFolder) {
   *   extensionRuntime.initializeConfiguration(selectedFolder);
   * }
   */
  private initializeConfiguration(
    selectedWorkspaceFolder: WorkspaceFolder,
  ): void {
    // Get the configuration for the extension within the selected workspace
    this.config = new ExtensionConfig(
      workspace.getConfiguration(EXTENSION_ID, selectedWorkspaceFolder.uri),
    );

    this.config.workspaceSelection = selectedWorkspaceFolder.uri.fsPath;

    // Watch for changes in the workspace configuration
    workspace.onDidChangeConfiguration((configurationChangeEvent) => {
      const updatedWorkspaceConfig = workspace.getConfiguration(
        EXTENSION_ID,
        selectedWorkspaceFolder.uri,
      );

      if (
        configurationChangeEvent.affectsConfiguration(
          `${EXTENSION_ID}.enable`,
          selectedWorkspaceFolder.uri,
        )
      ) {
        const isExtensionEnabled =
          updatedWorkspaceConfig.get<boolean>('enable');

        this.config.update(updatedWorkspaceConfig);
        void this.setContextKeys(selectedWorkspaceFolder.uri);

        if (isExtensionEnabled) {
          const enabledMessage = l10n.t(
            'The {0} extension is now enabled and ready to use',
            EXTENSION_DISPLAY_NAME,
          );
          window.showInformationMessage(enabledMessage);
        } else {
          const disabledMessage = l10n.t(
            'The {0} extension is now disabled',
            EXTENSION_DISPLAY_NAME,
          );
          window.showInformationMessage(disabledMessage);
        }
      }

      if (
        configurationChangeEvent.affectsConfiguration(
          EXTENSION_ID,
          selectedWorkspaceFolder.uri,
        )
      ) {
        this.config.update(updatedWorkspaceConfig);
      }
    });
  }

  /**
   * Checks if the extension is enabled based on the current configuration.
   * If disabled, shows a warning message to the user (only once).
   *
   * @returns true if the extension is enabled, false otherwise.
   *
   * @memberof ExtensionRuntime
   *
   * @example
   * if (extensionRuntime.isExtensionEnabled()) {
   *   // Execute command handler logic
   * } else {
   *   // Command handler will be skipped and a warning will be shown (only on the first check)
   * }
   */
  private isExtensionEnabled(): boolean {
    const isEnabled = this.config.enable;

    if (isEnabled) {
      this.hasDisabledWarningBeenShown = false;
      return true;
    }

    if (!this.hasDisabledWarningBeenShown) {
      this.showError(
        l10n.t(
          'The {0} extension is disabled in settings. Enable it to use its features',
          EXTENSION_DISPLAY_NAME,
        ),
      );
      this.hasDisabledWarningBeenShown = true;
    }

    return false;
  }

  /**
   * Resolves project context signals and synchronizes VS Code context keys.
   *
   * The runtime intentionally orchestrates detection through shared helpers so
   * context rules stay reusable and out of this class.
   */
  private async setContextKeys(resource?: Uri): Promise<void> {
    const detectedContext = await detectProjectContext({
      resource,
      workspaceSelection: this.config.workspaceSelection,
    });

    await this.applyContext(detectedContext, resource);
  }

  /**
   * Applies the detected context to in-memory state and VS Code UI contexts.
   */
  private async applyContext(
    projectContext: ProjectContext,
    resource?: Uri,
  ): Promise<void> {
    const isEnabled = workspace
      .getConfiguration(EXTENSION_ID, resource)
      .get<boolean>('enable', true);

    const resolvedContexts: ProjectContexts = {
      [ContextKeys.HasRuntime]: projectContext.hasRuntime,
      [ContextKeys.HasFramework]: projectContext.hasFramework,
      [ContextKeys.HasFastApi]: projectContext.hasFastApi,
      [ContextKeys.HasTypeSupport]: projectContext.hasTypeSupport,
      [ContextKeys.IsEnabled]: isEnabled,
    };

    const contextMappings: Array<[ProjectContextKey, boolean]> = [
      [ContextKeys.HasRuntime, resolvedContexts[ContextKeys.HasRuntime]],
      [ContextKeys.HasFramework, resolvedContexts[ContextKeys.HasFramework]],
      [ContextKeys.HasFastApi, resolvedContexts[ContextKeys.HasFastApi]],
      [
        ContextKeys.HasTypeSupport,
        resolvedContexts[ContextKeys.HasTypeSupport],
      ],
      [ContextKeys.IsEnabled, isEnabled],
    ];

    await Promise.all(
      contextMappings.map(async ([key, value]) => {
        this.detectedContexts[key] = value;
        await commands.executeCommand(
          'setContext',
          `${EXTENSION_ID}.${key}`,
          value,
        );
      }),
    );
  }

  /**
   * Registers a VS Code command that is gated by the extension's enabled state.
   * If the extension is disabled when the command is invoked, the handler is skipped.
   *
   * @param commandId - The unique identifier for the command.
   * @param commandHandler - The function to execute when the command is invoked.
   * @returns A disposable that removes the command registration when disposed.
   *
   * @memberof ExtensionRuntime
   *
   * @example
   * const disposable = extensionRuntime.registerCommand(
   *   'pythonGenerator.myCommand',
   *   () => {
   *     // Command handler logic that only runs if the extension is enabled
   *   }
   * );
   * // Remember to dispose of the command when it's no longer needed
   * disposable.dispose();
   */
  private registerCommand<CommandArgs extends unknown[]>(
    commandId: string,
    commandHandler: (...args: CommandArgs) => void | Promise<void>,
    requireResource = true,
  ) {
    return commands.registerCommand(commandId, async (...args: CommandArgs) => {
      try {
        let resource = await this.resolveExecutionResource(args);

        if (!resource) {
          resource = this.resolveFallbackResource();
        }

        if (!resource) {
          if (requireResource) {
            this.showError(
              l10n.t(
                'No valid workspace or file context was found. Open a folder or file and try again.',
              ),
            );
          }

          if (!requireResource) {
            return commandHandler(...args);
          }

          return;
        }

        return commandHandler(...([resource, ...args.slice(1)] as CommandArgs));
      } catch (error) {
        this.showError(
          l10n.t(
            '{0} failed: {1}',
            EXTENSION_DISPLAY_NAME,
            getErrorMessage(error),
          ),
        );
      }
    });
  }

  /**
   * Registers the command that lets users switch the active workspace folder.
   *
   * This command is important for multi-root workspaces where users may want to change which folder the extension operates on.
   * The command updates the global state with the new selection and reloads the configuration accordingly.
   * It also provides user feedback about the workspace change.
   *
   * @memberof ExtensionRuntime
   *
   * @example
   * // The command can be invoked from the command palette or programmatically
   * await commands.executeCommand('pythonGenerator.changeWorkspace');
   */
  private registerWorkspaceCommands(): void {
    // Register a command to change the selected workspace folder
    const disposableChangeWorkspace = commands.registerCommand(
      `${EXTENSION_ID}.${CommandIds.ChangeWorkspace}`,
      async () => {
        try {
          const pickerPlaceholder = l10n.t('Select a workspace folder to use');
          const selectedFolder = await window.showWorkspaceFolderPick({
            placeHolder: pickerPlaceholder,
          });

          if (selectedFolder) {
            this.context.globalState.update(
              ContextKeys.SelectedWorkspaceFolder,
              selectedFolder.uri.toString(),
            );

            // Update configuration for the new workspace folder
            const updatedWorkspaceConfig = workspace.getConfiguration(
              EXTENSION_ID,
              selectedFolder.uri,
            );
            this.config.update(updatedWorkspaceConfig);

            this.config.workspaceSelection = selectedFolder.uri.fsPath;
            await this.setContextKeys(selectedFolder.uri);

            window.showInformationMessage(
              l10n.t('Switched to workspace folder: {0}', selectedFolder.name),
            );
          }
        } catch (error) {
          this.showError(
            l10n.t(
              '{0} failed: {1}',
              EXTENSION_DISPLAY_NAME,
              getErrorMessage(error),
            ),
          );
        }
      },
    );

    this.context.subscriptions.push(disposableChangeWorkspace);
  }

  /**
   * Resolves the execution resource for a command.
   *
   * If a URI is provided in the arguments, it is used directly.
   * Otherwise, attempts to infer the active folder from the workspace context.
   *
   * @param args - Command arguments passed during execution.
   * @returns The resolved URI or undefined if it cannot be determined.
   */
  private async resolveExecutionResource(
    args: unknown[],
  ): Promise<Uri | undefined> {
    const firstArg = args[0];

    if (firstArg instanceof Uri) {
      return firstArg;
    }

    return resolveFolderResource(undefined);
  }

  /**
   * Resolves a best-effort fallback resource when the command was invoked
   * without an explicit URI.
   */
  private resolveFallbackResource(): Uri | undefined {
    const activeEditor = window.activeTextEditor;

    if (activeEditor?.document?.uri) {
      return activeEditor.document.uri;
    }

    const workspaceFolder = workspace.workspaceFolders?.[0];

    if (workspaceFolder) {
      return workspaceFolder.uri;
    }

    return undefined;
  }

  /**
   * Displays an error message to the user.
   *
   * This centralizes error handling to ensure consistency and allow
   * future improvements (e.g., logging or telemetry) without changing call sites.
   *
   * @param message - The message to display.
   */
  private showError(message: string): void {
    window.showErrorMessage(message);
  }

  /**
   * Builds Smart Generate options with lightweight context-aware relevance.
   *
   * Context is used only to prioritize options.
   * All commands remain available to avoid restricting user workflows.
   *
   * @param commandDefinitions Registered command definitions.
   * @param context Project context flags.
   * @returns Ordered options for Smart Generate quick pick.
   */
  private buildGenerateOptions(
    commandDefinitions: Array<{
      name: CommandIds;
      label: string;
      description: string;
      requiresFramework?: boolean;
      prefersTypeSupport?: boolean;
    }>,
    contexts: ProjectContexts,
  ): GenerateOption[] {
    const featureCommands = new Set<CommandIds>([
      CommandIds.GenerateFastApiFeature,
    ]);

    const fileCommands = new Set<CommandIds>([
      CommandIds.GenerateCustomTemplate,
      CommandIds.GeneratePythonScript,
      CommandIds.GeneratePythonModule,
      CommandIds.GenerateCliTool,
      CommandIds.GenerateService,
      CommandIds.GenerateRepository,
      CommandIds.GenerateDTO,
      CommandIds.GenerateFastAPIRoute,
      CommandIds.GenerateDjangoModel,
      CommandIds.GenerateTest,
      CommandIds.GenerateLogger,
    ]);

    const taxonomyByCommand = new Map<
      CommandIds,
      {
        category: 'file' | 'feature' | 'infrastructure' | 'domain' | 'data';
        framework: 'fastapi' | 'django' | 'none';
        tags: string[];
        priority: number;
        recommended: boolean;
      }
    >([
      [
        CommandIds.GenerateFastApiFeature,
        {
          category: 'feature',
          framework: 'fastapi',
          tags: ['api', 'fastapi', 'scaffold'],
          priority: 98,
          recommended: true,
        },
      ],
      [
        CommandIds.GenerateFastAPIRoute,
        {
          category: 'file',
          framework: 'fastapi',
          tags: ['api', 'http', 'router'],
          priority: 95,
          recommended: true,
        },
      ],
      [
        CommandIds.GenerateDjangoModel,
        {
          category: 'file',
          framework: 'django',
          tags: ['data', 'orm', 'model'],
          priority: 78,
          recommended: true,
        },
      ],
      [
        CommandIds.GenerateService,
        {
          category: 'file',
          framework: 'none',
          tags: ['domain', 'service'],
          priority: 85,
          recommended: true,
        },
      ],
      [
        CommandIds.GenerateRepository,
        {
          category: 'file',
          framework: 'none',
          tags: ['data', 'repository'],
          priority: 84,
          recommended: true,
        },
      ],
      [
        CommandIds.GenerateDTO,
        {
          category: 'file',
          framework: 'none',
          tags: ['domain', 'dto', 'schema'],
          priority: 80,
          recommended: true,
        },
      ],
      [
        CommandIds.GenerateCliTool,
        {
          category: 'file',
          framework: 'none',
          tags: ['cli', 'runtime'],
          priority: 82,
          recommended: true,
        },
      ],
      [
        CommandIds.GeneratePythonScript,
        {
          category: 'file',
          framework: 'none',
          tags: ['script'],
          priority: 72,
          recommended: true,
        },
      ],
      [
        CommandIds.GeneratePythonModule,
        {
          category: 'file',
          framework: 'none',
          tags: ['module'],
          priority: 74,
          recommended: true,
        },
      ],
      [
        CommandIds.GenerateTest,
        {
          category: 'file',
          framework: 'none',
          tags: ['testing', 'pytest'],
          priority: 75,
          recommended: true,
        },
      ],
      [
        CommandIds.GenerateLogger,
        {
          category: 'infrastructure',
          framework: 'none',
          tags: ['logging', 'observability'],
          priority: 70,
          recommended: false,
        },
      ],
      [
        CommandIds.GenerateCustomTemplate,
        {
          category: 'file',
          framework: 'none',
          tags: ['template', 'custom'],
          priority: 65,
          recommended: false,
        },
      ],
    ]);

    const options: GenerateOption[] = commandDefinitions.map(
      (commandDefinition) => {
        let score = 0;
        const signals: string[] = [];
        const commandGroup = featureCommands.has(commandDefinition.name)
          ? 'features'
          : 'files';

        const fallbackTaxonomy = {
          category: (featureCommands.has(commandDefinition.name)
            ? 'feature'
            : 'file') as 'file' | 'feature',
          framework: 'none' as const,
          tags: [] as string[],
          priority: 50,
          recommended: false,
        };

        const taxonomy =
          taxonomyByCommand.get(commandDefinition.name) ?? fallbackTaxonomy;

        score += Math.round(taxonomy.priority / 20);
        signals.push(`category:${taxonomy.category}`);

        if (taxonomy.recommended) {
          score += 1;
          signals.push('recommended');
        }

        if (
          contexts[ContextKeys.HasFastApi] &&
          taxonomy.framework === 'fastapi'
        ) {
          score += 5;
          signals.push('framework-fastapi-match');
        }

        if (
          contexts[ContextKeys.HasFramework] &&
          !contexts[ContextKeys.HasFastApi] &&
          taxonomy.framework === 'django'
        ) {
          score += 3;
          signals.push('framework-django-match');
        }

        if (
          contexts[ContextKeys.HasRuntime] &&
          taxonomy.tags.includes('runtime')
        ) {
          score += 2;
          signals.push('runtime-tag-match');
        }

        if (
          contexts[ContextKeys.HasTypeSupport] &&
          (taxonomy.tags.includes('dto') || taxonomy.tags.includes('schema'))
        ) {
          score += 2;
          signals.push('types-tag-match');
        }
        if (commandDefinition.name === CommandIds.GenerateCustomTemplate) {
          signals.push('template');
          score += 1;
        }

        if (contexts[ContextKeys.HasRuntime]) {
          signals.push('runtime');
          score += 1;
        }

        if (contexts[ContextKeys.HasFramework]) {
          signals.push('framework');
          score += 2;
        }

        if (
          contexts[ContextKeys.HasFastApi] &&
          commandDefinition.name === CommandIds.GenerateFastApiFeature
        ) {
          signals.push('fastapi-feature-match');
          score += 6;
        }

        if (
          contexts[ContextKeys.HasRuntime] &&
          !contexts[ContextKeys.HasFramework] &&
          commandDefinition.name === CommandIds.GenerateCliTool
        ) {
          signals.push('runtime-cli-match');
          score += 4;
        }

        if (
          !contexts[ContextKeys.HasFastApi] &&
          commandDefinition.name === CommandIds.GenerateService
        ) {
          signals.push('service-default-match');
          score += 3;
        }

        if (featureCommands.has(commandDefinition.name)) {
          signals.push('feature-command');
          score += 2;
        }

        if (fileCommands.has(commandDefinition.name)) {
          signals.push('file-command');
          score += 1;
        }

        if (contexts[ContextKeys.HasTypeSupport]) {
          signals.push('type-support');
          score += 1;
        }

        if (
          contexts[ContextKeys.HasFramework] &&
          commandDefinition.requiresFramework
        ) {
          signals.push('framework-command');
          score += 3;
        }

        if (
          contexts[ContextKeys.HasTypeSupport] &&
          commandDefinition.prefersTypeSupport
        ) {
          signals.push('type-aware-command');
          score += 2;
        }

        const confidence: 'low' | 'medium' | 'high' =
          score >= 5 ? 'high' : score >= 2 ? 'medium' : 'low';

        return {
          label: commandDefinition.label,
          description: commandDefinition.description,
          commandId: commandDefinition.name,
          group: commandGroup,
          score,
          signals,
          confidence,
        };
      },
    );

    const maxScore = Math.max(...options.map((option) => option.score), 0);
    const topOptions = options.filter((option) => option.score === maxScore);

    if (topOptions.length === 1 && topOptions[0].confidence === 'high') {
      topOptions[0].isSuggested = true;
    }

    options.sort(
      (leftOption, rightOption) =>
        rightOption.score - leftOption.score ||
        leftOption.label.localeCompare(rightOption.label),
    );

    return options;
  }

  /**
   * Suggestion system v2:
   * - Uses signals instead of raw score
   * - Avoids false positives
   * - Only suggests when confidence is high and unambiguous
   *
   * Options are grouped in visual sections so users can scan and decide faster.
   */
  private buildSmartGenerateItems(options: GenerateOption[]): GenerateOption[] {
    const suggestedOption = options.find(
      (option) => option.isSuggested && option.confidence === 'high',
    );
    const remainingOptions = options.filter(
      (option) => option !== suggestedOption,
    );

    const suggestedItems: GenerateOption[] = suggestedOption
      ? [
          {
            ...suggestedOption,
            description: `⭐ Recommended • ${suggestedOption.description ?? ''}`,
            picked:
              suggestedOption.isSuggested &&
              suggestedOption.confidence === 'high',
          },
        ]
      : [];

    const fastApiItems: GenerateOption[] = remainingOptions
      .filter(
        (option) =>
          option.commandId === CommandIds.GenerateFastApiFeature ||
          option.commandId === CommandIds.GenerateFastAPIRoute,
      )
      .map((option) => ({
        ...option,
        description: `FastAPI • ${option.description ?? ''}`,
        picked: false,
      }));
    const dataItems: GenerateOption[] = remainingOptions
      .filter(
        (option) =>
          option.commandId === CommandIds.GenerateDTO ||
          option.commandId === CommandIds.GenerateDjangoModel ||
          option.commandId === CommandIds.GenerateRepository,
      )
      .map((option) => ({
        ...option,
        description: `Data • ${option.description ?? ''}`,
        picked: false,
      }));
    const testingItems: GenerateOption[] = remainingOptions
      .filter((option) => option.commandId === CommandIds.GenerateTest)
      .map((option) => ({
        ...option,
        description: `Testing • ${option.description ?? ''}`,
        picked: false,
      }));
    const utilityItems: GenerateOption[] = remainingOptions
      .filter(
        (option) =>
          option.commandId !== CommandIds.GenerateFastApiFeature &&
          option.commandId !== CommandIds.GenerateFastAPIRoute &&
          option.commandId !== CommandIds.GenerateDTO &&
          option.commandId !== CommandIds.GenerateDjangoModel &&
          option.commandId !== CommandIds.GenerateRepository &&
          option.commandId !== CommandIds.GenerateTest,
      )
      .map((option) => ({
        ...option,
        description: `Utility • ${option.description ?? ''}`,
        picked: false,
      }));

    const items: GenerateOption[] = [
      ...suggestedItems,
      ...fastApiItems,
      ...dataItems,
      ...testingItems,
      ...utilityItems,
    ];

    if (items.length === 0) {
      return options;
    }

    return items;
  }

  /**
   * Registers all commands related to file operations.
   *
   * Commands are registered with handlers that delegate to the FileGeneratorService, which encapsulates the logic for each operation.
   * This keeps the command registration clean and focused on wiring up user actions to controller logic.
   *
   * The registered commands are template-based generation actions.
   *
   * @memberof ExtensionRuntime
   */
  private registerGeneratorCommands(): void {
    const invoker = new CommandInvoker();

    const commandList = [
      {
        name: CommandIds.GenerateCustomTemplate,
        label: l10n.t('Custom Template'),
        description: l10n.t('File from a custom JSON template'),
        handler: new GenerateCustomTemplateCommand(this.config, this.context),
      },
      {
        name: CommandIds.GeneratePythonScript,
        label: l10n.t('Python Script'),
        description: l10n.t('Standalone script'),
        handler: new GeneratePythonScriptCommand(this.config, this.context),
      },
      {
        name: CommandIds.GeneratePythonModule,
        label: l10n.t('Python Module'),
        description: l10n.t('Reusable module'),
        prefersTypeSupport: true,
        handler: new GeneratePythonModuleCommand(this.config, this.context),
      },
      {
        name: CommandIds.GenerateCliTool,
        label: l10n.t('Python CLI Tool'),
        description: l10n.t('CLI with argparse'),
        handler: new GenerateCliToolCommand(this.config, this.context),
      },
      {
        name: CommandIds.GenerateService,
        label: l10n.t('Python Service'),
        description: l10n.t('Service class for business logic'),
        handler: new GenerateServiceCommand(this.config, this.context),
      },
      {
        name: CommandIds.GenerateRepository,
        label: l10n.t('Python Repository'),
        description: l10n.t('Data access repository'),
        handler: new GenerateRepositoryCommand(this.config, this.context),
      },
      {
        name: CommandIds.GenerateDTO,
        label: l10n.t('Pydantic DTO'),
        description: l10n.t('Typed data schema'),
        prefersTypeSupport: true,
        handler: new GenerateDTOCommand(this.config, this.context),
      },
      {
        name: CommandIds.GenerateTest,
        label: l10n.t('Pytest Test'),
        description: l10n.t('Test module'),
        handler: new GenerateTestCommand(this.config, this.context),
      },
      {
        name: CommandIds.GenerateLogger,
        label: l10n.t('Logger Setup'),
        description: l10n.t('Logger configuration module'),
        handler: new GenerateLoggerCommand(this.config, this.context),
      },
      {
        name: CommandIds.GenerateFastAPIRoute,
        label: l10n.t('FastAPI Route'),
        description: l10n.t('Route module'),
        requiresFramework: true,
        handler: new GenerateFastAPIRouteCommand(this.config, this.context),
      },
      {
        name: CommandIds.GenerateFastApiFeature,
        label: l10n.t('FastAPI Feature'),
        description: l10n.t('Complete feature (router, service, schema)'),
        requiresFramework: true,
        prefersTypeSupport: true,
        handler: new GenerateFastApiFeatureCommand(this.config, this.context),
      },
      {
        name: CommandIds.GenerateDjangoModel,
        label: l10n.t('Django Model'),
        description: l10n.t('Django ORM model'),
        requiresFramework: true,
        prefersTypeSupport: true,
        handler: new GenerateDjangoModelCommand(this.config, this.context),
      },
    ];

    commandList.forEach(({ name, handler }) => {
      invoker.register(name, handler);

      const disposable = this.registerCommand(
        `${EXTENSION_ID}.${name}`,
        async (uri: Uri) => await invoker.execute(name, uri),
      );

      this.context.subscriptions.push(disposable);
    });

    const disposableSmartGenerate = this.registerCommand(
      `${EXTENSION_ID}.${CommandIds.Generate}`,
      async (uri: Uri) => {
        const options = this.buildGenerateOptions(
          commandList.map((commandDefinition) => ({
            name: commandDefinition.name,
            label: commandDefinition.label,
            description: commandDefinition.description,
            requiresFramework: commandDefinition.requiresFramework,
            prefersTypeSupport: commandDefinition.prefersTypeSupport,
          })),
          this.detectedContexts,
        );
        const items = this.buildSmartGenerateItems(options);

        const selectedItem = await window.showQuickPick(items, {
          placeHolder: l10n.t('Select a file type'),
          matchOnDescription: true,
        });

        if (!selectedItem || !('commandId' in selectedItem)) {
          return;
        }

        await invoker.execute(selectedItem.commandId, uri);

        window.showInformationMessage(
          this.getGenerationSuccessMessage(
            selectedItem.commandId,
            selectedItem.label,
          ),
        );
      },
      false,
    );

    this.context.subscriptions.push(disposableSmartGenerate);
  }

  /**
   * Returns a short success message after generation.
   */
  private getGenerationSuccessMessage(
    commandId: CommandIds,
    label: string,
  ): string {
    switch (commandId) {
      case CommandIds.GenerateFastApiFeature:
        return l10n.t(
          'FastAPI feature created successfully. Next: register the router in your app.',
        );
      case CommandIds.GenerateFastAPIRoute:
        return l10n.t(
          'FastAPI route created successfully. Next: wire it into your app router.',
        );
      case CommandIds.GenerateCliTool:
        return l10n.t(
          'CLI tool created successfully. Next: connect the entry point to your project.',
        );
      case CommandIds.GeneratePythonScript:
        return l10n.t(
          'Python script created successfully. Next: edit the generated file and run it.',
        );
      case CommandIds.GenerateDjangoModel:
        return l10n.t(
          'Django model created successfully. Next: add it to your app and run migrations.',
        );
      default:
        return l10n.t('{0} created successfully.', label);
    }
  }
}
