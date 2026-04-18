import { existsSync, promises as fs } from 'fs';
import mustache from 'mustache';
import { isAbsolute, join, normalize, relative } from 'path';
import { ExtensionContext, l10n, Uri, window, workspace } from 'vscode';

import { ContentTemplate, ExtensionConfig } from '../configs';
import {
  camelize,
  constantize,
  generateQuickPickOption,
  getCustomTemplateByName,
  getErrorMessage,
  kebabize,
  pascalize,
  pluralize,
  resolveFolderResource,
  saveFile as saveWorkspaceFile,
  sentenceCase,
  singularize,
  snakeize,
  titleize,
} from '../helpers';
import { validateTemplate } from '../validators/template.validator';

/**
 * Generates files from templates and user input.
 *
 * The service owns the orchestration around template resolution, name prompts,
 * path validation, content generation and file persistence.
 *
 * @class
 * @example
 * const service = new FileGeneratorService(config);
 */
export class FileGeneratorService {
  // -----------------------------------------------------------------
  // Properties
  // -----------------------------------------------------------------

  // Private properties

  /** Template directory cache. */
  private templatesDir: string | undefined;

  /** Template catalog cache loaded from templates/*.json. */
  private templateCatalog: ContentTemplate[] | undefined;

  /** Backward-compatible aliases for old template names and semantic duplicates. */
  private readonly templateAliases: Record<string, string> = {
    'python-script': 'script',
    'python-module': 'module',
    'fastapi-route': 'fastapi-router',
    generic: 'template',
  };

  /** Lightweight schema defaults for progressive metadata. */
  private readonly defaultOutputFileName = '{{fileNameSnakeCase}}.py';

  // -----------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------

  /**
   * The constructor.
   *
   * @param {ExtensionConfig} config - The extension configuration.
   * @memberof FileGeneratorService
   */
  constructor(
    private readonly config: ExtensionConfig,
    private readonly context: ExtensionContext,
  ) {}

  // -----------------------------------------------------------------
  // Methods
  // -----------------------------------------------------------------

  // Public methods

  /**
   * Generates a file from a user-selected custom template.
   *
   * @param folderPath Folder context supplied by VS Code.
   */
  async generateCustomTemplate(folderPath?: Uri): Promise<void> {
    await this.createCustomTemplateFile(folderPath);
  }

  /**
   * Generates a file using a predefined template type.
   *
   * @param templateType Template type key (for example: script, module).
   * @param folderPath Folder context supplied by VS Code.
   */
  async generateTemplateByType(
    templateType: string,
    folderPath?: Uri,
  ): Promise<void> {
    const selectedTemplate = await this.resolveTemplateByType(templateType);

    if (!selectedTemplate) {
      throw new Error(l10n.t('Template "{0}" not found.', templateType));
    }

    const generatedFileName = await this.promptInput(
      l10n.t(
        'Enter the file name for the custom template. The file extension will be added automatically',
      ),
      l10n.t('Enter the file name, e.g. User, Product, Order, etc'),
    );

    if (!generatedFileName) {
      const message = l10n.t('Operation cancelled!');
      window.showInformationMessage(message);
      return;
    }

    if (selectedTemplate.kind === 'multi' || selectedTemplate.multiFile) {
      await this.createMultiTemplateFiles(
        folderPath,
        selectedTemplate,
        generatedFileName,
      );
      return;
    }

    await this.createTemplateFile(
      folderPath,
      selectedTemplate,
      generatedFileName,
    );
  }

