import type { ReactNode } from 'react'
import type { Priority, Status } from '../api/types'
import { PRIORITY_LABEL, STATUS_LABEL } from '../lib/format'

export type Tone = 'plain' | 'yellow' | 'blue' | 'green' | 'dark'

export function Tag({ children, tone = 'plain' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`tag tag--${tone}`}>{children}</span>
}

const STATUS_TONE: Record<Status, Tone> = {
  OPEN: 'plain',
  IN_PROGRESS: 'blue',
  AWAITING_APPROVAL: 'yellow',
  RESOLVED: 'green',
  CLOSED: 'dark',
}

export function StatusTag({ status }: { status: Status }) {
  return <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>
}

// A coloured dot plus the word, so colour is never the only signal.
export function PriorityMark({ priority }: { priority: Priority }) {
  return (
    <span className={`prio prio--${priority.toLowerCase()}`}>
      <i className="prio__dot" aria-hidden="true" />
      {PRIORITY_LABEL[priority]}
    </span>
  )
}
