export type Role = 'VIEWER' | 'MEMBER' | 'LEAD'
export type Status = 'OPEN' | 'IN_PROGRESS' | 'AWAITING_APPROVAL' | 'RESOLVED' | 'CLOSED'
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
export type ItemType = 'INCIDENT' | 'CUSTOMER_ISSUE' | 'PAYMENT' | 'COMPLIANCE' | 'TASK'
export type View = 'assigned_to_me' | 'unassigned_urgent' | 'awaiting_my_approval' | 'overdue'

export interface Person {
  id: number
  name: string
}

export interface Team {
  id: number
  name: string
}

export interface ItemSummary {
  id: number
  title: string
  type: ItemType
  priority: Priority
  status: Status
  version: number
  dueDate: string | null
  createdAt: string
  updatedAt: string
  team: Team
  assignee: Person | null
}

export interface Transition {
  to: Status
  kind: 'normal' | 'approve' | 'reject'
  requiresReason: boolean
  blockedReason: string | null
}

export interface ItemActions {
  edit: boolean
  claim: boolean
  release: boolean
  assign: boolean
  moveTeam: boolean
  comment: boolean
}

export interface ItemDetail extends ItemSummary {
  description: string
  createdBy: Person
  actions: ItemActions
  transitions: Transition[]
}

export interface ActivityEvent {
  id: number
  action: string
  oldValue: string | null
  newValue: string | null
  note: string | null
  createdAt: string
  user: Person
}

export interface ItemComment {
  id: number
  body: string
  createdAt: string
  user: Person
}

export interface AppNotification {
  id: number
  message: string
  isRead: boolean
  createdAt: string
  item: { id: number; title: string }
}

export interface Me {
  user: { id: number; name: string; email: string; isAdmin: boolean }
  teams: { id: number; name: string; role: Role }[]
}

export interface TeamMember extends Person {
  role: Role
}

export type DashboardCounts = Record<View, number>

export interface ItemFilters {
  q?: string
  view?: View
  teamId?: number
  status?: Status
  priority?: Priority
  type?: ItemType
  assignee?: 'me' | 'none' | number
}