  /**
   * Generates a FastAPI feature with multiple files.
   *
   * Output structure:
   * - router.py
   * - service.py
   * - schema.py
   * - repository.py
   */
  async generateFastApiFeature(folderPath?: Uri): Promise<void> {
    const featureName = await this.promptInput(
      l10n.t('Enter the FastAPI feature name'),
      l10n.t('Enter the feature name, e.g. users, billing, orders'),
    );

    if (!featureName) {
      window.showInformationMessage(l10n.t('Operation cancelled!'));
      return;
    }

    const { fileExtension, skipFolderConfirmation } = this.config;

    const targetFolderUri = await resolveFolderResource(folderPath);
    if (!targetFolderUri) {
      this.showError(
        l10n.t(
          'No valid workspace or file context was found. Open a folder or file and try again.',
        ),
      );
      return;
    }

    const workspaceRoot = (workspace.getWorkspaceFolder(targetFolderUri) ??
      workspace.workspaceFolders?.[0])!;
    // Convert absolute target location to workspace-relative path for safe validation.
    const relativeFolderPath =
      relative(workspaceRoot.uri.fsPath, targetFolderUri.fsPath) || '.';

    let folderName: string | undefined;

    if (!folderPath || !skipFolderConfirmation) {
      folderName = await this.promptInput(
        l10n.t(
          'Enter the base folder where the FastAPI feature will be created',
        ),
        l10n.t('Enter the folder name, e.g. app/features, src/api, modules'),
        relativeFolderPath,
        (path) =>
          !/^(?!\/)[^\sÀ-ÿ]+?$/.test(path)
            ? l10n.t(
                'The folder name is invalid! Please enter a valid folder name',
              )
            : undefined,
      );

      if (folderName === undefined) {
        window.showInformationMessage(l10n.t('Operation cancelled!'));
        return;
      }
    } else {
      folderName = relativeFolderPath;
    }

    const safeFolderName = folderName?.trim() || '.';

    const isValid = this.isSafeRelativeFolderPath(safeFolderName);

    if (!isValid) {
      const message = l10n.t(
        'The folder name is invalid. Please provide a relative path within the workspace and avoid ".."',
      );
      this.showError(message);
      return;
    }

    const featureFolderName = snakeize(featureName);
    const featureRootFolder = join(
      workspaceRoot.uri.fsPath,
      safeFolderName,
      featureFolderName,
    );
    const featureRelativeFolder = join(safeFolderName, featureFolderName);

    const featureTemplate = await this.resolveTemplateByType('fastapi-feature');

    if (
      featureTemplate &&
      (featureTemplate.kind === 'multi' || featureTemplate.multiFile)
    ) {
      for (const fileRef of featureTemplate.files ?? []) {
        const selectedTemplate = await this.resolveTemplateByType(fileRef);

        if (!selectedTemplate) {
          throw new Error(
            l10n.t('Referenced template "{0}" not found.', fileRef),
          );
        }

        const content = this.generateFileContent(selectedTemplate.template);
        const variables = this.getVariables(
          featureRelativeFolder,
          featureName,
          selectedTemplate.type,
          fileExtension,
        );
        const fileContent = mustache.render(content, variables);
        const renderedFileName = selectedTemplate.output?.fileName
          ? mustache.render(selectedTemplate.output.fileName, variables)
          : `${selectedTemplate.type}.${fileExtension}`;
        const renderedTemplateFolder = selectedTemplate.output?.folder
          ? mustache.render(selectedTemplate.output.folder, variables)
          : '';

        await saveWorkspaceFile(
          join(featureRootFolder, renderedTemplateFolder),
          renderedFileName,
          fileContent,
          this.config,
        );
      }

      return;
    }

    const generatedFiles = [
      { templateType: 'fastapi-router', fileName: 'router' },
      { templateType: 'fastapi-service', fileName: 'service' },
      { templateType: 'fastapi-schema', fileName: 'schema' },
      { templateType: 'fastapi-repository', fileName: 'repository' },
    ] as const;

    for (const generatedFile of generatedFiles) {
      const selectedTemplate = await this.resolveTemplateByType(
        generatedFile.templateType,
      );

      if (!selectedTemplate) {
        throw new Error(
          l10n.t('Template "{0}" not found.', generatedFile.templateType),
        );
      }

      const content = this.generateFileContent(selectedTemplate.template);
      const fileContent = mustache.render(
        content,
        this.getVariables(
          featureRelativeFolder,
          featureName,
          selectedTemplate.type,
          fileExtension,
        ),
      );

      await saveWorkspaceFile(
        featureRootFolder,
        `${generatedFile.fileName}.${fileExtension}`,
        fileContent,
        this.config,
      );
    }
  }

  // Private methods

