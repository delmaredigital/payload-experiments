import { useSyncExternalStore } from 'react'
import type { ChangeEvent, ComponentProps, ReactNode } from 'react'
import { vi } from 'vitest'

type Values = Record<string, unknown>
type MockFields = Record<string, { value?: unknown; [key: string]: unknown }>
const defaults = () => ({
  config: { config: { routes: { api: '/api', admin: '/admin' } } },
  entityConfig: undefined as unknown,
  auth: { user: null, permissions: { collections: {} } } as Values,
  field: { value: undefined, setValue: vi.fn() } as Values,
  fieldsByPath: {} as Record<string, Values>,
  form: { dispatchFields: vi.fn(), submit: vi.fn(), getData: vi.fn(() => ({})), setModified: vi.fn() } as Values,
  formFields: {} as MockFields,
  documentInfo: { id: '1', collectionSlug: 'xp-experiments', data: {} } as Values,
  formModified: false,
  formInitializing: false,
  serverFunctions: { getFormState: vi.fn() } as Values,
  openModals: [] as string[],
  rowLabel: { path: '', data: {} } as Values,
})
let state = defaults()
const listeners = new Set<() => void>()
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
function useStateSnapshot() { return useSyncExternalStore(subscribe, () => state, () => state) }
export function setPayloadUiState(patch: Partial<typeof state>) {
  state = { ...state, ...patch }
  listeners.forEach(listener => listener())
}
export function resetPayloadUiMock() {
  state = defaults()
  toast.mockClear()
  Object.values(toast).forEach(member => { if (vi.isMockFunction(member)) member.mockClear() })
  listeners.forEach(listener => listener())
}
export const setConfig = (config: typeof state.config) => setPayloadUiState({ config })
export const setEntityConfig = (entityConfig: unknown) => setPayloadUiState({ entityConfig })
export const setAuth = (auth: Values) => setPayloadUiState({ auth })
export const setField = (field: Values, path?: string) => setPayloadUiState(path ? { fieldsByPath: { ...state.fieldsByPath, [path]: field } } : { field })
export const setForm = (form: Values) => setPayloadUiState({ form })
export const setFormFields = (formFields: MockFields) => setPayloadUiState({ formFields })
export const setFormModified = (formModified: boolean) => setPayloadUiState({ formModified })
export const setDocumentInfo = (documentInfo: Values) => setPayloadUiState({ documentInfo })

