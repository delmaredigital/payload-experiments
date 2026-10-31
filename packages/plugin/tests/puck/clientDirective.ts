import ts from 'typescript'

export function hasClientDirective(source: string): boolean {
  const parsed = ts.createSourceFile('module.tsx', source, ts.ScriptTarget.Latest, true)
  for (const statement of parsed.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break
    if (statement.expression.text === 'use client') return true
  }
  return false
}