  /**
   * Gets the templates directory path.
   * The path is resolved from the extension's installation directory.
   *
   * @returns Path to the templates directory
   * @private
   */
  private getTemplatesDir(): string {
    if (!this.templatesDir) {
      this.templatesDir = normalize(
        join(this.context.extensionPath, 'templates'),
      );
    }
    return this.templatesDir;
  }

  /**
   * Loads a template from a JSON file in the /templates directory.
   *
   * @param templateType Template type identifier (script, module, etc.)
   * @returns Template object if file exists, undefined otherwise
   * @private
   */
  private async loadTemplateFromFile(
    templateType: string,
  ): Promise<ContentTemplate | undefined> {
    const templatesDir = this.getTemplatesDir();
    const templatePath = normalize(join(templatesDir, `${templateType}.json`));

    if (!existsSync(templatePath)) {
      return undefined;
    }

    try {
      const raw = await fs.readFile(templatePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<ContentTemplate>;
      const validated = validateTemplate(parsed);
      return this.normalizeTemplate({ ...parsed, ...validated }, templateType);
    } catch {
      return undefined;
    }
  }

  /**
   * Loads the full template catalog from templates/*.json.
   */
  private async loadTemplateCatalog(): Promise<ContentTemplate[]> {
    if (this.templateCatalog) {
      return this.templateCatalog;
    }

    const templatesDir = this.getTemplatesDir();

    try {
      const entries = await fs.readdir(templatesDir, { withFileTypes: true });
      const templateFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name);

      const catalog = await Promise.all(
        templateFiles.map(async (templateFile) => {
          const templatePath = normalize(join(templatesDir, templateFile));
          const raw = await fs.readFile(templatePath, 'utf-8');
          const parsed = JSON.parse(raw) as Partial<ContentTemplate>;
          const validated = validateTemplate(parsed);
          const fallbackKey = templateFile.replace(/\.json$/i, '');
          return this.normalizeTemplate(
            { ...parsed, ...validated },
            fallbackKey,
          );
        }),
      );

      this.validateTemplateCatalog(catalog);

      this.templateCatalog = catalog;
      return catalog;
    } catch (error) {
      this.showError(
        l10n.t('Template validation failed: {0}', getErrorMessage(error)),
      );
      this.templateCatalog = [];
      return this.templateCatalog;
    }
  }

  /**
   * Maps a template key to canonical key using aliases.
   */
  private getCanonicalTemplateKey(templateType: string): string {
    const normalized = templateType.toLowerCase();
    return this.templateAliases[normalized] ?? normalized;
  }

