import type { ActivityEvent, ItemSummary, ItemType, Priority, Status, View } from '../api/types'

export const STATUS_LABEL: Record<Status, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  AWAITING_APPROVAL: 'Awaiting approval',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
}

export const TYPE_LABEL: Record<ItemType, string> = {
  INCIDENT: 'Incident',
  CUSTOMER_ISSUE: 'Customer issue',
  PAYMENT: 'Payment',
  COMPLIANCE: 'Compliance',
  TASK: 'Task',
}

export const VIEW_LABEL: Record<View, string> = {
  assigned_to_me: 'Assigned to me',
  unassigned_urgent: 'Unassigned urgent',
  awaiting_my_approval: 'Awaiting my approval',
  overdue: 'Overdue',
}

export const STATUSES = Object.keys(STATUS_LABEL) as Status[]
export const PRIORITIES = Object.keys(PRIORITY_LABEL) as Priority[]
export const TYPES = Object.keys(TYPE_LABEL) as ItemType[]
export const VIEWS = Object.keys(VIEW_LABEL) as View[]

const dateTime = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const dateOnly = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso))
export const formatDate = (iso: string): string => dateOnly.format(new Date(iso))

// The date as the user's calendar shows it, in the yyyy-mm-dd form an <input type="date"> uses.
export function toDateInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// A chosen calendar day becomes midday that day, so time zones can't shift it to another date.
export function dateInputToIso(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12).toISOString()
}

export function isOverdue(item: Pick<ItemSummary, 'dueDate' | 'status'>): boolean {
  return (
    item.dueDate !== null &&
    item.status !== 'RESOLVED' &&
    item.status !== 'CLOSED' &&
    new Date(item.dueDate).getTime() < Date.now()
  )
}

const label = (value: string | null, map: Record<string, string>): string => (value ? (map[value] ?? value) : 'none')

export interface EventText {
  tag: string
  text: string
  note: string | null
}

// Turns a history row into a sentence a person can read.
export function describeEvent(e: ActivityEvent): EventText {
  switch (e.action) {
    case 'created':
      return { tag: 'CREATED', text: 'created this item', note: null }
    case 'assigned':
      if (e.newValue === null) return { tag: 'RELEASED', text: `released the item (was ${e.oldValue})`, note: null }
      if (e.oldValue === null && e.newValue === e.user.name) return { tag: 'CLAIMED', text: 'claimed the item', note: null }
      if (e.oldValue === null) return { tag: 'ASSIGNED', text: `assigned it to ${e.newValue}`, note: null }
      return { tag: 'ASSIGNED', text: `reassigned it from ${e.oldValue} to ${e.newValue}`, note: null }
    case 'status_changed':
      return {
        tag: 'STATUS',
        text: `moved it from ${label(e.oldValue, STATUS_LABEL)} to ${label(e.newValue, STATUS_LABEL)}`,
        note: e.note,
      }
    case 'priority_changed':
      return {
        tag: 'PRIORITY',
        text: `changed priority from ${label(e.oldValue, PRIORITY_LABEL)} to ${label(e.newValue, PRIORITY_LABEL)}`,
        note: null,
      }
    case 'title_changed':
      return { tag: 'EDITED', text: `renamed it to "${e.newValue}"`, note: null }
    case 'description_changed':
      return { tag: 'EDITED', text: 'edited the description', note: null }
    case 'due_date_changed':
      return {
        tag: 'DUE DATE',
        text: e.newValue ? `set the due date to ${formatDate(e.newValue)}` : 'removed the due date',
        note: null,
      }
    case 'team_changed':
      return { tag: 'TEAM', text: `moved it from ${e.oldValue} to ${e.newValue}`, note: null }
    case 'commented':
      return { tag: 'COMMENT', text: 'commented', note: null }
    default:
      return { tag: e.action.toUpperCase(), text: e.action.replace(/_/g, ' '), note: e.note }
  }
}
