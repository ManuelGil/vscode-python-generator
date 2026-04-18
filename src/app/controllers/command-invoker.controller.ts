import { Uri } from 'vscode';

import type { Command } from '../types';

/**
 * Registers and executes commands behind a single invocation registry.
 *
 * This controller keeps the command wiring thin and centralizes the disabled
 * state behavior for the extension entry point.
 *
 * @class
 * @export
 * @public
 */
export class CommandInvoker {
  // -----------------------------------------------------------------
  // Properties
  // -----------------------------------------------------------------

  // Private properties

  /**
   * The commands.
   *
   * @type {Map<string, Command>}
   * @private
   * @memberof CommandInvoker
   */
  private commands: Map<string, Command> = new Map();

  // -----------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------

  /**
   * Creates a command invoker.
   */
  constructor() {}

  // -----------------------------------------------------------------
  // Methods
  // -----------------------------------------------------------------

  // Public methods

  /**
   * Registers a command handler by name.
   *
   * @param commandName Command identifier.
   * @param command Command implementation.
   */
  register(commandName: string, command: Command) {
    this.commands.set(commandName, command);
  }

  /**
   * Executes a registered command when it has been registered.
   *
   * @param commandName Command identifier.
   * @param folderPath Folder context supplied by VS Code.
   */
  async execute(commandName: string, folderPath?: Uri): Promise<void> {
    const command = this.commands.get(commandName);
    if (!command) {
      throw new Error(`Command not found: ${commandName}`);
    }

    await command.execute(folderPath);
  }
}
