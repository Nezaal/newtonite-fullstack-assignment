import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useDashboard, useItems } from '../api/queries'
import type { ItemFilters, View } from '../api/types'
import { useAuth } from '../auth/auth-context'
import { FilterBar } from '../components/FilterBar'
import { ItemCard } from '../components/ItemCard'
import { ItemForm } from '../components/ItemForm'
import { Modal } from '../components/Modal'
import { NotificationsPanel } from '../components/NotificationsPanel'
import { StatCard } from '../components/StatCard'
import { Tag } from '../components/Tag'
import { parseFilters, useDebouncedValue } from '../lib/filters'
import { VIEW_LABEL, VIEWS } from '../lib/format'

export function DashboardPage() {
  const { me } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => parseFilters(params), [params])

  const [searchText, setSearchText] = useState(filters.q ?? '')
  const debouncedSearch = useDebouncedValue(searchText, 300)
  const [creating, setCreating] = useState(false)

  const counts = useDashboard()
  const items = useItems(filters)
  const all = items.data?.pages.flatMap((page) => page.data) ?? []
  const canCreate = (me?.teams ?? []).some((t) => t.role !== 'VIEWER')

  // Wait for the user to stop typing, then put the search text into the URL.
  useEffect(() => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        const text = debouncedSearch.trim()
        if (text) next.set('q', text)
        else next.delete('q')
        return next.toString() === previous.toString() ? previous : next
      },
      { replace: true },
    )
  }, [debouncedSearch, setParams])

  function changeFilters(change: Partial<ItemFilters>) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const [key, value] of Object.entries(change)) {
          if (value === undefined || value === '') next.delete(key)
          else next.set(key, String(value))
        }
        return next
      },
      { replace: true },
    )
  }

  function clearFilters() {
    setSearchText('')
    setParams({}, { replace: true })
  }

  const toggleView = (view: View) => changeFilters({ view: filters.view === view ? undefined : view })

  return (
    <>
      <section className="stats" aria-label="Dashboard">
        {VIEWS.map((view) => (
          <StatCard key={view} label={VIEW_LABEL[view]} count={counts.data?.[view]} active={filters.view === view} onToggle={() => toggleView(view)} />
        ))}
      </section>

      <div className="layout">
        <section aria-labelledby="items-title">
          <div className="section-head">
            <h2 className="section-title" id="items-title">
              Work items
            </h2>
            <div className="section-head__right">
              {items.isSuccess && <Tag tone="dark">{all.length}{items.hasNextPage ? '+' : ''} shown</Tag>}
              {canCreate && (
                <button type="button" className="btn btn--primary btn--small" onClick={() => setCreating(true)}>
                  New item
                </button>
              )}
            </div>
          </div>

          <FilterBar filters={filters} searchText={searchText} onSearchText={setSearchText} onChange={changeFilters} onClear={clearFilters} teams={me?.teams ?? []} />

          {items.isLoading && <p className="card empty">Loading items…</p>}
          {items.isError && (
            <div className="card empty" role="alert">
              <p>{items.error.message}</p>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => void items.refetch()}>
                Try again
              </button>
            </div>
          )}
          {items.isSuccess && all.length === 0 && (
            <p className="card empty">No items match these filters.</p>
          )}

          <div className="items-grid">
            {all.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>

          {items.hasNextPage && (
            <div className="center">
              <button type="button" className="btn btn--ghost" disabled={items.isFetchingNextPage} onClick={() => void items.fetchNextPage()}>
                {items.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </section>

        <NotificationsPanel />
      </div>

      {creating && (
        <Modal title="New work item" onClose={() => setCreating(false)}>
          <ItemForm
            onDone={(created) => {
              setCreating(false)
              if (created) navigate(`/items/${created.id}`)
            }}
          />
        </Modal>
      )}
    </>
  )
}
