import React, { useEffect, useState } from 'react'
import styles from './RawDataView.module.css'

const DOMAIN_COLORS = {
  cyber: 'var(--blue)',
  physical: 'var(--amber)',
  osint: 'var(--purple)',
  unknown: 'var(--text3)',
}

function formatCount(value) {
  return Number(value || 0).toLocaleString()
}

function formatTime(value) {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleString()
}

export default function RawDataView({ sentinel }) {
  const { rawData, liveApiAvailable, refreshRawData, liveError } = sentinel
  const [domainFilter, setDomainFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const summary = rawData?.summary ?? {}
  const domains = rawData?.domains ?? []
  const sources = rawData?.sources ?? []
  const events = rawData?.events ?? []
  const dbMissing = Boolean(rawData?.dbMissing)
  const matchingEvents = Number(rawData?.matchingEvents || 0)
  const pageSize = Number(rawData?.limit || 100)
  const totalPages = Math.max(Math.ceil(matchingEvents / pageSize), 1)
  const maxDomainCount = Math.max(...domains.map(item => item.count), 1)

  useEffect(() => {
    setPage(0)
  }, [domainFilter, scopeFilter, search])

  useEffect(() => {
    if (!liveApiAvailable) return
    refreshRawData({
      scope: scopeFilter,
      domain: domainFilter,
      search,
      offset: page * pageSize,
      limit: pageSize,
    })
  }, [domainFilter, liveApiAvailable, page, pageSize, refreshRawData, scopeFilter, search])

  const hasPrev = page > 0
  const hasNext = page + 1 < totalPages

  return (
    <div className={styles.view}>
      <div className={styles.topRow}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <div className={styles.title}>MASTER DB OVERVIEW</div>
              <div className={styles.subtitle}>Directly from `unified_events` in aurora.db</div>
            </div>
            {liveApiAvailable && (
              <button
                type="button"
                className={styles.refreshBtn}
                onClick={() =>
                  refreshRawData({
                    scope: scopeFilter,
                    domain: domainFilter,
                    search,
                    offset: page * pageSize,
                    limit: pageSize,
                  })
                }
              >
                REFRESH DB VIEW
              </button>
            )}
          </div>
          {dbMissing ? (
            <div className={styles.empty}>`db/aurora.db` was not found by the API.</div>
          ) : (
            <div className={styles.statGrid}>
              <div className={styles.statCard}>
                <span className={styles.statLabel}>Total events</span>
                <span className={styles.statValue}>{formatCount(summary.total_events)}</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statLabel}>Live events</span>
                <span className={styles.statValue}>{formatCount(summary.live_events)}</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statLabel}>Historical events</span>
                <span className={styles.statValue}>{formatCount(summary.historical_events)}</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statLabel}>Simulated events</span>
                <span className={styles.statValue}>{formatCount(summary.simulated_events)}</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statLabel}>Unique sources</span>
                <span className={styles.statValue}>{formatCount(summary.unique_sources)}</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statLabel}>Latest timestamp</span>
                <span className={styles.statSmall}>{formatTime(summary.latest_timestamp)}</span>
              </div>
            </div>
          )}
          {liveError && <div className={styles.warning}>{liveError}</div>}
        </div>
      </div>

      <div className={styles.middleRow}>
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>DOMAIN MIX</div>
          <div className={styles.domainList}>
            {domains.map(item => (
              <div key={item.name} className={styles.domainRow}>
                <div className={styles.domainHead}>
                  <span className={styles.domainName}>{String(item.name).toUpperCase()}</span>
                  <span className={styles.domainCount}>{formatCount(item.count)}</span>
                </div>
                <div className={styles.domainBarTrack}>
                  <div
                    className={styles.domainBar}
                    style={{
                      width: `${(item.count / maxDomainCount) * 100}%`,
                      background: DOMAIN_COLORS[item.name] ?? 'var(--cyan)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.sectionTitle}>TOP SOURCES</div>
          <div className={styles.sourceList}>
            {sources.map(item => (
              <div key={item.name} className={styles.sourceRow}>
                <span className={styles.sourceName}>{item.name}</span>
                <span className={styles.sourceCount}>{formatCount(item.count)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`${styles.panel} ${styles.tablePanel}`}>
        <div className={styles.panelHeader}>
          <div>
            <div className={styles.title}>RAW EVENT SAMPLE</div>
            <div className={styles.subtitle}>
              Recent rows from `unified_events` so you can inspect what the engine starts from
            </div>
          </div>
          <div className={styles.filterGroup}>
            <select
              className={styles.select}
              value={domainFilter}
              onChange={e => setDomainFilter(e.target.value)}
            >
              <option value="all">All domains</option>
              {domains.map(item => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              value={scopeFilter}
              onChange={e => setScopeFilter(e.target.value)}
            >
              <option value="all">All rows</option>
              <option value="live">Live only</option>
              <option value="historical">Historical only</option>
              <option value="simulated">Simulated only</option>
            </select>
            <input
              className={styles.search}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search title, source, region..."
            />
          </div>
        </div>

        <div className={styles.tableMeta}>
          Showing <b>{formatCount(events.length)}</b> rows from a filtered total of <b>{formatCount(matchingEvents)}</b>
          <span className={styles.pageMeta}>
            Page <b>{page + 1}</b> of <b>{totalPages}</b>
          </span>
        </div>

        <div className={styles.pager}>
          <button
            type="button"
            className={styles.pagerBtn}
            disabled={!hasPrev}
            onClick={() => setPage(p => Math.max(0, p - 1))}
          >
            PREV
          </button>
          <button
            type="button"
            className={styles.pagerBtn}
            disabled={!hasNext}
            onClick={() => setPage(p => p + 1)}
          >
            NEXT
          </button>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Domain</th>
                <th>Source</th>
                <th>Title</th>
                <th>Location</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <tr key={`${ev.id}-${ev.timestampRaw}`}>
                  <td>{formatTime(ev.timestamp)}</td>
                  <td>
                    <span
                      className={styles.domainBadge}
                      style={{
                        borderColor: DOMAIN_COLORS[ev.domain] ?? 'var(--border2)',
                        color: DOMAIN_COLORS[ev.domain] ?? 'var(--text2)',
                      }}
                    >
                      {String(ev.domain).toUpperCase()}
                    </span>
                  </td>
                  <td>{ev.source}</td>
                  <td>
                    <div className={styles.eventTitle}>{ev.title}</div>
                    <div className={styles.eventDetail}>{ev.description || ev.eventType}</div>
                  </td>
                  <td>{ev.region}</td>
                  <td>
                    <div className={styles.flagStack}>
                      <span className={styles.flag}>{ev.severity}</span>
                      {ev.isLive && <span className={styles.flag}>LIVE</span>}
                      {ev.isSimulated && <span className={styles.flag}>SIM</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan="6" className={styles.emptyCell}>
                    No rows matched the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
