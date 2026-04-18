import { Uri } from 'vscode';
import { BaseCommand } from './base.command';

export class GenerateFastApiFeatureCommand extends BaseCommand {
  async execute(folderPath?: Uri): Promise<void> {
    await this.service.generateFastApiFeature(folderPath);
  }
}