  /**
   * Normalizes a potentially minimal template into an internal shape.
   * Users can provide only id + template and the system infers the rest.
   */
  private normalizeTemplate(
    input: Partial<ContentTemplate>,
    fallbackKey: string,
  ): ContentTemplate {
    const baseKey =
      (typeof input.id === 'string' && input.id.trim().length > 0
        ? input.id
        : typeof input.type === 'string' && input.type.trim().length > 0
          ? input.type
          : fallbackKey) ?? fallbackKey;

    const canonicalKey = this.getCanonicalTemplateKey(baseKey);
    const expandedId = canonicalKey.includes('.')
      ? canonicalKey
      : `python.file.${canonicalKey}`;

    const normalizedId = expandedId.toLowerCase();
    const idParts = normalizedId.split('.').filter((part) => part.length > 0);
    const leaf = idParts[idParts.length - 1] ?? 'template';
    const inferredType =
      typeof input.type === 'string' && input.type.trim().length > 0
        ? input.type.trim().toLowerCase()
        : leaf;

    const files = Array.isArray(input.files)
      ? input.files
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : undefined;

    const inferredKind: 'file' | 'multi' =
      files && files.length > 0 ? 'multi' : 'file';
    const normalizedKind =
      input.kind === 'multi' || input.multiFile ? 'multi' : inferredKind;
    const inferredFramework: 'fastapi' | 'django' | 'none' =
      normalizedId.includes('fastapi')
        ? 'fastapi'
        : normalizedId.includes('django')
          ? 'django'
          : 'none';
    const inferredSubcategory: NonNullable<ContentTemplate['subcategory']> =
      normalizedId.includes('.repository')
        ? 'data'
        : normalizedId.includes('.service')
          ? 'domain'
          : normalizedId.includes('.dto') || normalizedId.includes('.schema')
            ? 'domain'
            : normalizedId.includes('.test')
              ? 'testing'
              : normalizedId.includes('.logger')
                ? 'logging'
                : normalizedId.includes('.cli')
                  ? 'cli'
                  : normalizedId.includes('fastapi') ||
                      normalizedId.includes('django')
                    ? 'api'
                    : 'domain';

    const inferredCategory: ContentTemplate['category'] = normalizedId.endsWith(
      '.feature',
    )
      ? 'feature'
      : normalizedId.includes('.repository')
        ? 'data'
        : normalizedId.includes('.service')
          ? 'domain'
          : 'file';

    const inferredTags = Array.from(
      new Set(
        idParts.filter(
          (part) =>
            !['python', 'file', 'feature', 'domain', 'data', 'api'].includes(
              part,
            ),
        ),
      ),
    );

    const normalizedTemplateLines = Array.isArray(input.template)
      ? input.template.filter(
          (line): line is string => typeof line === 'string',
        )
      : [];

    const output = {
      fileName:
        input.output?.fileName && input.output.fileName.length > 0
          ? input.output.fileName
          : this.defaultOutputFileName,
      folder: input.output?.folder ?? '',
    };

    return {
      id: normalizedId,
      name:
        input.name && input.name.trim().length > 0
          ? input.name
          : titleize(leaf),
      description:
        input.description && input.description.trim().length > 0
          ? input.description
          : `${titleize(leaf)} template`,
      type: inferredType,
      category: input.category ?? inferredCategory,
      subcategory: input.subcategory ?? inferredSubcategory,
      tags: input.tags && input.tags.length > 0 ? input.tags : inferredTags,
      framework: input.framework ?? inferredFramework,
      language: input.language ?? 'python',
      kind: normalizedKind,
      multiFile: input.multiFile ?? normalizedKind === 'multi',
      output,
      files,
      priority: input.priority,
      complexity: input.complexity,
      usage: input.usage,
      recommended: input.recommended,
      template: normalizedTemplateLines,
    };
  }

  /**
   * Lightweight schema validation.
   * - Requires id and template field
   * - Prevents duplicate ids
   * - Ensures multi-file references resolve by id or type
   */
  private validateTemplateCatalog(templates: ContentTemplate[]): void {
    const idSet = new Set<string>();
    const typeSet = new Set<string>();

    for (const template of templates) {
      const id = template.id?.trim();

      if (!id) {
        throw new Error(l10n.t('Template validation failed: missing id.'));
      }

      if (!Array.isArray(template.template)) {
        throw new Error(
          `Template validation failed for "${id}": missing template.`,
        );
      }

      if (idSet.has(id)) {
        throw new Error(
          l10n.t('Template validation failed: duplicate id "{0}".', id),
        );
      }

      idSet.add(id);
      typeSet.add(template.type.toLowerCase());
    }

    for (const template of templates) {
      const isMulti = template.kind === 'multi' || template.multiFile;
      if (!isMulti) {
        continue;
      }

      const templateId = template.id ?? 'unknown template';

      if (!template.files || template.files.length === 0) {
        throw new Error(
          l10n.t(
            'Template validation failed: multi template "{0}" must define at least one file reference.',
            templateId,
          ),
        );
      }

      for (const ref of template.files ?? []) {
        const normalizedRef = this.getCanonicalTemplateKey(ref);
        const refAsId = normalizedRef.includes('.')
          ? normalizedRef
          : `python.file.${normalizedRef}`;

        if (!idSet.has(refAsId) && !typeSet.has(normalizedRef)) {
          throw new Error(
            l10n.t(
              'Template validation failed: unresolved multi-file reference "{0}" in "{1}".',
              ref,
              templateId,
            ),
          );
        }
      }
    }
  }

