import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

import { validateTemplate } from '../app/validators/template.validator';

const workspaceRoot = join(__dirname, '..', '..');
const templatesRoot = join(workspaceRoot, 'templates');

suite('Template System Stability', () => {
  test('script template defines a python output file', () => {
    const scriptTemplate = JSON.parse(
      readFileSync(join(templatesRoot, 'script.json'), 'utf-8'),
    );

    const parsed = validateTemplate(scriptTemplate);
    assert.strictEqual(parsed.id, 'python.file.script');
    assert.ok(scriptTemplate.output?.fileName.includes('.py'));
  });

  test('service template uses expected naming contract', () => {
    const serviceTemplate = JSON.parse(
      readFileSync(join(templatesRoot, 'service.json'), 'utf-8'),
    );

    const parsed = validateTemplate(serviceTemplate);
    assert.strictEqual(parsed.id, 'python.domain.service');
    assert.strictEqual(
      serviceTemplate.output?.fileName,
      '{{fileNameSnakeCase}}_service.py',
    );
  });

  test('fastapi feature references valid multi-file templates', () => {
    const fastApiFeature = JSON.parse(
      readFileSync(join(templatesRoot, 'fastapi-feature.json'), 'utf-8'),
    );

    const parsed = validateTemplate(fastApiFeature);
    assert.strictEqual(parsed.kind, 'multi');
    assert.ok(parsed.files && parsed.files.length >= 4);

    const allTemplates = [
      'fastapi-router.json',
      'fastapi-service.json',
      'fastapi-schema.json',
      'fastapi-repository.json',
    ].map((fileName) =>
      JSON.parse(readFileSync(join(templatesRoot, fileName), 'utf-8')),
    );

    const ids = new Set(allTemplates.map((template) => template.id));

    for (const fileRef of parsed.files ?? []) {
      assert.ok(
        ids.has(fileRef),
        `Missing multi-file reference target: ${fileRef}`,
      );
    }
  });

  test('folder path validation contract blocks invalid paths', () => {
    const isSafeRelativeFolderPath = (folderName: string): boolean => {
      const normalizedFolder = folderName.replace(/\\\\/g, '/');
      return !(
        normalizedFolder.startsWith('/') ||
        /(^|[\\/])\.\.(?:[\\/]|$)/.test(normalizedFolder)
      );
    };

    assert.strictEqual(isSafeRelativeFolderPath('src/api'), true);
    assert.strictEqual(isSafeRelativeFolderPath('/tmp/abs'), false);
    assert.strictEqual(isSafeRelativeFolderPath('../outside'), false);
  });
});
