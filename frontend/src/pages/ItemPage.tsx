import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useItem } from '../api/queries'
import { ItemActions } from '../components/ItemActions'
import { ItemForm } from '../components/ItemForm'
import { ItemSidePanel } from '../components/ItemSidePanel'
import { Modal } from '../components/Modal'
import { PriorityMark, StatusTag, Tag } from '../components/Tag'
import { formatDate, formatDateTime, isOverdue, TYPE_LABEL } from '../lib/format'

export function ItemPage() {
  const params = useParams()
  const id = Number(params.id)
  const item = useItem(Number.isInteger(id) ? id : 0)
  const [editing, setEditing] = useState(false)

  if (item.isLoading) return <p className="card empty">Loading item…</p>

  if (item.isError || !item.data) {
    const notFound = item.error instanceof ApiError && (item.error.status === 404 || item.error.status === 400)
    return (
      <div className="card empty" role="alert">
        <h2>{notFound ? 'Item not found' : 'Could not load this item'}</h2>
        <p>{notFound ? 'It may not exist, or you may not have access to it.' : item.error?.message}</p>
        <Link to="/" className="btn btn--primary btn--small">Back to all items</Link>
      </div>
    )
  }

  const data = item.data
  return (
    <>
      <p>
        <Link to="/" className="back-link">← All items</Link>
      </p>

      <div className="layout">
        <section className="card item-detail" aria-labelledby="item-title">
          <div className="item-card__top">
            <div className="tags">
              <Tag>{TYPE_LABEL[data.type]}</Tag>
              <Tag>{data.team.name}</Tag>
              <StatusTag status={data.status} />
            </div>
            <PriorityMark priority={data.priority} />
          </div>

          <h2 id="item-title" className="item-detail__title">
            {data.title}
          </h2>
          <p className="item-detail__description">{data.description || <span className="muted">No description.</span>}</p>

          <dl className="meta meta--grid">
            <div>
              <dt>Owner</dt>
              <dd>{data.assignee?.name ?? 'Unassigned'}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd className={isOverdue(data) ? 'is-overdue' : ''}>
                {data.dueDate ? formatDate(data.dueDate) : '–'}
                {isOverdue(data) ? ' · overdue' : ''}
              </dd>
            </div>
            <div>
              <dt>Created by</dt>
              <dd>{data.createdBy.name}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatDateTime(data.updatedAt)}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd className="mono">{data.version}</dd>
            </div>
          </dl>

          <ItemActions item={data} onEdit={() => setEditing(true)} />
        </section>

        <ItemSidePanel itemId={data.id} canComment={data.actions.comment} />
      </div>

      {editing && (
        <Modal title="Edit item" onClose={() => setEditing(false)}>
          <ItemForm item={data} onDone={() => setEditing(false)} />
        </Modal>
      )}
    </>
  )
}
