import { useState, type FormEvent } from 'react'
import { newIdempotencyKey } from '../api/client'
import { useAddComment } from '../api/mutations'
import { useActivity, useComments } from '../api/queries'
import { describeEvent, formatDateTime } from '../lib/format'
import { Tag } from './Tag'

type Tab = 'comments' | 'history'

export function ItemSidePanel({ itemId, canComment }: { itemId: number; canComment: boolean }) {
  const [tab, setTab] = useState<Tab>('comments')

  return (
    <aside className="card panel" aria-label="Comments and history">
      <div className="panel__head">
        <div className="tabs" role="tablist">
          {(['comments', 'history'] as const).map((t) => (
            <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} className={`tab${tab === t ? ' tab--active' : ''}`} onClick={() => setTab(t)}>
              {t === 'comments' ? 'Comments' : 'History'}
            </button>
          ))}
        </div>
        <Tag tone="plain">Live</Tag>
      </div>
      <div className="panel__body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'comments' ? <Comments itemId={itemId} canComment={canComment} /> : <History itemId={itemId} />}
      </div>
    </aside>
  )
}

function Comments({ itemId, canComment }: { itemId: number; canComment: boolean }) {
  const comments = useComments(itemId)
  const add = useAddComment(itemId)
  const [body, setBody] = useState('')
  // A double click or a retry reuses this key, so the comment is saved once.
  const [key, setKey] = useState(newIdempotencyKey)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!body.trim()) return
    add.mutate(
      { body: body.trim(), idempotencyKey: key },
      {
        onSuccess: () => {
          setBody('')
          setKey(newIdempotencyKey())
        },
      },
    )
  }

  const all = comments.data?.pages.flatMap((p) => p.data) ?? []
  return (
    <>
      {canComment && (
        <form className="form form--inline" onSubmit={submit}>
          <label className="sr-only" htmlFor="new-comment">Add a comment</label>
          <textarea id="new-comment" className="textarea" rows={3} maxLength={2000} placeholder="Write a comment…" value={body} onChange={(e) => setBody(e.target.value)} />
          {add.error && <p className="notice notice--error" role="alert">{add.error.message}</p>}
          <div className="actions">
            <button type="submit" className="btn btn--primary btn--small" disabled={add.isPending || !body.trim()}>
              {add.isPending ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </form>
      )}
      {comments.isLoading && <p className="muted">Loading…</p>}
      {comments.isError && <p role="alert">Could not load comments.</p>}
      {comments.isSuccess && all.length === 0 && <p className="muted">No comments yet.</p>}
      <ol className="timeline">
        {all.map((c) => (
          <li key={c.id} className="timeline__item">
            <i className="timeline__dot" aria-hidden="true" />
            <div className="timeline__meta">
              <span className="mono">{formatDateTime(c.createdAt)}</span>
              <strong>{c.user.name}</strong>
            </div>
            <p className="bubble">{c.body}</p>
          </li>
        ))}
      </ol>
      {comments.hasNextPage && (
        <button type="button" className="btn btn--ghost btn--small" disabled={comments.isFetchingNextPage} onClick={() => void comments.fetchNextPage()}>
          {comments.isFetchingNextPage ? 'Loading…' : 'Load older comments'}
        </button>
      )}
    </>
  )
}

function History({ itemId }: { itemId: number }) {
  const activity = useActivity(itemId)
  const all = activity.data?.pages.flatMap((p) => p.data) ?? []

  return (
    <>
      {activity.isLoading && <p className="muted">Loading…</p>}
      {activity.isError && <p role="alert">Could not load the history.</p>}
      <ol className="timeline">
        {all.map((e) => {
          const text = describeEvent(e)
          return (
            <li key={e.id} className="timeline__item">
              <i className="timeline__dot" aria-hidden="true" />
              <div className="timeline__meta">
                <span className="mono">{formatDateTime(e.createdAt)}</span>
                <Tag tone="yellow">{text.tag}</Tag>
              </div>
              <p className="timeline__who">
                <strong>{e.user.name}</strong> {text.text}
              </p>
              {text.note && <p className="bubble">Reason: {text.note}</p>}
            </li>
          )
        })}
      </ol>
      {activity.hasNextPage && (
        <button type="button" className="btn btn--ghost btn--small" disabled={activity.isFetchingNextPage} onClick={() => void activity.fetchNextPage()}>
          {activity.isFetchingNextPage ? 'Loading…' : 'Load older history'}
        </button>
      )}
    </>
  )
}