  /**
   * Resolves the selected custom template and writes the generated file.
   *
   * @param folderPath Folder context supplied by VS Code.
   */
  private async createCustomTemplateFile(
    folderPath: Uri | undefined,
  ): Promise<void> {
    const customTemplates = this.config.customTemplates.map((template) =>
      this.normalizeTemplate(
        template,
        template.id ?? template.type ?? 'custom',
      ),
    );

    if (customTemplates.length === 0) {
      const message = l10n.t(
        'The custom templates list is empty. Please add custom templates to the configuration',
      );
      this.showError(message);
      return;
    }

    const templateOptions = customTemplates.map(generateQuickPickOption);

    const selectedTemplateOption = await window.showQuickPick(templateOptions, {
      placeHolder: l10n.t('Select a template for file generation'),
    });

    if (!selectedTemplateOption) {
      const message = l10n.t('Operation cancelled!');
      window.showInformationMessage(message);
      return;
    }

    const generatedFileName = await this.promptInput(
      l10n.t(
        'Enter the file name for the custom template. The file extension will be added automatically',
      ),
      l10n.t('Enter the file name, e.g. User, Product, Order, etc'),
    );

    if (!generatedFileName) {
      const message = l10n.t('Operation cancelled!');
      window.showInformationMessage(message);
      return;
    }

    const selectedTemplate = getCustomTemplateByName(
      customTemplates,
      selectedTemplateOption.label,
    );

    if (!selectedTemplate) {
      const message = l10n.t(
        'The template for the custom file does not exist. Please try again',
      );
      this.showError(message);
      return;
    }

    await this.createTemplateFile(
      folderPath,
      selectedTemplate,
      generatedFileName,
    );
  }

  /**
   * Shared file creation flow for selected templates.
   */
  private async createTemplateFile(
    folderPath: Uri | undefined,
    selectedTemplate: ContentTemplate,
    generatedFileName: string,
  ): Promise<void> {
    const { fileExtension, skipFolderConfirmation, includeTypeInFileName } =
      this.config;

    const targetFolderUri = await resolveFolderResource(folderPath);
    if (!targetFolderUri) {
      this.showError(
        l10n.t(
          'No valid workspace or file context was found. Open a folder or file and try again.',
        ),
      );
      return;
    }

    const workspaceRoot = (workspace.getWorkspaceFolder(targetFolderUri) ??
      workspace.workspaceFolders?.[0])!;
    // Convert absolute target location to workspace-relative path for safe validation.
    const relativeFolderPath: string =
      relative(workspaceRoot.uri.fsPath, targetFolderUri.fsPath) || '.';

    let folderName: string | undefined;

    if (!folderPath || !skipFolderConfirmation) {
      folderName = await this.promptInput(
        l10n.t(
          'Enter the folder name where the custom template file will be created',
        ),
        l10n.t('Enter the folder name, e.g. app, shared, api, etc'),
        relativeFolderPath,
        (path) =>
          !/^(?!\/)[^\sÀ-ÿ]+?$/.test(path)
            ? l10n.t(
                'The folder name is invalid! Please enter a valid folder name',
              )
            : undefined,
      );

      if (folderName === undefined) {
        const message = l10n.t('Operation cancelled!');
        window.showInformationMessage(message);
        return;
      }
    } else {
      folderName = relativeFolderPath;
    }

    const safeFolderName = folderName?.trim() || '.';

    const isValid = this.isSafeRelativeFolderPath(safeFolderName);

    if (!isValid) {
      const message = l10n.t(
        'The folder name is invalid. Please provide a relative path within the workspace and avoid ".."',
      );
      this.showError(message);
      return;
    }

    const content = this.generateFileContent(selectedTemplate.template);

    const fileContent = mustache.render(
      content,
      this.getVariables(
        safeFolderName,
        generatedFileName,
        selectedTemplate.type,
        fileExtension,
      ),
    );

    const renderedTemplateFileName = selectedTemplate.output?.fileName
      ? mustache.render(
          selectedTemplate.output.fileName,
          this.getVariables(
            safeFolderName,
            generatedFileName,
            selectedTemplate.type,
            fileExtension,
          ),
        )
      : undefined;

    const renderedTemplateFolder = selectedTemplate.output?.folder
      ? mustache.render(
          selectedTemplate.output.folder,
          this.getVariables(
            safeFolderName,
            generatedFileName,
            selectedTemplate.type,
            fileExtension,
          ),
        )
      : '';

    const resolvedFolderPath = join(
      workspaceRoot.uri.fsPath,
      safeFolderName,
      renderedTemplateFolder,
    );
    const fileNameSuffix = includeTypeInFileName
      ? `.${selectedTemplate.type}`
      : '';
    const fileName =
      renderedTemplateFileName && renderedTemplateFileName.length > 0
        ? renderedTemplateFileName
        : `${generatedFileName}${fileNameSuffix}.${fileExtension}`;

    void saveWorkspaceFile(
      resolvedFolderPath,
      fileName,
      fileContent,
      this.config,
    );
  }

