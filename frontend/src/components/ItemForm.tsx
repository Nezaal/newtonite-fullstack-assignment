import { useState, type FormEvent } from 'react'
import { useCreateItem, useEditItem, type EditVars } from '../api/mutations'
import { ApiError, newIdempotencyKey, type FieldError } from '../api/client'
import type { ItemDetail, ItemType, Priority } from '../api/types'
import { useAuth } from '../auth/auth-context'
import { useToast } from './toast-context'
import { dateInputToIso, PRIORITIES, PRIORITY_LABEL, toDateInputValue, TYPE_LABEL, TYPES } from '../lib/format'

interface FormProps {
  item?: ItemDetail
  // Called when the form closes. After a successful create it receives the new item.
  onDone: (created?: ItemDetail) => void
}

interface Values {
  title: string
  description: string
  type: ItemType
  teamId: number
  priority: Priority
  dueDate: string
}

const fieldMessage = (errors: FieldError[] | undefined, field: string) => errors?.find((e) => e.field === field)?.message

function valuesFrom(item: ItemDetail | undefined, fallbackTeam: number): Values {
  return {
    title: item?.title ?? '',
    description: item?.description ?? '',
    type: item?.type ?? 'TASK',
    teamId: item?.team.id ?? fallbackTeam,
    priority: item?.priority ?? 'MEDIUM',
    dueDate: toDateInputValue(item?.dueDate ?? null),
  }
}

export function ItemForm({ item, onDone }: FormProps) {
  const { me } = useAuth()
  const toast = useToast()
  const editing = item !== undefined
  // Only teams where the user can create items (not Viewer) are offered.
  const workTeams = (me?.teams ?? []).filter((t) => t.role !== 'VIEWER')

  const [values, setValues] = useState<Values>(() => valuesFrom(item, workTeams[0]?.id ?? 0))
  // One key per "attempt": a double click or a retry sends the same key, so only one item is created.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)
  // The version this edit started from. Saving sends THIS version, not whatever is on screen now,
  // so a change made by someone else in the meantime is caught instead of silently overwritten.
  const [baseVersion, setBaseVersion] = useState(item?.version ?? 0)
  const [serverStale, setServerStale] = useState(false)
  const stale = serverStale || (item !== undefined && item.version !== baseVersion)

  const create = useCreateItem()
  const edit = useEditItem(item?.id ?? 0)
  const pending = create.isPending || edit.isPending
  const error = (editing ? edit.error : create.error) ?? null
  const fieldErrors = error instanceof ApiError ? error.details : undefined

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (item) {
      const changes: EditVars = { version: baseVersion }
      if (values.title !== item.title) changes.title = values.title
      if (values.description !== item.description) changes.description = values.description
      if (values.priority !== item.priority) changes.priority = values.priority
      if (values.dueDate !== toDateInputValue(item.dueDate)) changes.dueDate = values.dueDate ? dateInputToIso(values.dueDate) : null
      if (item.actions.moveTeam && values.teamId !== item.team.id) changes.teamId = values.teamId
      edit.mutate(changes, {
        onSuccess: () => onDone(),
        onError: (e) => setServerStale(e instanceof ApiError && e.code === 'VERSION_CONFLICT'),
      })
      return
    }
    create.mutate(
      {
        teamId: values.teamId,
        title: values.title,
        description: values.description,
        type: values.type,
        priority: values.priority,
        dueDate: values.dueDate ? dateInputToIso(values.dueDate) : null,
        idempotencyKey,
      },
      {
        onSuccess: (created) => {
          setIdempotencyKey(newIdempotencyKey()) // the next item is a new attempt
          toast.success('Item created')
          onDone(created)
        },
      },
    )
  }

  if (!editing && workTeams.length === 0) {
    return <p>You are a Viewer in all your teams, so you cannot create items.</p>
  }

  const titleError = fieldMessage(fieldErrors, 'title')
  return (
    <form className="form" onSubmit={submit} noValidate>
      {stale && item && (
        <div className="notice notice--error" role="alert">
          <p>
            <strong>Someone else changed this item while you were editing.</strong> The latest is version {item.version} (you started from {baseVersion}).
            Choose what to do before saving.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => {
                setValues(valuesFrom(item, item.team.id))
                setBaseVersion(item.version)
                setServerStale(false)
              }}
            >
              Use the latest values
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => {
                setBaseVersion(item.version)
                setServerStale(false)
              }}
            >
              Keep my edits and save over
            </button>
          </div>
        </div>
      )}
      {error && !stale && (
        <p className="notice notice--error" role="alert">
          {error.message}
        </p>
      )}

      <div className="field">
        <label htmlFor="title">Title</label>
        <input id="title" className="input" value={values.title} maxLength={200} onChange={(e) => set('title', e.target.value)} aria-invalid={titleError ? true : undefined} aria-describedby={titleError ? 'title-error' : undefined} autoFocus />
        {titleError && <span id="title-error" className="field__error">{titleError}</span>}
      </div>

      <div className="field">
        <label htmlFor="description">Description</label>
        <textarea id="description" className="textarea" rows={4} maxLength={5000} value={values.description} onChange={(e) => set('description', e.target.value)} />
      </div>

      <div className="form__row">
        {!editing && (
          <div className="field">
            <label htmlFor="type">Type</label>
            <select id="type" className="select" value={values.type} onChange={(e) => set('type', e.target.value as ItemType)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="priority">Priority</label>
          <select id="priority" className="select" value={values.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="due">Due date</label>
          <input id="due" className="input" type="date" value={values.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </div>
      </div>

      {(!editing || item?.actions.moveTeam) && (
        <div className="field">
          <label htmlFor="team">Team</label>
          <select id="team" className="select" value={values.teamId} onChange={(e) => set('teamId', Number(e.target.value))}>
            {workTeams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {editing && values.teamId !== item?.team.id && (
            <span className="field__hint">Moving to another team removes the owner and reopens the item.</span>
          )}
        </div>
      )}

      <div className="form__foot">
        <button type="button" className="btn btn--ghost" onClick={() => onDone()}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={pending || stale}>
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Create item'}
        </button>
      </div>
    </form>
  )
}
