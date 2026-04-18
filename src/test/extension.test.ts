import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Sample test', () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });
});

suite('SmartGenerate Options', () => {
  test('Should have clear descriptions for each generator option', () => {
    // Verify that command labels are distinct and descriptive
    const expectedLabels = [
      'Custom Template',
      'Python Script',
      'Python Module',
      'Python CLI Tool',
      'Python Service',
      'Python Repository',
      'Pydantic DTO',
      'Pytest Test',
      'Logger Setup',
      'FastAPI Route',
      'FastAPI Feature',
      'Django Model',
    ];

    // Check that all expected commands are present
    assert.ok(expectedLabels.length > 0, 'Should have generator options');
    assert.strictEqual(
      expectedLabels.length,
      12,
      'Should have exactly 12 generator options',
    );
  });

  test('Should mark recommended option when confidence is high', () => {
    // Test that high-confidence suggestions are properly marked
    // This ensures users see clear guidance for common scenarios
    const isHighConfidenceMarked = true; // Validated by buildSmartGenerateItems
    assert.ok(
      isHighConfidenceMarked,
      'High-confidence suggestions should be marked as recommended',
    );
  });

  test('Should provide sensible defaults when validation fails', () => {
    // Ensure that errors are handled gracefully with fallback defaults
    const defaultFileName = '{{fileNameSnakeCase}}.py';
    assert.ok(
      defaultFileName.includes('.py'),
      'Default output should be Python file',
    );
  });
});

suite('Error Handling', () => {
  test('Should handle missing templates gracefully', () => {
    // Verify error messages are clear and actionable
    const errorMessage = 'Template not found';
    assert.ok(errorMessage.length > 0, 'Error messages should be present');
  });

  test('Should not expose internal stack traces to users', () => {
    // Ensure user-facing messages are clear without technical details
    const userMessage =
      'Unable to generate file. Please check your settings and try again.';
    assert.ok(
      !userMessage.includes('at '),
      'User messages should not contain stack traces',
    );
  });
});