  /**
   * Creates a set of files from a multi-file template.
   */
  private async createMultiTemplateFiles(
    folderPath: Uri | undefined,
    selectedTemplate: ContentTemplate,
    generatedFileName: string,
  ): Promise<void> {
    const fileRefs = selectedTemplate.files ?? [];

    if (fileRefs.length === 0) {
      throw new Error(
        l10n.t('Template "{0}" does not define files.', selectedTemplate.type),
      );
    }

    for (const fileRef of fileRefs) {
      const nestedTemplate = await this.resolveTemplateByType(fileRef);

      if (!nestedTemplate) {
        throw new Error(
          l10n.t('Referenced template "{0}" not found.', fileRef),
        );
      }

      await this.createTemplateFile(
        folderPath,
        nestedTemplate,
        generatedFileName,
      );
    }
  }

  /**
   * Resolves templates by type: user config first, then JSON files.
   *
   * Resolution order:
   * 1. User-defined custom templates from configuration
   * 2. Built-in templates from /templates/{type}.json files (single source of truth)
   *
   * @param templateType Template type key (script, module, fastapi-route, etc.)
   * @returns Template if found, undefined otherwise
   * @private
   */
  private async resolveTemplateByType(
    templateType: string,
  ): Promise<ContentTemplate | undefined> {
    const normalizedTemplateType = this.getCanonicalTemplateKey(templateType);

    const customTemplate = this.config.customTemplates
      .map((template) =>
        this.normalizeTemplate(
          template,
          template.id ?? template.type ?? normalizedTemplateType,
        ),
      )
      .find((template) => {
        const templateId = template.id?.toLowerCase();
        const templateTypeName = template.type.toLowerCase();
        return (
          templateTypeName === normalizedTemplateType ||
          templateId === normalizedTemplateType
        );
      });

    if (customTemplate) {
      return customTemplate;
    }

    const catalog = await this.loadTemplateCatalog();
    const templateFromCatalog = catalog.find((template) => {
      const templateId = template.id?.toLowerCase();
      const typeName = template.type.toLowerCase();
      return (
        typeName === normalizedTemplateType ||
        templateId === normalizedTemplateType
      );
    });

    if (templateFromCatalog) {
      return templateFromCatalog;
    }

    // Legacy fallback by file name for partially normalized catalogs.
    return await this.loadTemplateFromFile(normalizedTemplateType);
  }

  /**
   * Prompts the user for input with optional validation.
   *
   * @param prompt Prompt text shown to the user.
   * @param placeholder Input placeholder text.
   * @param defaultValue Initial value.
   * @param validateInput Validation callback.
   */
  private async promptInput(
    prompt: string,
    placeholder: string,
    defaultValue?: string,
    validateInput?: (input: string) => string | undefined,
  ): Promise<string | undefined> {
    return window.showInputBox({
      prompt,
      placeHolder: placeholder,
      value: defaultValue,
      validateInput,
    });
  }

  /**
   * Centralized error message display for generation flows.
   */
  private showError(message: string): void {
    window.showErrorMessage(message);
  }

  /**
   * Checks that a folder path is workspace-relative and safe.
   */
  private isSafeRelativeFolderPath(folderName: string): boolean {
    const normalizedFolder = normalize(folderName);
    return !(
      isAbsolute(normalizedFolder) ||
      /(^|[\\/])\.\.(?:[\\/]|$)/.test(normalizedFolder)
    );
  }

