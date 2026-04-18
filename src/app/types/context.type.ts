/**
 * Project-level context signals used to drive command visibility and prioritization.
 *
 * This model is intentionally framework-agnostic and independent from VS Code
 * context key names. The runtime is responsible for mapping these signals to
 * ContextKeys and synchronizing them with VS Code UI contexts.
 */
export type ProjectContext = {
  hasRuntime: boolean;
  hasFramework: boolean;
  hasFastApi: boolean;
  hasTypeSupport: boolean;
};

/**
 * Default empty context used when a workspace cannot be resolved or inspected.
 */
export const EMPTY_PROJECT_CONTEXT: ProjectContext = {
  hasRuntime: false,
  hasFramework: false,
  hasFastApi: false,
  hasTypeSupport: false,
};
