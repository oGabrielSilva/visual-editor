import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function imports(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  return source.statements.flatMap((statement) => {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [statement.moduleSpecifier.text];
    }
    return [];
  });
}

function moduleName(file: string): string {
  return relative(sourceRoot, file).replaceAll('\\', '/').split('/')[0] ?? '';
}

describe('independent architecture fitness: actual module boundaries', () => {
  it('keeps core isolated from adapters, presentation, host and Node', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(sourceRoot).filter((entry) => moduleName(entry) === 'core')) {
      for (const dependency of imports(file)) {
        if (dependency === 'valibot') continue;
        if (
          !dependency.startsWith('.') ||
          moduleName(resolve(dirname(file), dependency)) !== 'core'
        ) {
          violations.push(`${relative(sourceRoot, file)} -> ${dependency}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps application dependent on its own orchestration and core contracts', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(sourceRoot).filter(
      (entry) => moduleName(entry) === 'application',
    )) {
      for (const dependency of imports(file)) {
        const target = dependency.startsWith('.')
          ? moduleName(resolve(dirname(file), dependency))
          : dependency;
        if (!['core', 'application'].includes(target))
          violations.push(`${relative(sourceRoot, file)} -> ${dependency}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('does not depend on another checkout or on modules of a host application', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(sourceRoot)) {
      for (const dependency of imports(file)) {
        if (
          dependency.startsWith('.') &&
          relative(sourceRoot, resolve(dirname(file), dependency)).startsWith('..')
        ) {
          violations.push(`${relative(sourceRoot, file)} -> ${dependency}`);
        }
        // Aliases of a host application (`~/`, `~~/`) never resolve inside the package.
        if (dependency.startsWith('~/') || dependency.startsWith('~~/')) {
          violations.push(`${relative(sourceRoot, file)} -> ${dependency}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('has an acyclic internal TypeScript import graph', () => {
    const files = sourceFiles(sourceRoot);
    const available = new Set(files.map((file) => resolve(file)));
    const graph = new Map(
      files.map((file) => [
        resolve(file),
        imports(file)
          .filter((dependency) => dependency.startsWith('.'))
          .map((dependency) =>
            resolve(dirname(file), dependency.endsWith('.ts') ? dependency : `${dependency}.ts`),
          )
          .filter((dependency) => available.has(dependency)),
      ]),
    );
    const visited = new Set<string>();
    const active = new Set<string>();
    const cycles: string[] = [];
    function visit(file: string, path: readonly string[]): void {
      if (active.has(file)) {
        cycles.push([...path, file].map((entry) => relative(sourceRoot, entry)).join(' -> '));
        return;
      }
      if (visited.has(file)) return;
      active.add(file);
      for (const dependency of graph.get(file) ?? []) visit(dependency, [...path, file]);
      active.delete(file);
      visited.add(file);
    }
    for (const file of graph.keys()) visit(file, []);
    expect(cycles).toEqual([]);
  });
});
