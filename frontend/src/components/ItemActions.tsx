import { useState } from 'react'
import { useAssign, useClaim, useRelease, useTransition } from '../api/mutations'
import { useTeamMembers } from '../api/queries'
import type { ItemDetail, Status, Transition } from '../api/types'

function transitionLabel(from: Status, t: Transition): string {
  if (t.kind === 'approve') return 'Approve'
  if (t.kind === 'reject') return 'Reject…'
  if (from === 'OPEN') return 'Start work'
  if (from === 'RESOLVED') return t.to === 'CLOSED' ? 'Close item' : 'Reopen'
  if (t.to === 'AWAITING_APPROVAL') return 'Request approval'
  return 'Mark resolved'
}

export function ItemActions({ item, onEdit }: { item: ItemDetail; onEdit: () => void }) {
  const claim = useClaim(item.id)
  const release = useRelease(item.id)
  const assign = useAssign(item.id)
  const transition = useTransition(item.id)

  const members = useTeamMembers(item.team.id, item.actions.assign)
  const assignable = (members.data ?? []).filter((m) => m.role !== 'VIEWER' && m.id !== item.assignee?.id)

  const [assigneeId, setAssigneeId] = useState('')
  const [rejecting, setRejecting] = useState<Transition | null>(null)
  const [reason, setReason] = useState('')

  const busy = claim.isPending || release.isPending || assign.isPending || transition.isPending
  // The most recent refusal from the server, shown next to the buttons until the next try.
  const failure = claim.error ?? release.error ?? assign.error ?? transition.error

  const none = !item.actions.edit && !item.actions.claim && !item.actions.release && !item.actions.assign && item.transitions.length === 0

  function sendTransition(t: Transition, why?: string) {
    transition.mutate({ to: t.to, version: item.version, reason: why })
    setRejecting(null)
    setReason('')
  }

  return (
    <section className="actions-box" aria-label="Actions">
      {failure && (
        <p className="notice notice--error" role="alert">
          {failure.message}
        </p>
      )}

      <div className="actions">
        {item.actions.claim && (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => claim.mutate()}>
            Claim this item
          </button>
        )}
        {item.transitions.map((t) => (
          <button
            key={t.to + t.kind}
            type="button"
            className={t.kind === 'normal' || t.kind === 'approve' ? 'btn btn--primary' : 'btn btn--ghost'}
            disabled={busy || t.blockedReason !== null}
            title={t.blockedReason ?? undefined}
            onClick={() => (t.requiresReason ? setRejecting(t) : sendTransition(t))}
          >
            {transitionLabel(item.status, t)}
          </button>
        ))}
        {item.actions.release && (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => release.mutate()}>
            Release
          </button>
        )}
        {item.actions.edit && (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={onEdit}>
            Edit
          </button>
        )}
      </div>

      {item.transitions.some((t) => t.blockedReason) && (
        <p className="muted small">{item.transitions.find((t) => t.blockedReason)?.blockedReason}.</p>
      )}

      {rejecting && (
        <form
          className="form form--inline"
          onSubmit={(e) => {
            e.preventDefault()
            sendTransition(rejecting, reason.trim())
          }}
        >
          <div className="field">
            <label htmlFor="reason">Why are you sending this back? (required)</label>
            <textarea id="reason" className="textarea" rows={2} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <div className="actions">
            <button type="submit" className="btn btn--primary btn--small" disabled={busy || reason.trim() === ''}>
              Send back
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setRejecting(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {item.actions.assign && (
        <form
          className="assign"
          onSubmit={(e) => {
            e.preventDefault()
            const person = assignable.find((m) => m.id === Number(assigneeId))
            if (person) {
              assign.mutate({ assigneeId: person.id, assigneeName: person.name, version: item.version })
              setAssigneeId('')
            }
          }}
        >
          <label className="sr-only" htmlFor="assign-to">Assign to</label>
          <select id="assign-to" className="select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">{item.assignee ? 'Reassign to…' : 'Assign to…'}</option>
            {assignable.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <button type="submit" className="btn btn--blue btn--small" disabled={busy || assigneeId === ''}>
            Assign
          </button>
        </form>
      )}

      {none && <p className="muted small">You can read and comment on this item.</p>}
    </section>
  )
}
