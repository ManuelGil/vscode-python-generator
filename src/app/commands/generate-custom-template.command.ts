import { Uri } from 'vscode';
import { BaseCommand } from './base.command';

/**
 * The GenerateCustomTemplateCommand class.
 *
 * @class
 * @classdesc The class that represents the generate custom template command.
 * @extends {BaseCommand}
 * @export
 * @public
 * @example
 * const command = new GenerateCustomTemplateCommand(config);
 */
export class GenerateCustomTemplateCommand extends BaseCommand {
  // -----------------------------------------------------------------
  // Methods
  // -----------------------------------------------------------------

  // Public methods

  /**
   * Executes custom template generation.
   *
   * @async
   * @method execute
   * @public
   * @memberof GenerateCustomTemplateCommand
   *
   * @param {Uri} folderPath - The folder path
   */
  async execute(folderPath?: Uri): Promise<void> {
    await this.service.generateCustomTemplate(folderPath);
  }
}