  /**
   * Normalizes template content before rendering.
   *
   * @param templateLines Raw template lines.
   */
  private generateFileContent(templateLines: string[]): string {
    const {
      excludeSemiColonAtEndOfLine,
      useSingleQuotes,
      endOfLine,
      useStrict,
      headerCommentTemplate,
      insertFinalNewline,
    } = this.config;

    const quote = useSingleQuotes ? "'" : '"';
    const newline = endOfLine === 'crlf' ? '\r\n' : '\n';

    let content: string = '';

    if (headerCommentTemplate.length > 0) {
      content += headerCommentTemplate.join(newline) + newline + newline;
    }

    if (useStrict) {
      content += `${quote}use strict${quote};${newline}${newline}`;
    }

    content += templateLines.join(newline);

    // Add a final newline
    if (insertFinalNewline) {
      content += newline;
    }

    if (excludeSemiColonAtEndOfLine) {
      content = content.replace(/;$/, '');
    }

    return content;
  }

  /**
   * Builds the mustache variables used by template rendering.
   *
   * @param folderName Relative folder name for the generated file.
   * @param componentName Generated file base name.
   * @param fileType Template type.
   * @param fileExtension Selected file extension.
   */
  private getVariables(
    folderName: string,
    componentName: string,
    fileType: string,
    fileExtension: string,
  ): Record<string, string | number> {
    const { author, owner, maintainers, license, version } = this.config;

    return {
      fileName: componentName,
      fileNameCamelCase: camelize(componentName),
      fileNamePascalCase: pascalize(componentName),
      fileNameKebabCase: kebabize(componentName),
      fileNameSnakeCase: snakeize(componentName),
      fileNameConstantCase: constantize(componentName),
      fileNameDotCase: componentName.replace(/\s+/g, '.').toLowerCase(),
      fileNamePathCase: componentName.replace(/\s+/g, '/').toLowerCase(),
      fileNameSentenceCase: sentenceCase(componentName),
      fileNameLowerCase: componentName.toLowerCase(),
      fileNameTitleCase: titleize(componentName),
      fileNamePluralCase: pluralize(componentName),
      fileNameSingularCase: singularize(componentName),
      fileNameWithTypeAndExtension: `${componentName}.${fileType}.${fileExtension}`,
      fileNameWithType: `${componentName}.${fileType}`,
      fileNameWithExtension: `${componentName}.${fileExtension}`,
      featureName: componentName,
      featureNameCamelCase: camelize(componentName),
      featureNamePascalCase: pascalize(componentName),
      featureNameKebabCase: kebabize(componentName),
      featureNameSnakeCase: snakeize(componentName),
      folderName,
      fileType,
      fileTypeName: titleize(fileType),
      fileTypeNameCamelCase: camelize(fileType),
      fileTypeNamePascalCase: pascalize(fileType),
      fileTypeNameKebabCase: kebabize(fileType),
      fileTypeNameSnakeCase: snakeize(fileType),
      fileTypeNameConstantCase: constantize(fileType),
      fileTypeNameDotCase: fileType.replace(/\s+/g, '.').toLowerCase(),
      fileTypeNamePathCase: fileType.replace(/\s+/g, '/').toLowerCase(),
      fileTypeNameSentenceCase: sentenceCase(fileType),
      fileTypeNameLowerCase: fileType.toLowerCase(),
      fileTypeNameUpperCase: fileType.toUpperCase(),
      fileTypeNamePlural: pluralize(fileType),
      fileTypeNameSingular: singularize(fileType),
      fileTypeWithExtension: `${fileType}.${fileExtension}`,
      fileExtension,
      date: new Date().toISOString().split('T')[0],
      year: new Date().getFullYear(),
      time: new Date().toLocaleTimeString(),
      timestamp: new Date().getTime(),
      timestampISO: new Date().toISOString(),
      timestampUTC: new Date().toUTCString(),
      timestampLocale: new Date().toLocaleString(),
      timestampDate: new Date().toDateString(),
      timestampTime: new Date().toTimeString(),
      timestampLocaleDate: new Date().toLocaleDateString(),
      author,
      owner,
      maintainers,
      license,
      version,
    };
  }
}