// Keep wrappers deliberately small; no Payload internals or layout are simulated.
type Children = { children?: ReactNode; className?: string }
type InputProps = {
  label?: ReactNode; path?: string; name?: string; id?: string; value?: string | number;
  disabled?: boolean; readOnly?: boolean; required?: boolean; placeholder?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void
}
function TextInput({ label, path, name, id: _id, Error, showError: _showError, hasMany: _hasMany, ...props }: InputProps & {
  Error?: ReactNode; showError?: boolean; hasMany?: boolean
}) {
  const inputId = `field-${path?.replace(/\./g, '__')}`
  return <div><label htmlFor={inputId}>{label}</label>{Error}<input {...props} name={name ?? path} id={inputId} /></div>
}
function TextareaInput({ label, path, name, id: _id, Error, showError: _showError, ...props }: Omit<InputProps, 'onChange'> & {
  Error?: ReactNode; showError?: boolean
  onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void
}) {
  const inputId = `field-${path?.replace(/\./g, '__')}`
  return <div><label htmlFor={inputId}>{label}</label>{Error}<textarea {...props} name={name ?? path} id={inputId} /></div>
}
// Mirrors @payloadcms/ui 3.90.2: CheckboxInput takes `onToggle` (no `onChange`) and `readOnly` disables it.
function CheckboxInput({ label, path, name, id, checked, onToggle, readOnly, disabled, required }: {
  label?: ReactNode; path?: string; name?: string; id?: string; checked?: boolean
  onToggle?: (event: ChangeEvent<HTMLInputElement>) => void; readOnly?: boolean; disabled?: boolean; required?: boolean
}) {
  return <label><input type="checkbox" checked={checked} name={name ?? path} id={id ?? path} required={required}
    disabled={disabled || readOnly} onChange={event => onToggle?.(event)} />{label}</label>
}
function FieldDescription({ description, path }: { description?: ReactNode; path?: string }) {
  return description ? <div id={path ? `${path}-description` : undefined}>{description}</div> : null
}
function FieldLabel({ label, as: Element = 'label' }: { label?: ReactNode; as?: 'h3' | 'label' | 'span' }) {
  return label ? <Element>{label}</Element> : null
}
type Option = { label: string; value: string }
function SelectInput({ label, description, options = [], value, onChange, disabled, readOnly, hasMany, name, path }: {
  label?: ReactNode; description?: ReactNode; options?: Option[]; value?: string | string[] | Option | Option[] | null;
  onChange?: (option: Option | Option[] | null) => void; disabled?: boolean; readOnly?: boolean;
  hasMany?: boolean; name?: string; path?: string
}) {
  const selected = Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : item.value)
    : typeof value === 'object' ? value?.value : value
  return <><label>{label}<select name={name ?? path} multiple={hasMany} disabled={disabled || readOnly}
    value={selected ?? (hasMany ? [] : '')} onChange={event => {
      const picked = Array.from(event.target.selectedOptions).map(item => options.find(option => option.value === item.value)!)
      onChange?.(hasMany ? picked : picked[0] ?? null)
    }}>{!hasMany ? <option value="" /> : null}{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    <FieldDescription description={description} path={path} /></>
}
export const toast = Object.assign(vi.fn(), {
  success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
})
export function payloadUiMock() {
  return {
    useConfig: () => {
      const snapshot = useStateSnapshot()
      return { ...snapshot.config, getEntityConfig: () => snapshot.entityConfig }
    },
    useAuth: () => useStateSnapshot().auth,
    Link: ({ prefetch: _prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => <a {...props} />,
    NavGroup: ({ label, children, isOpen }: Children & { label: string; isOpen?: boolean }) =>
      <div className="nav-group" data-is-open={isOpen}><div className="nav-group__label">{label}</div>{children}</div>,
    Card: ({ title, href, id, buttonAriaLabel, titleAs: Title = 'div' }: {
      title: string; href?: string; id?: string; buttonAriaLabel?: string; titleAs?: 'h3' | 'div'
    }) => <div className="card" id={id}><Title className="card__title">{title}</Title><a aria-label={buttonAriaLabel} href={href} /></div>,
    useField: ({ path }: { path?: string } = {}) => {
      const snapshot = useStateSnapshot()
      return (path && snapshot.fieldsByPath[path]) || snapshot.field
    },
    useForm: () => useStateSnapshot().form,
    useFormFields: <T,>(selector: (context: [MockFields, unknown]) => T) => {
      const snapshot = useStateSnapshot()
      return selector([snapshot.formFields, snapshot.form.dispatchFields])
    },
    useDocumentInfo: () => useStateSnapshot().documentInfo,
    useFormModified: () => useStateSnapshot().formModified,
    useFormInitializing: () => useStateSnapshot().formInitializing,
    useServerFunctions: () => useStateSnapshot().serverFunctions,
    useRowLabel: () => useStateSnapshot().rowLabel,
    useModal: () => ({ openModal: (slug: string) => setPayloadUiState({ openModals: [...state.openModals, slug] }) }),
    ConfirmationModal: ({ modalSlug, heading, body, confirmLabel, cancelLabel, onConfirm, onCancel }: {
      modalSlug: string; heading: ReactNode; body: ReactNode; confirmLabel: string; cancelLabel: string
      onConfirm: () => Promise<void> | void; onCancel?: () => void
    }) => {
      const snapshot = useStateSnapshot()
      const close = () => setPayloadUiState({ openModals: state.openModals.filter(slug => slug !== modalSlug) })
      return snapshot.openModals.includes(modalSlug) ? <div role="dialog" aria-label={typeof heading === 'string' ? heading : undefined} data-modal-slug={modalSlug}>
        {body}<button onClick={() => { close(); onCancel?.() }}>{cancelLabel}</button>
        <button onClick={async () => { await onConfirm(); close() }}>{confirmLabel}</button>
      </div> : null
    },
    Button: ({ children, className, onClick, disabled, extraButtonProps, type = 'button' }: Children & {
      onClick?: () => void; disabled?: boolean; extraButtonProps?: ComponentProps<'button'>; type?: 'button' | 'submit' | 'reset'
    }) => <button {...extraButtonProps} className={className} onClick={onClick} disabled={disabled} type={type}>{children}</button>,
    Banner: ({ children, className }: Children) => <div className={className} role="status">{children}</div>,
    Pill: ({ children, className }: Children) => <span className={className}>{children}</span>,
    FieldDescription, FieldLabel, TextInput, TextareaInput, CheckboxInput, SelectInput, toast,
  }
}

const navigationDefaults = () => ({
  pathname: '/admin/collections/xp-experiments/1',
  searchParams: new URLSearchParams(), params: {} as Record<string, string | string[]>,
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() },
})
let navigation = navigationDefaults()
export function setNextNavigation(patch: Partial<typeof navigation>) { navigation = { ...navigation, ...patch } }
export function resetNextNavigationMock() { navigation = navigationDefaults() }
export function nextNavigationMock() {
  return {
    useRouter: () => navigation.router,
    usePathname: () => navigation.pathname,
    useSearchParams: () => navigation.searchParams,
    useParams: () => navigation.params,
  }
}
