import './ui.css'
export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return <nav className="xp-ui-breadcrumb" aria-label="Breadcrumb"><ol>{items.map((item, index) => <li key={index}>
    {index ? <span aria-hidden="true">›</span> : null}{index === items.length - 1 ? <span aria-current="page">{item.label}</span> : <a href={item.href}>{item.label}</a>}
  </li>)}</ol></nav>
}
