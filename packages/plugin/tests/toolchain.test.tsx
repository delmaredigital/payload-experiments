// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

afterEach(cleanup)

function ToolchainExample() {
  return <p>Plugin JSX toolchain works</p>
}

test('renders JSX with the automatic React runtime in jsdom', () => {
  render(<ToolchainExample />)
  expect(screen.getByText('Plugin JSX toolchain works').textContent).toBe('Plugin JSX toolchain works')
})
